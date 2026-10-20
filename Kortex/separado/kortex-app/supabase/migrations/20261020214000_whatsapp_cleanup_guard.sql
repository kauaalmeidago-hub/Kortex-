CREATE OR REPLACE FUNCTION public.wa_activate(p_user uuid,p_workspace uuid,p_sector uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE c uuid;BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL) OR NOT app_private.member(p_workspace,p_sector,p_user)
 THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,42));
 SELECT id INTO c FROM public.wa_connections WHERE owner_id=p_user AND workspace_id=p_workspace AND sector_id=p_sector AND activated_at IS NOT NULL;
 IF c IS NULL THEN
 SELECT id INTO c FROM public.wa_connections WHERE owner_id=p_user AND activated_at IS NULL FOR UPDATE;
 IF c IS NOT NULL THEN
 IF EXISTS(SELECT 1 FROM public.wa_connections WHERE id=c AND lease_until>now()) THEN
 RAISE EXCEPTION 'CONNECTION_BUSY_RETRY' USING ERRCODE='PT409';END IF;
 UPDATE public.wa_connections SET workspace_id=p_workspace,sector_id=p_sector,activated_at=now() WHERE id=c;
 ELSE INSERT INTO public.wa_connections(owner_id,workspace_id,sector_id,instance_name,activated_at)
 VALUES(p_user,p_workspace,p_sector,'koa-'||replace(gen_random_uuid()::text,'-',''),now()) RETURNING id INTO c;END IF;
 END IF;
 UPDATE public.wa_onboarding SET revoked_at=now() WHERE user_id=p_user AND revoked_at IS NULL;
 RETURN c;
END $$;
