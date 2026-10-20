-- The same immutable receipt applies to an explicitly reviewed reassignment of
-- an existing task. It reveals no current task fields or private attachments.
CREATE OR REPLACE FUNCTION app_private.task_dispatch_receipt(p_draft uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.task_drafts d JOIN public.task_conversations c ON c.id=d.conversation_id
 JOIN public.tasks t ON t.id=d.confirmed_task_id
 WHERE d.id=p_draft AND d.created_by=auth.uid() AND c.created_by=auth.uid()
 AND (d.target_task_id IS NULL OR d.target_task_id=d.confirmed_task_id)
 AND d.confirmed_version=d.version AND t.workspace_id=d.workspace_id
 AND t.board_id::text=d.payload->>'board_id' AND t.sector_id::text=d.payload->>'sector_id' AND t.deleted_at IS NULL
 AND public.task_admin_access(c.board_id) AND public.business_can_board(t.board_id,'dispatch'));
$$;
NOTIFY pgrst,'reload schema';
