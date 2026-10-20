-- Remove only an unconfirmed attachment owned by the current administrator.
-- Updating the draft invalidates any interpretation concurrently using its old files.
CREATE FUNCTION public.task_remove_attachment(p_draft uuid,p_id uuid,p_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.task_drafts;a public.task_attachments;BEGIN
 IF NOT public.task_owns_draft(p_draft) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM public.task_drafts WHERE id=p_draft;
 PERFORM 1 FROM public.task_conversations WHERE id=d.conversation_id FOR UPDATE;
 SELECT * INTO d FROM public.task_drafts WHERE id=p_draft FOR UPDATE;
 IF d.confirmed_task_id IS NOT NULL THEN RAISE EXCEPTION 'TASK_ALREADY_CONFIRMED' USING ERRCODE='PT409';END IF;
 IF d.cycle_id IS NOT NULL THEN PERFORM app_private.task_require_cycle(d.cycle_id);END IF;
 SELECT * INTO a FROM public.task_attachments WHERE id=p_id AND draft_id=d.id FOR UPDATE;
 IF a.id IS NULL THEN RETURN jsonb_build_object('path',NULL,'version',d.version);END IF;
 IF a.task_id IS NOT NULL OR p_version IS NULL OR p_version<>d.version THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
 DELETE FROM public.task_attachments WHERE id=a.id;
 UPDATE public.task_drafts SET version=version+1,updated_at=now() WHERE id=d.id RETURNING * INTO d;
 RETURN jsonb_build_object('path',a.storage_path,'version',d.version);
END $$;
REVOKE ALL ON FUNCTION public.task_remove_attachment(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.task_remove_attachment(uuid,uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
