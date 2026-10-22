-- Explicit delegation for the WhatsApp card worker. It does not enable the
-- general business catalogue or grant access to other credentials.
CREATE TABLE public.koa_whatsapp_card_company_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 channel_id uuid NOT NULL REFERENCES public.koa_whatsapp_channels(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 credential_id uuid NOT NULL REFERENCES public.automation_credentials(id),
 company_name text NOT NULL CHECK(length(trim(company_name)) BETWEEN 3 AND 160),
 active boolean NOT NULL DEFAULT false,
 authorization_source text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(channel_id,credential_id),UNIQUE(channel_id,company_name)
);
ALTER TABLE public.koa_whatsapp_card_company_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.koa_whatsapp_card_company_links FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.koa_whatsapp_card_company_links TO service_role;
NOTIFY pgrst,'reload schema';
