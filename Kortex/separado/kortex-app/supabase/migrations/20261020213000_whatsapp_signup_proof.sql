-- Only an auth.users INSERT proves a new signup. Metadata on a repeated signup
-- for an unconfirmed email may be updated by GoTrue and is not creation evidence.
CREATE TABLE public.wa_signup_proofs (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 nonce_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.wa_signup_reservations (
 email_hash text PRIMARY KEY, expires_at timestamptz NOT NULL
);
ALTER TABLE public.wa_signup_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_signup_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_signup_proofs,public.wa_signup_reservations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.wa_signup_proofs,public.wa_signup_reservations TO service_role;
CREATE FUNCTION app_private.wa_record_signup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.raw_user_meta_data->>'wa_signup_nonce' ~ '^[a-f0-9]{64}$' THEN
 INSERT INTO public.wa_signup_proofs(user_id,nonce_hash) VALUES(NEW.id,NEW.raw_user_meta_data->>'wa_signup_nonce');
 INSERT INTO public.wa_connections(owner_id,instance_name,onboarding_required)
 VALUES(NEW.id,'koa-'||replace(gen_random_uuid()::text,'-',''),true);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER wa_signup_creation_proof AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION app_private.wa_record_signup();
CREATE FUNCTION public.wa_signup_begin(p_email text,p_email_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(lower(btrim(p_email)),20261020));
 IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=lower(btrim(p_email))) THEN RETURN false;END IF;
 INSERT INTO public.wa_signup_reservations(email_hash,expires_at) VALUES(p_email_hash,now()+interval '5 minutes')
 ON CONFLICT(email_hash) DO UPDATE SET expires_at=excluded.expires_at WHERE wa_signup_reservations.expires_at<now();
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.wa_prepare_onboarding(p_user uuid,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 INSERT INTO public.wa_onboarding(token_hash,user_id,expires_at) VALUES(p_hash,p_user,now()+interval '1 day');
 INSERT INTO public.wa_connections(owner_id,instance_name,onboarding_required)
 VALUES(p_user,'koa-'||replace(gen_random_uuid()::text,'-',''),true)
 ON CONFLICT(owner_id) WHERE activated_at IS NULL DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.wa_signup_begin(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_signup_begin(text,text) TO service_role;
REVOKE ALL ON FUNCTION app_private.wa_record_signup() FROM PUBLIC,anon,authenticated;
