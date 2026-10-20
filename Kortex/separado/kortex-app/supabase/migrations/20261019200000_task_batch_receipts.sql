-- A dispatcher can retain their immutable approved draft/receipt without reading
-- the assignee's current personal task, files or subsequent changes.
CREATE FUNCTION app_private.task_dispatch_receipt(p_draft uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.task_drafts d JOIN public.task_conversations c ON c.id=d.conversation_id
 JOIN public.tasks t ON t.id=d.confirmed_task_id
 WHERE d.id=p_draft AND d.created_by=auth.uid() AND c.created_by=auth.uid() AND d.target_task_id IS NULL
 AND d.confirmed_version=d.version AND t.workspace_id=d.workspace_id
 AND t.board_id::text=d.payload->>'board_id' AND t.sector_id::text=d.payload->>'sector_id' AND t.deleted_at IS NULL
 AND public.task_admin_access(c.board_id) AND public.business_can_board(t.board_id,'dispatch'));
$$;
REVOKE ALL ON FUNCTION app_private.task_dispatch_receipt(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.task_owns_conversation(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.task_conversations c WHERE c.id=p_id AND c.created_by=auth.uid() AND public.task_admin_access(c.board_id)
 AND NOT EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.conversation_id=c.id AND coalesce(d.confirmed_task_id,d.target_task_id) IS NOT NULL
 AND NOT public.task_can_read(coalesce(d.confirmed_task_id,d.target_task_id)) AND NOT app_private.task_dispatch_receipt(d.id)));
$$;
CREATE OR REPLACE FUNCTION public.task_owns_draft(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.id=p_id AND d.created_by=auth.uid() AND public.task_owns_conversation(d.conversation_id)
 AND (coalesce(d.confirmed_task_id,d.target_task_id) IS NULL OR public.task_can_read(coalesce(d.confirmed_task_id,d.target_task_id)) OR app_private.task_dispatch_receipt(d.id)));
$$;
CREATE OR REPLACE FUNCTION public.task_confirm_batch(p_conversation uuid,p_items jsonb) RETURNS jsonb
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
  IF d.confirmed_task_id IS NOT NULL AND d.confirmed_version=(item->>'version')::integer THEN
   -- Return the immutable receipt only, never the current private task contents.
   result:=result||jsonb_build_array(jsonb_build_object('draft_id',d.id,'task_id',d.confirmed_task_id));
  ELSE
   t:=public.task_confirm_draft(d.id,(item->>'version')::integer);
   result:=result||jsonb_build_array(jsonb_build_object('draft_id',d.id,'task_id',t.id));
  END IF;
 END LOOP;RETURN result;
END $$;
NOTIFY pgrst,'reload schema';
