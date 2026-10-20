-- Persisted interaction windows. The operational conversation and all legacy
-- records remain intact; legacy work is historical until explicitly resumed.
CREATE TABLE public.task_chat_cycles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.task_conversations(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), created_by uuid NOT NULL REFERENCES auth.users(id),
 state text NOT NULL CHECK(state IN ('active','completed','historical')) DEFAULT 'active',
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, begin_key uuid NOT NULL,
 UNIQUE(conversation_id,begin_key), CHECK((state='completed')=(completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX task_chat_one_active_cycle ON public.task_chat_cycles(conversation_id) WHERE state='active';
ALTER TABLE public.task_chat_cycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_chat_cycles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.task_chat_cycles TO authenticated;
CREATE POLICY task_chat_cycle_read ON public.task_chat_cycles FOR SELECT TO authenticated USING(created_by=auth.uid() AND public.task_owns_conversation(conversation_id));
ALTER TABLE public.task_messages ADD COLUMN cycle_id uuid REFERENCES public.task_chat_cycles(id);
ALTER TABLE public.task_drafts ADD COLUMN cycle_id uuid REFERENCES public.task_chat_cycles(id),ADD COLUMN original_cycle_id uuid REFERENCES public.task_chat_cycles(id),ADD COLUMN cycle_position integer;
ALTER TABLE app_private.task_operational_conversations ADD COLUMN active_cycle_id uuid REFERENCES public.task_chat_cycles(id);
INSERT INTO public.task_chat_cycles(conversation_id,workspace_id,created_by,state,begin_key)
 SELECT id,workspace_id,created_by,'historical',gen_random_uuid() FROM public.task_conversations;
UPDATE public.task_messages m SET cycle_id=c.id FROM public.task_chat_cycles c WHERE c.conversation_id=m.conversation_id AND c.state='historical';
UPDATE public.task_drafts d SET cycle_id=c.id,original_cycle_id=c.id FROM public.task_chat_cycles c WHERE c.conversation_id=d.conversation_id AND c.state='historical';
CREATE INDEX task_chat_message_window ON public.task_messages(conversation_id,cycle_id,created_at,id);
CREATE INDEX task_chat_draft_window ON public.task_drafts(conversation_id,cycle_id,position);

CREATE FUNCTION public.task_current_cycle(p_conversation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;BEGIN
 IF NOT public.task_owns_conversation(p_conversation) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT to_jsonb(c) INTO result FROM app_private.task_operational_conversations o JOIN public.task_chat_cycles c ON c.id=o.active_cycle_id
 WHERE o.conversation_id=p_conversation AND o.user_id=auth.uid();RETURN result;
END $$;
CREATE FUNCTION public.task_prepare_cycle(p_conversation uuid,p_expected uuid,p_request uuid) RETURNS public.task_chat_cycles LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE conv public.task_conversations;c public.task_chat_cycles;m public.task_messages;BEGIN
 IF NOT public.task_owns_conversation(p_conversation) OR p_request IS NULL THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO conv FROM public.task_conversations WHERE id=p_conversation FOR UPDATE;
 SELECT cy.* INTO c FROM app_private.task_operational_conversations o JOIN public.task_chat_cycles cy ON cy.id=o.active_cycle_id WHERE o.conversation_id=p_conversation AND o.user_id=auth.uid();
 SELECT * INTO m FROM public.task_messages WHERE conversation_id=p_conversation AND role='user' AND request_key=p_request;
 IF m.id IS NOT NULL THEN
  IF m.cycle_id IS DISTINCT FROM c.id THEN RAISE EXCEPTION 'CYCLE_CHANGED' USING ERRCODE='PT409';END IF;RETURN c;
 END IF;
 IF c.id IS NOT NULL AND c.state='active' THEN
  IF p_expected IS DISTINCT FROM c.id AND c.begin_key<>p_request THEN RAISE EXCEPTION 'CYCLE_CHANGED' USING ERRCODE='PT409';END IF;RETURN c;
 END IF;
 IF p_expected IS DISTINCT FROM c.id THEN RAISE EXCEPTION 'CYCLE_CHANGED' USING ERRCODE='PT409';END IF;
 INSERT INTO public.task_chat_cycles(conversation_id,workspace_id,created_by,begin_key) VALUES(conv.id,conv.workspace_id,auth.uid(),p_request) RETURNING * INTO c;
 UPDATE app_private.task_operational_conversations SET active_cycle_id=c.id WHERE conversation_id=conv.id AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'OPERATIONAL_CONVERSATION_REQUIRED' USING ERRCODE='42501';END IF;RETURN c;
END $$;
CREATE FUNCTION app_private.task_require_cycle(p_cycle uuid) RETURNS public.task_chat_cycles LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.task_chat_cycles;BEGIN
 SELECT cy.* INTO c FROM public.task_chat_cycles cy JOIN app_private.task_operational_conversations o ON o.active_cycle_id=cy.id AND o.user_id=auth.uid()
 WHERE cy.id=p_cycle AND cy.created_by=auth.uid() AND cy.state='active';
 IF c.id IS NULL OR NOT public.task_owns_conversation(c.conversation_id) THEN RAISE EXCEPTION 'CYCLE_CHANGED' USING ERRCODE='PT409';END IF;RETURN c;
END $$;
CREATE FUNCTION public.task_post_cycle_message(p_cycle uuid,p_request uuid,p_content text) RETURNS public.task_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.task_chat_cycles;m public.task_messages;BEGIN
 SELECT * INTO c FROM public.task_chat_cycles WHERE id=p_cycle AND created_by=auth.uid();
 IF c.id IS NULL OR NOT public.task_owns_conversation(c.conversation_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.task_conversations WHERE id=c.conversation_id FOR UPDATE;
 SELECT * INTO m FROM public.task_messages WHERE conversation_id=c.conversation_id AND role='user' AND request_key=p_request;
 IF m.id IS NOT NULL THEN IF m.cycle_id<>c.id THEN RAISE EXCEPTION 'CYCLE_CHANGED' USING ERRCODE='PT409';END IF;RETURN m;END IF;
 PERFORM app_private.task_require_cycle(p_cycle);
 m:=public.task_post_message(c.conversation_id,p_request,p_content);
 UPDATE public.task_messages SET cycle_id=p_cycle WHERE id=m.id RETURNING * INTO m;RETURN m;
END $$;
CREATE FUNCTION public.task_save_cycle_draft(p_cycle uuid,p_id uuid,p_version integer,p_payload jsonb,p_target uuid DEFAULT NULL) RETURNS public.task_drafts LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.task_chat_cycles;d public.task_drafts;BEGIN
 c:=app_private.task_require_cycle(p_cycle);PERFORM 1 FROM public.task_conversations WHERE id=c.conversation_id FOR UPDATE;
 PERFORM app_private.task_require_cycle(p_cycle);
 SELECT * INTO d FROM public.task_drafts WHERE id=p_id;
 IF d.id IS NOT NULL AND d.cycle_id IS DISTINCT FROM c.id THEN RAISE EXCEPTION 'CYCLE_CHANGED' USING ERRCODE='PT409';END IF;
 d:=public.task_save_draft(c.conversation_id,p_id,p_version,p_payload,p_target);
 UPDATE public.task_drafts SET cycle_id=c.id,original_cycle_id=coalesce(original_cycle_id,c.id),batch_id=c.id,cycle_position=coalesce(cycle_position,(SELECT coalesce(max(cycle_position),0)+1 FROM public.task_drafts WHERE cycle_id=c.id)) WHERE id=d.id RETURNING * INTO d;RETURN d;
END $$;
CREATE FUNCTION public.task_resume_cycle_draft(p_cycle uuid,p_draft uuid,p_version integer) RETURNS public.task_drafts LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.task_chat_cycles;d public.task_drafts;BEGIN
 c:=app_private.task_require_cycle(p_cycle);PERFORM 1 FROM public.task_conversations WHERE id=c.conversation_id FOR UPDATE;
 PERFORM app_private.task_require_cycle(p_cycle);
 SELECT * INTO d FROM public.task_drafts WHERE id=p_draft AND conversation_id=c.conversation_id FOR UPDATE;
 IF d.id IS NULL OR NOT public.task_owns_draft(d.id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF d.confirmed_task_id IS NOT NULL OR d.version<>p_version THEN RAISE EXCEPTION 'DRAFT_ALREADY_CHANGED' USING ERRCODE='PT409';END IF;
 UPDATE public.task_drafts SET cycle_id=c.id,original_cycle_id=coalesce(original_cycle_id,d.cycle_id),cycle_position=(SELECT coalesce(max(cycle_position),0)+1 FROM public.task_drafts WHERE cycle_id=c.id),version=version+1,updated_at=now() WHERE id=d.id RETURNING * INTO d;
 INSERT INTO public.task_events(workspace_id,draft_id,actor_id,kind,details) VALUES(c.workspace_id,d.id,auth.uid(),'draft_resumed',jsonb_build_object('cycle_id',c.id,'version',d.version));RETURN d;
END $$;
CREATE FUNCTION public.task_confirm_cycle(p_cycle uuid,p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.task_chat_cycles;result jsonb;message_key uuid;count_items integer;BEGIN
 SELECT * INTO c FROM public.task_chat_cycles WHERE id=p_cycle AND created_by=auth.uid();
 IF c.id IS NULL OR NOT public.task_owns_conversation(c.conversation_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.task_conversations WHERE id=c.conversation_id FOR UPDATE;
 IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_BATCH' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) item LEFT JOIN public.task_drafts d ON d.id=(item->>'id')::uuid WHERE d.id IS NULL OR d.cycle_id<>c.id) THEN RAISE EXCEPTION 'CYCLE_CHANGED' USING ERRCODE='PT409';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) item JOIN public.task_drafts d ON d.id=(item->>'id')::uuid WHERE d.confirmed_task_id IS NULL) THEN PERFORM app_private.task_require_cycle(c.id);END IF;
 result:=public.task_confirm_batch(c.conversation_id,p_items);count_items:=jsonb_array_length(result);
 message_key:=md5('task-cycle-confirm:'||c.id::text||':'||(SELECT jsonb_agg(value ORDER BY value->>'id')::text FROM jsonb_array_elements(p_items)))::uuid;
 INSERT INTO public.task_messages(workspace_id,conversation_id,cycle_id,role,content,request_key,result)
 VALUES(c.workspace_id,c.conversation_id,c.id,'assistant',CASE WHEN count_items=1 THEN 'Pronto, a tarefa foi encaminhada.' ELSE 'Pronto, as '||count_items||' tarefas foram encaminhadas.' END,message_key,jsonb_build_object('confirmation',true,'count',count_items))
 ON CONFLICT(conversation_id,role,request_key) DO NOTHING;
 IF c.state='active' AND NOT EXISTS(SELECT 1 FROM public.task_drafts WHERE cycle_id=c.id AND (confirmed_task_id IS NULL OR confirmed_version IS DISTINCT FROM version)) THEN
  UPDATE public.task_chat_cycles SET state='completed',completed_at=coalesce(completed_at,now()) WHERE id=c.id AND state<>'historical' RETURNING * INTO c;
 END IF;
 RETURN jsonb_build_object('items',result,'cycle_id',c.id,'completed_at',c.completed_at);
END $$;

CREATE FUNCTION app_private.task_chat_matches(p_text text,p_query text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT btrim(coalesce(p_query,''))='' OR to_tsvector('portuguese',coalesce(p_text,'')) @@ websearch_to_tsquery('portuguese',p_query) OR position(lower(p_query) in lower(coalesce(p_text,'')))>0;
$$;
CREATE FUNCTION app_private.task_chat_records(p_conversation uuid,p_kind text,p_ids uuid[] DEFAULT NULL,p_query text DEFAULT '',p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_limit integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;BEGIN
 IF NOT public.task_owns_conversation(p_conversation) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF p_kind='tasks' THEN
  SELECT coalesce(jsonb_agg(data ORDER BY stamp DESC,id),'[]') INTO result FROM (
   SELECT DISTINCT t.id,to_jsonb(t)||jsonb_build_object('can_edit',public.task_can_edit(t.id)) data,t.created_at stamp
   FROM public.task_drafts d JOIN public.tasks t ON t.id=d.confirmed_task_id WHERE d.conversation_id=p_conversation AND public.task_can_read(t.id)
   AND (p_ids IS NULL OR t.id=ANY(p_ids)) AND app_private.task_chat_matches(concat_ws(' ',t.title,t.description,t.operational_code),p_query)
   AND (p_from IS NULL OR (t.created_at AT TIME ZONE 'America/Sao_Paulo')::date>=p_from) AND (p_to IS NULL OR (t.created_at AT TIME ZONE 'America/Sao_Paulo')::date<=p_to)
   ORDER BY stamp DESC,t.id LIMIT least(greatest(p_limit,1),10)) records;
 ELSIF p_kind='drafts' THEN
  SELECT coalesce(jsonb_agg(data ORDER BY stamp DESC,id),'[]') INTO result FROM (
   SELECT d.id,to_jsonb(d) data,d.updated_at stamp FROM public.task_drafts d WHERE d.conversation_id=p_conversation AND public.task_owns_draft(d.id)
   AND (p_ids IS NOT NULL OR d.confirmed_task_id IS NULL) AND (p_ids IS NULL OR d.id=ANY(p_ids))
   AND app_private.task_chat_matches(concat_ws(' ',d.payload->>'title',d.payload->>'description',d.payload->>'operational_code'),p_query)
   AND (p_from IS NULL OR (d.created_at AT TIME ZONE 'America/Sao_Paulo')::date>=p_from) AND (p_to IS NULL OR (d.created_at AT TIME ZONE 'America/Sao_Paulo')::date<=p_to)
   ORDER BY d.updated_at DESC,d.id LIMIT least(greatest(p_limit,1),10)) records;
 ELSIF p_kind='messages' THEN
  SELECT coalesce(jsonb_agg(data ORDER BY stamp,id),'[]') INTO result FROM (
   SELECT m.id,jsonb_build_object('id',m.id,'role',m.role,'content',m.content,'created_at',m.created_at) data,m.created_at stamp FROM public.task_messages m
   WHERE m.conversation_id=p_conversation AND (p_ids IS NULL OR m.id=ANY(p_ids))
   AND (p_ids IS NOT NULL OR m.cycle_id IS DISTINCT FROM (SELECT active_cycle_id FROM app_private.task_operational_conversations WHERE conversation_id=p_conversation AND user_id=auth.uid()))
   AND app_private.task_chat_matches(m.content,p_query) AND (p_from IS NULL OR (m.created_at AT TIME ZONE 'America/Sao_Paulo')::date>=p_from) AND (p_to IS NULL OR (m.created_at AT TIME ZONE 'America/Sao_Paulo')::date<=p_to)
   ORDER BY m.created_at DESC,m.id LIMIT least(greatest(p_limit,1),10)) records;
 ELSE RAISE EXCEPTION 'INVALID_HISTORY_KIND' USING ERRCODE='22023';END IF;RETURN result;
END $$;
CREATE FUNCTION public.task_history_lookup(p_conversation uuid,p_kind text,p_query text DEFAULT '',p_from text DEFAULT '',p_to text DEFAULT '',p_limit integer DEFAULT 5) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF length(coalesce(p_query,''))>200 OR p_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'INVALID_HISTORY_QUERY' USING ERRCODE='22023';END IF;
 RETURN app_private.task_chat_records(p_conversation,p_kind,NULL,p_query,nullif(p_from,'')::date,nullif(p_to,'')::date,p_limit);
END $$;
CREATE FUNCTION public.task_history_records(p_conversation uuid,p_kind text,p_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF cardinality(p_ids) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'INVALID_HISTORY_QUERY' USING ERRCODE='22023';END IF;
 RETURN app_private.task_chat_records(p_conversation,p_kind,p_ids,'',NULL,NULL,10);
END $$;

-- CYCLE_AI_ADAPTERS
CREATE OR REPLACE FUNCTION public.task_batch_context(p_conversation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.task_chat_cycles;result jsonb;BEGIN
 IF NOT public.task_owns_conversation(p_conversation) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT cy.* INTO c FROM app_private.task_operational_conversations o JOIN public.task_chat_cycles cy ON cy.id=o.active_cycle_id WHERE o.conversation_id=p_conversation AND o.user_id=auth.uid();
 IF c.id IS NULL THEN RAISE EXCEPTION 'CYCLE_REQUIRED' USING ERRCODE='PT409';END IF;
 SELECT jsonb_build_object('cycle_id',c.id,'revision',conv.draft_revision,
 'drafts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'version',d.version,'position',coalesce(d.cycle_position,d.position),'batch_id',d.batch_id,'payload',d.payload) ORDER BY d.position),'[]') FROM public.task_drafts d WHERE d.cycle_id=c.id AND d.confirmed_task_id IS NULL),
 'messages',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',m.role,'content',m.content) ORDER BY m.created_at,m.id),'[]') FROM (SELECT * FROM public.task_messages WHERE cycle_id=c.id ORDER BY created_at DESC,id DESC LIMIT 20) m)) INTO result FROM public.task_conversations conv WHERE id=p_conversation;RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.task_ai_batch_claim(p_user uuid,p_message uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.task_conversations;m public.task_messages;r app_private.task_ai_batch_runs;connection app_private.task_ai_connections;legacy uuid;BEGIN
 SELECT * INTO m FROM public.task_messages WHERE id=p_message AND role='user';
 SELECT * INTO c FROM public.task_conversations WHERE id=m.conversation_id AND created_by=p_user FOR UPDATE;
 IF c.id IS NULL OR NOT app_private.task_admin_board_actor(c.board_id,p_user) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT d.id INTO legacy FROM app_private.task_ai_runs old JOIN public.task_drafts d ON d.id=old.draft_id WHERE old.message_id=p_message AND old.actor_id=p_user;
 IF legacy IS NOT NULL THEN RETURN jsonb_build_object('state','complete','draft_ids',jsonb_build_array(legacy));END IF;
 SELECT * INTO r FROM app_private.task_ai_batch_runs WHERE message_id=p_message FOR UPDATE;
 IF FOUND AND r.actor_id<>p_user THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF r.state='complete' THEN RETURN r.result||jsonb_build_object('state','complete');END IF;
 IF NOT EXISTS(SELECT 1 FROM app_private.task_operational_conversations o JOIN public.task_chat_cycles cy ON cy.id=o.active_cycle_id WHERE o.conversation_id=c.id AND o.user_id=p_user AND cy.id=m.cycle_id AND cy.state='active') THEN RAISE EXCEPTION 'CYCLE_CHANGED' USING ERRCODE='PT409';END IF;
 IF EXISTS(SELECT 1 FROM app_private.task_ai_batch_runs b WHERE b.conversation_id=c.id AND b.state='pending' AND b.lease_until>now())
 THEN RAISE EXCEPTION 'AI_BUSY' USING ERRCODE='PT409';END IF;
 SELECT * INTO connection FROM app_private.task_ai_connections WHERE user_id=p_user AND workspace_id=c.workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_NOT_CONFIGURED' USING ERRCODE='22023';END IF;
 IF (connection.window_start>now()-interval '1 minute' AND connection.window_requests>=10) OR (connection.usage_day=current_date AND connection.day_requests>=100) THEN RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE='PT429';END IF;
 UPDATE app_private.task_ai_connections SET window_requests=CASE WHEN window_start>now()-interval '1 minute' THEN window_requests+1 ELSE 1 END,
 window_start=CASE WHEN window_start>now()-interval '1 minute' THEN window_start ELSE now() END,
 day_requests=CASE WHEN usage_day=current_date THEN day_requests+1 ELSE 1 END,usage_day=current_date WHERE user_id=p_user AND workspace_id=c.workspace_id;
 INSERT INTO app_private.task_ai_batch_runs(message_id,actor_id,workspace_id,conversation_id,batch_id,base_revision,lease_until,state)
 VALUES(m.id,p_user,c.workspace_id,c.id,coalesce((SELECT batch_id FROM public.task_drafts WHERE conversation_id=c.id AND cycle_id=m.cycle_id AND confirmed_task_id IS NULL ORDER BY position DESC LIMIT 1),gen_random_uuid()),c.draft_revision,now()+interval '120 seconds','pending')
 ON CONFLICT(message_id) DO UPDATE SET lease_id=gen_random_uuid(),lease_until=now()+interval '120 seconds',state='pending',base_revision=c.draft_revision RETURNING * INTO r;
 RETURN jsonb_build_object('state','pending','lease_id',r.lease_id,'revision',r.base_revision,'cycle_id',m.cycle_id);
END $$;
ALTER FUNCTION public.task_apply_interpretation(uuid,uuid,jsonb,text) RENAME TO task_apply_interpretation_before_cycles;
REVOKE ALL ON FUNCTION public.task_apply_interpretation_before_cycles(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.task_apply_interpretation(p_message uuid,p_lease uuid,p_changes jsonb,p_reply text,p_history jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.task_messages;cy public.task_chat_cycles;h_ids uuid[];h_records jsonb;c public.task_conversations;r app_private.task_ai_batch_runs;item jsonb;d public.task_drafts;ids jsonb:='[]';seen uuid[]:='{}';v_id uuid;v integer;v_result jsonb;BEGIN
 SELECT * INTO m FROM public.task_messages WHERE id=p_message AND role='user';
 SELECT conv.* INTO c FROM public.task_messages m JOIN public.task_conversations conv ON conv.id=m.conversation_id WHERE m.id=p_message;
 IF c.created_by IS DISTINCT FROM auth.uid() OR NOT public.task_owns_conversation(c.id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.task_conversations WHERE id=c.id FOR UPDATE;
 cy:=app_private.task_require_cycle(m.cycle_id);
 SELECT * INTO r FROM app_private.task_ai_batch_runs WHERE message_id=p_message AND actor_id=auth.uid() AND lease_id=p_lease FOR UPDATE;
 IF r.message_id IS NULL THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF r.state='complete' THEN RETURN r.result;END IF;
 IF r.state<>'pending' OR r.lease_until<now() OR r.base_revision<>(SELECT draft_revision FROM public.task_conversations WHERE id=c.id) THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
 IF p_changes IS NULL OR jsonb_typeof(p_changes)<>'array' OR jsonb_array_length(p_changes)>30 OR length(p_changes::text)>180000 OR p_reply IS NULL OR length(p_reply)>1200 OR btrim(p_reply)='' THEN RAISE EXCEPTION 'INVALID_BATCH' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  v_id:=nullif(item->>'draft_id','')::uuid;v:=(item->>'version')::integer;
  IF v IS NULL OR v<0 THEN RAISE EXCEPTION 'INVALID_VERSION' USING ERRCODE='22023';END IF;
  IF v_id IS NOT NULL THEN
   SELECT * INTO d FROM public.task_drafts WHERE task_drafts.id=v_id AND conversation_id=c.id AND cycle_id=cy.id AND confirmed_task_id IS NULL;
   IF d.id IS NULL OR d.version<>v OR v_id=ANY(seen) THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
   seen:=array_append(seen,v_id);
  ELSE
   IF v<>0 THEN RAISE EXCEPTION 'INVALID_BATCH' USING ERRCODE='22023';END IF;
   v_id:=gen_random_uuid();d:=NULL;
  END IF;
  d:=public.task_save_draft(c.id,v_id,v,item->'payload',d.target_task_id);
  UPDATE public.task_drafts SET cycle_id=cy.id,original_cycle_id=coalesce(original_cycle_id,cy.id),cycle_position=coalesce(cycle_position,(SELECT coalesce(max(cycle_position),0)+1 FROM public.task_drafts WHERE cycle_id=cy.id)),batch_id=cy.id,source_message_id=coalesce(source_message_id,p_message) WHERE task_drafts.id=v_id;
  ids:=ids||jsonb_build_array(v_id);
 END LOOP;
 IF p_history IS NOT NULL THEN
  IF p_history->>'kind' NOT IN('tasks','drafts','messages') OR p_history->>'intent' NOT IN('view','resume','revise') OR jsonb_typeof(p_history->'ids')<>'array' OR jsonb_array_length(p_history->'ids')>10 THEN RAISE EXCEPTION 'INVALID_HISTORY_QUERY' USING ERRCODE='22023';END IF;
  SELECT array_agg(value::uuid) INTO h_ids FROM jsonb_array_elements_text(p_history->'ids');
  IF coalesce(cardinality(h_ids),0)>0 THEN
   h_records:=app_private.task_chat_records(c.id,p_history->>'kind',h_ids);
   IF jsonb_array_length(h_records)<>cardinality(h_ids) THEN RAISE EXCEPTION 'HISTORY_CHANGED' USING ERRCODE='PT409';END IF;
  END IF;
  IF p_history->>'intent'='view' AND p_history->>'resolved'='true' AND NOT EXISTS(SELECT 1 FROM public.task_drafts WHERE cycle_id=cy.id AND confirmed_task_id IS NULL) THEN
   UPDATE public.task_chat_cycles SET state='completed',completed_at=now() WHERE id=cy.id;
  END IF;
 END IF;
 INSERT INTO public.task_messages(workspace_id,conversation_id,cycle_id,role,content,request_key,result)
 VALUES(c.workspace_id,c.id,cy.id,'assistant',btrim(p_reply),p_message,jsonb_build_object('draft_ids',ids,'source_message_id',p_message,'history',p_history))
 ON CONFLICT(conversation_id,role,request_key) DO NOTHING;
 v_result:=jsonb_build_object('draft_ids',ids,'batch_id',cy.id,'cycle_id',cy.id);
 UPDATE app_private.task_ai_batch_runs SET state='complete',result=v_result WHERE message_id=p_message;
 RETURN v_result;
END $$;
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure sig,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
 (n.nspname='public' AND p.proname IN('task_current_cycle','task_prepare_cycle','task_post_cycle_message','task_save_cycle_draft','task_resume_cycle_draft','task_confirm_cycle','task_history_lookup','task_history_records','task_apply_interpretation'))
 OR(n.nspname='app_private' AND p.proname IN('task_require_cycle','task_chat_matches','task_chat_records')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 IF f.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.sig);END IF;END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
