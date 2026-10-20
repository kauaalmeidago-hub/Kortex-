-- Collections preserve the original draft/task identities and the protected provider connection.
ALTER TABLE public.task_conversations ADD COLUMN draft_revision integer NOT NULL DEFAULT 0;
ALTER TABLE public.task_drafts ADD COLUMN batch_id uuid, ADD COLUMN source_message_id uuid REFERENCES public.task_messages(id), ADD COLUMN position integer;
WITH numbered AS (SELECT id,row_number() OVER(PARTITION BY conversation_id ORDER BY created_at,id)::integer n FROM public.task_drafts)
UPDATE public.task_drafts d SET batch_id=conversation_id,position=n.n FROM numbered n WHERE n.id=d.id;
ALTER TABLE public.task_drafts ALTER COLUMN batch_id SET NOT NULL,ALTER COLUMN position SET NOT NULL;
CREATE UNIQUE INDEX task_draft_conversation_position ON public.task_drafts(conversation_id,position);

CREATE FUNCTION app_private.task_draft_collection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM public.task_conversations WHERE id=NEW.conversation_id FOR UPDATE;
  NEW.position:=coalesce((SELECT max(position)+1 FROM public.task_drafts WHERE conversation_id=NEW.conversation_id),1);
  NEW.batch_id:=coalesce(NEW.batch_id,(SELECT batch_id FROM public.task_drafts WHERE conversation_id=NEW.conversation_id AND confirmed_task_id IS NULL ORDER BY position DESC LIMIT 1),gen_random_uuid());
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER task_draft_collection BEFORE INSERT ON public.task_drafts FOR EACH ROW EXECUTE FUNCTION app_private.task_draft_collection();
CREATE FUNCTION app_private.task_draft_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN UPDATE public.task_conversations SET draft_revision=draft_revision+1 WHERE id=NEW.conversation_id;RETURN NEW;END $$;
CREATE TRIGGER task_draft_revision AFTER INSERT OR UPDATE ON public.task_drafts FOR EACH ROW EXECUTE FUNCTION app_private.task_draft_revision();

