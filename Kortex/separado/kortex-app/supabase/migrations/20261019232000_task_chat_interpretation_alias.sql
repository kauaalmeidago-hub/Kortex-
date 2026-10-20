-- Disambiguate the message table alias from the PL/pgSQL message record.
CREATE OR REPLACE FUNCTION public.task_apply_interpretation(p_message uuid,p_lease uuid,p_changes jsonb,p_reply text,p_history jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.task_messages;cy public.task_chat_cycles;h_ids uuid[];h_records jsonb;c public.task_conversations;r app_private.task_ai_batch_runs;item jsonb;d public.task_drafts;ids jsonb:='[]';seen uuid[]:='{}';v_id uuid;v integer;v_result jsonb;BEGIN
 SELECT * INTO m FROM public.task_messages WHERE id=p_message AND role='user';
 SELECT conv.* INTO c FROM public.task_messages source_message JOIN public.task_conversations conv ON conv.id=source_message.conversation_id WHERE source_message.id=p_message;
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
NOTIFY pgrst,'reload schema';
