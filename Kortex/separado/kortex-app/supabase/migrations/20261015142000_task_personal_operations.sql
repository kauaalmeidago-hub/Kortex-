CREATE FUNCTION public.task_save_personal(p_workspace uuid,p_request uuid,p_id uuid,p_updated timestamptz,p_payload jsonb)
RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tasks; p jsonb:=p_payload; BEGIN
 IF NOT public.task_recipient_active(p_workspace,auth.uid()) THEN RAISE EXCEPTION 'TASK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL THEN
  IF p_request IS NULL THEN RAISE EXCEPTION 'TASK_REQUEST_REQUIRED' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text||auth.uid()::text,0));
  SELECT * INTO t FROM public.tasks WHERE workspace_id=p_workspace AND created_by=auth.uid() AND request_key=p_request;
  IF FOUND THEN RETURN t; END IF;
  -- Explicitly reject forged identities even though only safe fields are mapped.
  IF (p ? 'assigned_to' AND p->>'assigned_to' IS DISTINCT FROM auth.uid()::text) OR
     (p ? 'created_by' AND p->>'created_by' IS DISTINCT FROM auth.uid()::text) OR nullif(p->>'sector_id','') IS NOT NULL THEN
   RAISE EXCEPTION 'TASK_SELF_ASSIGN_ONLY' USING ERRCODE='42501'; END IF;
  INSERT INTO public.tasks(workspace_id,title,description,company_id,operational_code,operator,project,due_date,priority,stage_id,created_by,assigned_to,request_key)
   VALUES(p_workspace,btrim(p->>'title'),nullif(p->>'description',''),nullif(p->>'company_id','')::uuid,nullif(p->>'operational_code',''),nullif(p->>'operator',''),nullif(p->>'project',''),
   CASE WHEN nullif(p->>'due_date','') IS NULL THEN NULL ELSE ((p->>'due_date')::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo' END,
   coalesce(nullif(p->>'priority',''),'medium')::public.task_priority,coalesce(nullif(p->>'stage_id',''),'todo'),auth.uid(),auth.uid(),p_request) RETURNING * INTO t;
 ELSE
  IF NOT public.task_can_edit(p_id) THEN RAISE EXCEPTION 'TASK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT t FROM public.tasks WHERE id=p_id AND workspace_id=p_workspace FOR UPDATE;
  IF t.updated_at IS DISTINCT FROM p_updated THEN RAISE EXCEPTION 'TASK_TARGET_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF (p ? 'assigned_to' AND p->>'assigned_to' IS DISTINCT FROM t.assigned_to::text) OR
    (p ? 'created_by' AND p->>'created_by' IS DISTINCT FROM t.created_by::text) OR
    (p ? 'sector_id' AND p->>'sector_id' IS DISTINCT FROM t.sector_id::text) THEN RAISE EXCEPTION 'TASK_ORIGIN_IMMUTABLE' USING ERRCODE='42501'; END IF;
  UPDATE public.tasks SET title=btrim(p->>'title'),description=nullif(p->>'description',''),company_id=nullif(p->>'company_id','')::uuid,
   operational_code=nullif(p->>'operational_code',''),operator=nullif(p->>'operator',''),project=nullif(p->>'project',''),
   due_date=CASE WHEN nullif(p->>'due_date','') IS NULL THEN NULL ELSE ((p->>'due_date')::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo' END,
   priority=coalesce(nullif(p->>'priority',''),'medium')::public.task_priority,stage_id=coalesce(nullif(p->>'stage_id',''),'todo') WHERE id=t.id RETURNING * INTO t;
 END IF;
 RETURN t;
END; $$;
REVOKE ALL ON FUNCTION public.task_save_personal(uuid,uuid,uuid,timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.task_save_personal(uuid,uuid,uuid,timestamptz,jsonb) TO authenticated,service_role;

CREATE FUNCTION public.task_save_stages(p_workspace uuid,p_stages jsonb) RETURNS SETOF public.task_stages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s jsonb; n integer:=0; BEGIN
 IF NOT public.is_workspace_admin(p_workspace,auth.uid()) THEN RAISE EXCEPTION 'TASK_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_stages)<>'array' OR jsonb_array_length(p_stages) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'TASK_INVALID_STAGE' USING ERRCODE='22023'; END IF;
 FOR s IN SELECT * FROM jsonb_array_elements(p_stages) LOOP
  INSERT INTO public.task_stages(workspace_id,id,name,color,position,base_status,archived)
   VALUES(p_workspace,s->>'id',s->>'name',coalesce(s->>'color','blue'),n,coalesce(s->>'base_status','todo')::public.task_status,coalesce((s->>'archived')::boolean,false))
   ON CONFLICT(workspace_id,id) DO UPDATE SET name=EXCLUDED.name,color=EXCLUDED.color,position=EXCLUDED.position,archived=EXCLUDED.archived;
  n:=n+1;
 END LOOP;
 -- Preserve stages and records omitted by an older client rather than deleting them.
 UPDATE public.task_stages SET archived=true WHERE workspace_id=p_workspace AND id NOT IN(SELECT e->>'id' FROM jsonb_array_elements(p_stages) e);
 RETURN QUERY SELECT * FROM public.task_stages WHERE workspace_id=p_workspace ORDER BY position,id;
END; $$;
REVOKE ALL ON FUNCTION public.task_save_stages(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.task_save_stages(uuid,jsonb) TO authenticated,service_role;