-- All edit/confirmation paths use the same lock order, including legacy single-item clients.
ALTER FUNCTION public.task_save_draft(uuid,uuid,integer,jsonb,uuid) RENAME TO task_save_draft_before_batches;
REVOKE ALL ON FUNCTION public.task_save_draft_before_batches(uuid,uuid,integer,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.task_save_draft(p_conversation uuid,p_id uuid,p_version integer,p_payload jsonb,p_target uuid DEFAULT NULL) RETURNS public.task_drafts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF p_version IS NULL OR p_version<0 THEN RAISE EXCEPTION 'INVALID_VERSION' USING ERRCODE='22023';END IF;
 IF NOT public.task_owns_conversation(p_conversation) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.task_conversations WHERE id=p_conversation FOR UPDATE;
 RETURN public.task_save_draft_before_batches(p_conversation,p_id,p_version,p_payload,p_target);
END $$;
ALTER FUNCTION public.task_confirm_draft(uuid,integer) RENAME TO task_confirm_draft_before_batches;
REVOKE ALL ON FUNCTION public.task_confirm_draft_before_batches(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.task_confirm_draft(p_id uuid,p_version integer) RETURNS public.tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE conv uuid;BEGIN
 SELECT conversation_id INTO conv FROM public.task_drafts WHERE id=p_id;
 IF NOT public.task_owns_conversation(conv) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.task_conversations WHERE id=conv FOR UPDATE;
 RETURN public.task_confirm_draft_before_batches(p_id,p_version);
END $$;
CREATE FUNCTION public.task_confirm_batch(p_conversation uuid,p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;d public.task_drafts;t public.tasks;result jsonb:='[]';BEGIN
 IF NOT public.task_owns_conversation(p_conversation) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100
 OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items)
 THEN RAISE EXCEPTION 'INVALID_BATCH' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.task_conversations WHERE id=p_conversation FOR UPDATE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'id' LOOP
  IF item->>'version' IS NULL OR (item->>'version')::integer<1 THEN RAISE EXCEPTION 'INVALID_VERSION' USING ERRCODE='22023';END IF;
  SELECT * INTO d FROM public.task_drafts WHERE id=(item->>'id')::uuid AND conversation_id=p_conversation FOR UPDATE;
  IF d.id IS NULL OR NOT public.task_owns_draft(d.id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  IF d.version<>(item->>'version')::integer THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
  t:=public.task_confirm_draft(d.id,(item->>'version')::integer);
  result:=result||jsonb_build_array(jsonb_build_object('draft_id',d.id,'task_id',t.id));
 END LOOP;RETURN result;
END $$;

CREATE TABLE app_private.task_ai_batch_runs(
 message_id uuid PRIMARY KEY REFERENCES public.task_messages(id),actor_id uuid NOT NULL REFERENCES auth.users(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),conversation_id uuid NOT NULL REFERENCES public.task_conversations(id),
 batch_id uuid NOT NULL,base_revision integer NOT NULL,lease_id uuid NOT NULL DEFAULT gen_random_uuid(),lease_until timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN('pending','complete','failed')),result jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.task_ai_batch_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.task_ai_batch_runs FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION app_private.task_admin_board_actor(p_board uuid,p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.business_boards b
 JOIN public.task_sector_members sm ON sm.workspace_id=b.workspace_id AND sm.sector_id=b.sector_id AND sm.user_id=p_user AND sm.active AND sm.can_dispatch
 LEFT JOIN public.business_board_members bm ON bm.board_id=b.id AND bm.user_id=p_user AND bm.active
 WHERE b.id=p_board AND b.kind='tasks' AND NOT b.archived AND b.visibility<>'restricted'
 AND app_private.task_admin_actor(b.workspace_id,p_user) AND app_private.member(b.workspace_id,b.sector_id,p_user)
 AND (b.owner_id=p_user OR coalesce(bm.can_write,false) OR coalesce(bm.can_manage,false)));
$$;
CREATE FUNCTION public.task_batch_context(p_conversation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE result jsonb;BEGIN
 IF NOT public.task_owns_conversation(p_conversation) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('revision',c.draft_revision,
 'drafts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'version',d.version,'position',d.position,'batch_id',d.batch_id,'payload',d.payload) ORDER BY d.position),'[]') FROM public.task_drafts d WHERE d.conversation_id=c.id AND d.confirmed_task_id IS NULL),
 'messages',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',m.role,'content',m.content) ORDER BY m.created_at,m.id),'[]') FROM (SELECT * FROM public.task_messages WHERE conversation_id=c.id ORDER BY created_at DESC,id DESC LIMIT 20) m))
 INTO result FROM public.task_conversations c WHERE c.id=p_conversation;RETURN result;
END $$;
CREATE FUNCTION public.task_ai_batch_claim(p_user uuid,p_message uuid) RETURNS jsonb
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
 IF EXISTS(SELECT 1 FROM app_private.task_ai_batch_runs b WHERE b.conversation_id=c.id AND b.state='pending' AND b.lease_until>now())
 THEN RAISE EXCEPTION 'AI_BUSY' USING ERRCODE='PT409';END IF;
 SELECT * INTO connection FROM app_private.task_ai_connections WHERE user_id=p_user AND workspace_id=c.workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_NOT_CONFIGURED' USING ERRCODE='22023';END IF;
 IF (connection.window_start>now()-interval '1 minute' AND connection.window_requests>=10) OR (connection.usage_day=current_date AND connection.day_requests>=100) THEN RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE='PT429';END IF;
 UPDATE app_private.task_ai_connections SET window_requests=CASE WHEN window_start>now()-interval '1 minute' THEN window_requests+1 ELSE 1 END,
 window_start=CASE WHEN window_start>now()-interval '1 minute' THEN window_start ELSE now() END,
 day_requests=CASE WHEN usage_day=current_date THEN day_requests+1 ELSE 1 END,usage_day=current_date WHERE user_id=p_user AND workspace_id=c.workspace_id;
 INSERT INTO app_private.task_ai_batch_runs(message_id,actor_id,workspace_id,conversation_id,batch_id,base_revision,lease_until,state)
 VALUES(m.id,p_user,c.workspace_id,c.id,coalesce((SELECT batch_id FROM public.task_drafts WHERE conversation_id=c.id AND confirmed_task_id IS NULL ORDER BY position DESC LIMIT 1),gen_random_uuid()),c.draft_revision,now()+interval '120 seconds','pending')
 ON CONFLICT(message_id) DO UPDATE SET lease_id=gen_random_uuid(),lease_until=now()+interval '120 seconds',state='pending',base_revision=c.draft_revision RETURNING * INTO r;
 RETURN jsonb_build_object('state','pending','lease_id',r.lease_id,'revision',r.base_revision);
END $$;
CREATE FUNCTION public.task_apply_interpretation(p_message uuid,p_lease uuid,p_changes jsonb,p_reply text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.task_conversations;r app_private.task_ai_batch_runs;item jsonb;d public.task_drafts;ids jsonb:='[]';seen uuid[]:='{}';v_id uuid;v integer;v_result jsonb;BEGIN
 SELECT conv.* INTO c FROM public.task_messages m JOIN public.task_conversations conv ON conv.id=m.conversation_id WHERE m.id=p_message;
 IF c.created_by IS DISTINCT FROM auth.uid() OR NOT public.task_owns_conversation(c.id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.task_conversations WHERE id=c.id FOR UPDATE;
 SELECT * INTO r FROM app_private.task_ai_batch_runs WHERE message_id=p_message AND actor_id=auth.uid() AND lease_id=p_lease FOR UPDATE;
 IF r.message_id IS NULL THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF r.state='complete' THEN RETURN r.result;END IF;
 IF r.state<>'pending' OR r.lease_until<now() OR r.base_revision<>(SELECT draft_revision FROM public.task_conversations WHERE id=c.id) THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
 IF p_changes IS NULL OR jsonb_typeof(p_changes)<>'array' OR jsonb_array_length(p_changes)>30 OR length(p_changes::text)>180000 OR p_reply IS NULL OR length(p_reply)>1200 OR btrim(p_reply)='' THEN RAISE EXCEPTION 'INVALID_BATCH' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  v_id:=nullif(item->>'draft_id','')::uuid;v:=(item->>'version')::integer;
  IF v IS NULL OR v<0 THEN RAISE EXCEPTION 'INVALID_VERSION' USING ERRCODE='22023';END IF;
  IF v_id IS NOT NULL THEN
   SELECT * INTO d FROM public.task_drafts WHERE task_drafts.id=v_id AND conversation_id=c.id AND confirmed_task_id IS NULL;
   IF d.id IS NULL OR d.version<>v OR v_id=ANY(seen) THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
   seen:=array_append(seen,v_id);
  ELSE
   IF v<>0 THEN RAISE EXCEPTION 'INVALID_BATCH' USING ERRCODE='22023';END IF;
   v_id:=gen_random_uuid();d:=NULL;
  END IF;
  d:=public.task_save_draft(c.id,v_id,v,item->'payload',d.target_task_id);
  UPDATE public.task_drafts SET batch_id=r.batch_id,source_message_id=coalesce(source_message_id,p_message) WHERE task_drafts.id=v_id;
  ids:=ids||jsonb_build_array(v_id);
 END LOOP;
 INSERT INTO public.task_messages(workspace_id,conversation_id,role,content,request_key,result)
 VALUES(c.workspace_id,c.id,'assistant',btrim(p_reply),p_message,jsonb_build_object('draft_ids',ids,'source_message_id',p_message))
 ON CONFLICT(conversation_id,role,request_key) DO NOTHING;
 v_result:=jsonb_build_object('draft_ids',ids,'batch_id',r.batch_id);
 UPDATE app_private.task_ai_batch_runs SET state='complete',result=v_result WHERE message_id=p_message;
 RETURN v_result;
END $$;
CREATE FUNCTION public.task_ai_batch_fail(p_user uuid,p_message uuid,p_lease uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN UPDATE app_private.task_ai_batch_runs SET state='failed' WHERE actor_id=p_user AND message_id=p_message AND lease_id=p_lease AND state='pending';END $$;
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure sig,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
 (n.nspname='public' AND p.proname IN('task_confirm_batch','task_batch_context','task_ai_batch_claim','task_ai_batch_fail','task_apply_interpretation','task_save_draft','task_confirm_draft'))
 OR (n.nspname='app_private' AND p.proname IN('task_draft_collection','task_draft_revision','task_admin_board_actor')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 IF f.nspname='public' THEN
  IF f.proname IN('task_ai_batch_claim','task_ai_batch_fail') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
  ELSE EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.sig);END IF;
 END IF;END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
