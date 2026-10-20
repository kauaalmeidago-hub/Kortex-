-- One private operational conversation per actor and organization. Historical
-- conversations are retained intact; selection is atomic across tabs/devices.
CREATE TABLE app_private.task_operational_conversations (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 conversation_id uuid NOT NULL UNIQUE REFERENCES public.task_conversations(id),
 PRIMARY KEY(user_id,workspace_id)
);
ALTER TABLE app_private.task_operational_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.task_operational_conversations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.task_operational_conversation(p_board uuid) RETURNS public.task_conversations
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;c public.task_conversations;v_id uuid;BEGIN
 SELECT * INTO b FROM public.business_boards WHERE id=p_board AND kind='tasks';
 IF b.id IS NULL OR NOT public.task_admin_access(b.id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||b.workspace_id::text||':task-operational',0));
 SELECT conversation_id INTO v_id FROM app_private.task_operational_conversations WHERE user_id=auth.uid() AND workspace_id=b.workspace_id;
 IF v_id IS NULL THEN
  -- Preserve pending work when adopting one existing authorized history.
  SELECT conv.id INTO v_id FROM public.task_conversations conv
  WHERE conv.created_by=auth.uid() AND conv.workspace_id=b.workspace_id AND public.task_owns_conversation(conv.id)
  ORDER BY EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.conversation_id=conv.id AND d.confirmed_task_id IS NULL) DESC,conv.created_at DESC,conv.id LIMIT 1;
  IF v_id IS NULL THEN c:=public.business_start_conversation(b.id,gen_random_uuid());v_id:=c.id;END IF;
  INSERT INTO app_private.task_operational_conversations VALUES(auth.uid(),b.workspace_id,v_id);
 END IF;
 IF NOT public.task_owns_conversation(v_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM public.task_conversations WHERE id=v_id AND created_by=auth.uid() AND workspace_id=b.workspace_id;
 RETURN c;
END $$;
REVOKE ALL ON FUNCTION public.task_operational_conversation(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.task_operational_conversation(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
