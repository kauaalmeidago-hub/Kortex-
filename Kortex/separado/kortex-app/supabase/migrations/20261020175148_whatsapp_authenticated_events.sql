-- Only a SHA-256 digest of the provider webhook credential is persisted.
-- Version aligned with the applied staging migration.
ALTER TABLE public.wa_provider_workers ADD COLUMN webhook_token_hash text
 CHECK(webhook_token_hash IS NULL OR webhook_token_hash ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX wa_provider_webhook_token ON public.wa_provider_workers(webhook_token_hash)
 WHERE webhook_token_hash IS NOT NULL;
NOTIFY pgrst,'reload schema';
