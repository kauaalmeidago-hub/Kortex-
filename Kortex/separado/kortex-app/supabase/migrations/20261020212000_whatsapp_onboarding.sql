CREATE FUNCTION public.wa_onboarding_required() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.wa_connections WHERE owner_id=auth.uid() AND onboarding_required);
$$;
REVOKE ALL ON FUNCTION public.wa_onboarding_required() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wa_onboarding_required() TO authenticated,service_role;
CREATE FUNCTION public.wa_prepare_onboarding(p_user uuid,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 INSERT INTO public.wa_onboarding(token_hash,user_id,expires_at) VALUES(p_hash,p_user,now()+interval '1 day');
 INSERT INTO public.wa_connections(owner_id,instance_name,onboarding_required) VALUES(p_user,'koa-'||replace(gen_random_uuid()::text,'-',''),true);
END $$;
REVOKE ALL ON FUNCTION public.wa_prepare_onboarding(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_prepare_onboarding(uuid,text) TO service_role;
