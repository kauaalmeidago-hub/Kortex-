CREATE SCHEMA IF NOT EXISTS koa_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA koa_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA koa_private TO service_role;

CREATE TABLE IF NOT EXISTS koa_private.automation_credential_secrets (
  credential_id uuid PRIMARY KEY REFERENCES public.automation_credentials(id) ON DELETE CASCADE,
  vault_secret_id uuid NOT NULL UNIQUE REFERENCES vault.secrets(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE koa_private.automation_credential_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE koa_private.automation_credential_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE koa_private.automation_credential_secrets TO service_role;
CREATE POLICY worker_credential_secrets ON koa_private.automation_credential_secrets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
COMMENT ON TABLE koa_private.automation_credential_secrets IS
  'Backend-only mapping of validated portal credentials to encrypted Supabase Vault secrets. No plaintext credentials in public metadata.';
