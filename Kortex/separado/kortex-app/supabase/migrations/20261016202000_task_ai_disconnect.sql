-- Vault has a column named secret; avoid a PL/pgSQL variable/column ambiguity.
CREATE OR REPLACE FUNCTION public.task_ai_disconnect(p_user uuid,p_workspace uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_secret uuid;BEGIN
 IF NOT app_private.task_admin_actor(p_workspace,p_user) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 DELETE FROM app_private.task_ai_connections WHERE user_id=p_user AND workspace_id=p_workspace RETURNING secret_id INTO v_secret;
 IF v_secret IS NOT NULL THEN DELETE FROM vault.secrets WHERE id=v_secret;END IF;
END;$$;
REVOKE ALL ON FUNCTION public.task_ai_disconnect(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.task_ai_disconnect(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
