-- Exposed RPCs remain invoker wrappers. Privileged row lookups live in the
-- private schema and keep the same per-conversation authorization predicate.
CREATE FUNCTION app_private.wa_read_conversation(p_conversation uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.wa_conversations v WHERE v.id=p_conversation AND
 (app_private.wa_channel_user(v.connection_id,auth.uid()) OR EXISTS(
 SELECT 1 FROM public.wa_cases k WHERE k.conversation_id=v.id AND k.is_current AND app_private.wa_case_user(k.id,auth.uid()))));
$$;
REVOKE ALL ON FUNCTION app_private.wa_read_conversation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.wa_read_conversation(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.wa_can_read_conversation(p_conversation uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT app_private.wa_read_conversation(p_conversation); $$;
CREATE OR REPLACE FUNCTION public.wa_can_access(p_connection uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT app_private.wa_channel_user(p_connection,auth.uid()); $$;
-- There are deliberately no direct grants on this configuration table.
CREATE POLICY wa_channel_grants_internal ON public.wa_channel_grants FOR ALL TO authenticated USING(false) WITH CHECK(false);
NOTIFY pgrst,'reload schema';
