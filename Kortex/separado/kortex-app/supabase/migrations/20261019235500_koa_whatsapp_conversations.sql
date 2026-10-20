-- Conversational pilot only. Task creation cannot be enabled by this release.
CREATE TABLE public.koa_whatsapp_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 board_id uuid NOT NULL UNIQUE REFERENCES public.business_boards(id),
 instance text NOT NULL, group_jid text NOT NULL CHECK(group_jid LIKE '%@g.us'),
 group_name text NOT NULL, participant_policy text NOT NULL DEFAULT 'group_members' CHECK(participant_policy='group_members'),
 conversations_enabled boolean NOT NULL DEFAULT false,
 tasks_enabled boolean NOT NULL DEFAULT false CHECK(NOT tasks_enabled),
 activated_at timestamptz NOT NULL DEFAULT now(),
 connection_state text NOT NULL DEFAULT 'unknown', phone_suffix text,
 heartbeat_at timestamptz, last_event_at timestamptz, last_reply_at timestamptz,
 received_count bigint NOT NULL DEFAULT 0, reply_count bigint NOT NULL DEFAULT 0,
 last_error_code text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,instance,group_jid)
);
ALTER TABLE public.koa_whatsapp_channels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.koa_whatsapp_channels FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.koa_whatsapp_channels TO service_role;

CREATE FUNCTION public.koa_whatsapp_status(p_board uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT public.task_admin_access(p_board) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 RETURN (SELECT jsonb_build_object('id',c.id,'group_name',c.group_name,
  'conversations_enabled',c.conversations_enabled,'tasks_enabled',c.tasks_enabled,
  'participant_policy',c.participant_policy,'connection_state',c.connection_state,
  'phone_suffix',c.phone_suffix,'heartbeat_at',c.heartbeat_at,'last_event_at',c.last_event_at,
  'last_reply_at',c.last_reply_at,'received_count',c.received_count,'reply_count',c.reply_count,
  'last_error_code',c.last_error_code)
 FROM public.koa_whatsapp_channels c JOIN public.business_boards b ON b.id=c.board_id AND b.workspace_id=c.workspace_id
 WHERE c.board_id=p_board AND c.actor_id=auth.uid() AND app_private.task_admin_actor(c.workspace_id,auth.uid()));
END;$$;
CREATE FUNCTION public.koa_whatsapp_conversations(p_board uuid,p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT public.task_admin_access(p_board) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 UPDATE public.koa_whatsapp_channels c SET conversations_enabled=p_enabled,
 activated_at=CASE WHEN p_enabled AND NOT c.conversations_enabled THEN now() ELSE c.activated_at END
 WHERE c.board_id=p_board AND c.actor_id=auth.uid() AND app_private.task_admin_actor(c.workspace_id,auth.uid())
 AND EXISTS(SELECT 1 FROM public.business_boards b WHERE b.id=c.board_id AND b.workspace_id=c.workspace_id AND NOT b.archived);
 IF NOT FOUND THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 RETURN public.koa_whatsapp_status(p_board);
END;$$;
REVOKE ALL ON FUNCTION public.koa_whatsapp_status(uuid),public.koa_whatsapp_conversations(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.koa_whatsapp_status(uuid),public.koa_whatsapp_conversations(uuid,boolean) TO authenticated;
