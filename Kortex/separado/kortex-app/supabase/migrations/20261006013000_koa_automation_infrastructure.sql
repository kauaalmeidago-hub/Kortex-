-- =====================================================
-- Koa automation cloud infrastructure
-- Existing organization model: public.workspaces
-- =====================================================

-- =====================================================
-- ENUMS
-- =====================================================
CREATE TYPE public.automation_operation_type AS ENUM (
  'CARD_ISSUE',
  'INCLUSION_HOLDER',
  'INCLUSION_DEPENDENT',
  'EXCLUSION_HOLDER',
  'EXCLUSION_DEPENDENT'
);

CREATE TYPE public.automation_operation_status AS ENUM (
  'queued',
  'starting',
  'authenticating',
  'accessing_portal',
  'processing',
  'verifying',
  'success',
  'error',
  'cancelling',
  'cancelled',
  'manual_review'
);

CREATE TYPE public.automation_event_type AS ENUM (
  'operation.created',
  'operation.queued',
  'operation.started',
  'operation.authenticating',
  'operation.portal_access',
  'operation.processing',
  'operation.verifying',
  'operation.success',
  'operation.error',
  'operation.cancel_requested',
  'operation.cancelled',
  'operation.recovered',
  'operation.manual_review',
  'artifact.created'
);

CREATE TYPE public.automation_step_status AS ENUM (
  'pending',
  'running',
  'success',
  'error',
  'skipped',
  'cancelled',
  'manual_review'
);

CREATE TYPE public.automation_credential_status AS ENUM (
  'active',
  'inactive',
  'needs_verification',
  'revoked'
);

CREATE TYPE public.automation_session_status AS ENUM (
  'active',
  'expired',
  'revoked',
  'invalid'
);

CREATE TYPE public.automation_worker_status AS ENUM (
  'online',
  'draining',
  'offline'
);

CREATE TYPE public.automation_actor_type AS ENUM (
  'user',
  'worker',
  'system'
);

-- =====================================================
-- REDACTION HELPERS
-- =====================================================
CREATE OR REPLACE FUNCTION public.automation_redact_sensitive_data(_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _key text;
  _item jsonb;
  _result jsonb := '{}'::jsonb;
BEGIN
  IF _value IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(_value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(public.automation_redact_sensitive_data(value)), '[]'::jsonb)
    INTO _result
    FROM jsonb_array_elements(_value);
    RETURN _result;
  END IF;

  IF jsonb_typeof(_value) <> 'object' THEN
    RETURN _value;
  END IF;

  FOR _key, _item IN SELECT key, value FROM jsonb_each(_value)
  LOOP
    IF _key ~* '(password|senha|authorization|cookie|token|storageState|secret|accessToken|refreshToken|rawCredential)' THEN
      _result := _result || jsonb_build_object(_key, '[REDACTED]');
    ELSIF _key ~* 'cpf' AND jsonb_typeof(_item) = 'string' THEN
      _result := _result || jsonb_build_object(_key, regexp_replace(_item #>> '{}', '^(.{3}).*(.{2})$', '\1******\2'));
    ELSE
      _result := _result || jsonb_build_object(_key, public.automation_redact_sensitive_data(_item));
    END IF;
  END LOOP;

  RETURN _result;
END;
$$;

CREATE OR REPLACE FUNCTION public.automation_jsonb_has_sensitive_keys(_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _key text;
  _item jsonb;
BEGIN
  IF _value IS NULL THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(_value) = 'array' THEN
    FOR _item IN SELECT value FROM jsonb_array_elements(_value)
    LOOP
      IF public.automation_jsonb_has_sensitive_keys(_item) THEN
        RETURN true;
      END IF;
    END LOOP;
    RETURN false;
  END IF;

  IF jsonb_typeof(_value) <> 'object' THEN
    RETURN false;
  END IF;

  FOR _key, _item IN SELECT key, value FROM jsonb_each(_value)
  LOOP
    IF _key ~* '(password|senha|authorization|cookie|token|storageState|secret|accessToken|refreshToken|rawCredential)' THEN
      RETURN true;
    END IF;

    IF public.automation_jsonb_has_sensitive_keys(_item) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

-- =====================================================
-- CREDENTIAL METADATA
-- No password, token, cookie, or raw secret is stored here.
-- =====================================================
CREATE TABLE public.automation_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  operator TEXT NOT NULL,
  credential_ref TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  username_hint TEXT,
  status public.automation_credential_status NOT NULL DEFAULT 'needs_verification',
  last_verified_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT automation_credentials_operator_format CHECK (operator = lower(operator) AND operator ~ '^[a-z0-9_:-]+$'),
  CONSTRAINT automation_credentials_metadata_safe CHECK (NOT public.automation_jsonb_has_sensitive_keys(metadata))
);

COMMENT ON TABLE public.automation_credentials IS 'Credential metadata only. Real passwords live in SecretProvider/Vault and are referenced by credential_ref.';

-- =====================================================
-- OPERATIONS: source of truth
-- =====================================================
CREATE TABLE public.automation_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  credential_id UUID REFERENCES public.automation_credentials(id) ON DELETE SET NULL,
  operator TEXT NOT NULL,
  operation_type public.automation_operation_type NOT NULL,
  status public.automation_operation_status NOT NULL DEFAULT 'queued',
  credential_ref TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error_code TEXT,
  error_message TEXT,
  current_step TEXT,
  progress_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER NOT NULL DEFAULT 100,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT automation_operations_operator_format CHECK (operator = lower(operator) AND operator ~ '^[a-z0-9_:-]+$'),
  CONSTRAINT automation_operations_payload_safe CHECK (NOT public.automation_jsonb_has_sensitive_keys(payload)),
  CONSTRAINT automation_operations_result_safe CHECK (result IS NULL OR NOT public.automation_jsonb_has_sensitive_keys(result)),
  CONSTRAINT automation_operations_progress_safe CHECK (NOT public.automation_jsonb_has_sensitive_keys(progress_metadata)),
  CONSTRAINT automation_operations_attempt_valid CHECK (attempt >= 0 AND max_attempts >= 1),
  CONSTRAINT automation_operations_priority_valid CHECK (priority >= 0)
);

COMMENT ON TABLE public.automation_operations IS 'Source of truth for Koa automation status. React and Playwright are not sources of truth.';

-- =====================================================
-- EVENTS
-- =====================================================
CREATE TABLE public.automation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.automation_operations(id) ON DELETE CASCADE,
  event_type public.automation_event_type NOT NULL,
  step TEXT,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT automation_events_payload_safe CHECK (NOT public.automation_jsonb_has_sensitive_keys(payload))
);

-- =====================================================
-- STEPS
-- =====================================================
CREATE TABLE public.automation_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.automation_operations(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_name TEXT NOT NULL,
  status public.automation_step_status NOT NULL DEFAULT 'pending',
  sequence INTEGER NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT automation_steps_sequence_valid CHECK (sequence >= 0),
  CONSTRAINT automation_steps_duration_valid CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT automation_steps_metadata_safe CHECK (NOT public.automation_jsonb_has_sensitive_keys(metadata))
);

-- =====================================================
-- ARTIFACTS
-- =====================================================
CREATE TABLE public.automation_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.automation_operations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('card_pdf', 'confirmation_pdf', 'screenshot', 'status_screenshot', 'receipt', 'document')),
  storage_provider TEXT NOT NULL DEFAULT 'supabase',
  bucket TEXT NOT NULL DEFAULT 'koa-artifacts',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  checksum TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT automation_artifacts_size_valid CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CONSTRAINT automation_artifacts_metadata_safe CHECK (NOT public.automation_jsonb_has_sensitive_keys(metadata))
);

-- =====================================================
-- DOCUMENTS uploaded before operations
-- =====================================================
CREATE TABLE public.automation_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  storage_provider TEXT NOT NULL DEFAULT 'supabase',
  bucket TEXT NOT NULL DEFAULT 'koa-artifacts',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT automation_documents_size_valid CHECK (size_bytes > 0),
  CONSTRAINT automation_documents_mime_allowed CHECK (
    mime_type IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')
  ),
  CONSTRAINT automation_documents_metadata_safe CHECK (NOT public.automation_jsonb_has_sensitive_keys(metadata))
);

-- =====================================================
-- LOCKS
-- =====================================================
CREATE TABLE public.automation_locks (
  lock_key TEXT PRIMARY KEY,
  operation_id UUID REFERENCES public.automation_operations(id) ON DELETE SET NULL,
  worker_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- SESSIONS
-- =====================================================
CREATE TABLE public.automation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID NOT NULL REFERENCES public.automation_credentials(id) ON DELETE CASCADE,
  operator TEXT NOT NULL,
  status public.automation_session_status NOT NULL DEFAULT 'active',
  encrypted_state_ref TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT automation_sessions_operator_format CHECK (operator = lower(operator) AND operator ~ '^[a-z0-9_:-]+$')
);

COMMENT ON TABLE public.automation_sessions IS 'Stores only encrypted state references. Browser storageState JSON must live in private encrypted storage or a secret store.';

-- =====================================================
-- WORKERS
-- =====================================================
CREATE TABLE public.automation_workers (
  id TEXT PRIMARY KEY,
  hostname TEXT,
  version TEXT,
  status public.automation_worker_status NOT NULL DEFAULT 'online',
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT automation_workers_metadata_safe CHECK (NOT public.automation_jsonb_has_sensitive_keys(metadata))
);

-- =====================================================
-- AUDIT
-- =====================================================
CREATE TABLE public.automation_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID REFERENCES public.automation_operations(id) ON DELETE SET NULL,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  actor_type public.automation_actor_type NOT NULL,
  actor_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT automation_audit_logs_metadata_safe CHECK (NOT public.automation_jsonb_has_sensitive_keys(metadata))
);

CREATE OR REPLACE FUNCTION public.automation_event_workspace_id(_operation_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.automation_operations WHERE id = _operation_id;
$$;

-- =====================================================
-- UPDATED_AT TRIGGERS
-- =====================================================
CREATE TRIGGER trg_automation_credentials_updated BEFORE UPDATE ON public.automation_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_automation_operations_updated BEFORE UPDATE ON public.automation_operations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_automation_locks_updated BEFORE UPDATE ON public.automation_locks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_automation_sessions_updated BEFORE UPDATE ON public.automation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- QUEUE RPCS FOR SERVICE ROLE / WORKER
-- =====================================================
CREATE OR REPLACE FUNCTION public.claim_next_automation_operation(
  _worker_id text,
  _lease_seconds integer DEFAULT 60
)
RETURNS public.automation_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _operation public.automation_operations;
BEGIN
  WITH candidate AS (
    SELECT id
    FROM public.automation_operations
    WHERE status = 'queued'
    ORDER BY priority ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.automation_operations op
  SET
    status = 'starting',
    worker_id = _worker_id,
    lease_expires_at = now() + make_interval(secs => _lease_seconds),
    started_at = COALESCE(started_at, now()),
    current_step = 'claimed',
    updated_at = now()
  FROM candidate
  WHERE op.id = candidate.id
  RETURNING op.* INTO _operation;

  IF _operation.id IS NOT NULL THEN
    INSERT INTO public.automation_events (operation_id, event_type, step, message, payload)
    VALUES (_operation.id, 'operation.started', 'claimed', 'Worker assumiu a operacao.', jsonb_build_object('workerId', _worker_id));
  END IF;

  RETURN _operation;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_automation_operation_lease(
  _operation_id uuid,
  _worker_id text,
  _lease_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.automation_operations
  SET lease_expires_at = now() + make_interval(secs => _lease_seconds),
      updated_at = now()
  WHERE id = _operation_id
    AND worker_id = _worker_id
    AND status IN ('starting', 'authenticating', 'accessing_portal', 'processing', 'verifying', 'cancelling');

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_automation_lock(
  _lock_key text,
  _operation_id uuid,
  _worker_id text,
  _ttl_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_locks (lock_key, operation_id, worker_id, expires_at)
  VALUES (_lock_key, _operation_id, _worker_id, now() + make_interval(secs => _ttl_seconds))
  ON CONFLICT (lock_key) DO UPDATE
    SET operation_id = EXCLUDED.operation_id,
        worker_id = EXCLUDED.worker_id,
        expires_at = EXCLUDED.expires_at,
        updated_at = now()
    WHERE public.automation_locks.expires_at < now()
       OR public.automation_locks.worker_id = _worker_id
       OR public.automation_locks.operation_id = _operation_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_automation_lock(
  _lock_key text,
  _operation_id uuid,
  _worker_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.automation_locks
  WHERE lock_key = _lock_key
    AND operation_id = _operation_id
    AND worker_id = _worker_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_stale_automation_operations_for_review()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  UPDATE public.automation_operations
  SET status = 'manual_review',
      current_step = 'lease_expired',
      error_code = 'LEASE_EXPIRED',
      error_message = 'Worker lease expired before the operation could be safely verified.',
      updated_at = now()
  WHERE status IN ('starting', 'authenticating', 'accessing_portal', 'processing', 'verifying')
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < now()
    AND operation_type IN ('INCLUSION_HOLDER', 'INCLUSION_DEPENDENT', 'EXCLUSION_HOLDER', 'EXCLUSION_DEPENDENT');

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_automation_credentials_company_operator ON public.automation_credentials(company_id, operator);
CREATE INDEX idx_automation_credentials_workspace ON public.automation_credentials(workspace_id);

CREATE INDEX idx_automation_operations_queue ON public.automation_operations(status, priority, created_at);
CREATE INDEX idx_automation_operations_company_created ON public.automation_operations(company_id, created_at DESC);
CREATE INDEX idx_automation_operations_requested_by_created ON public.automation_operations(requested_by, created_at DESC);
CREATE INDEX idx_automation_operations_worker ON public.automation_operations(worker_id);
CREATE INDEX idx_automation_operations_lease ON public.automation_operations(lease_expires_at);
CREATE INDEX idx_automation_operations_workspace_created ON public.automation_operations(workspace_id, created_at DESC);

CREATE INDEX idx_automation_events_operation_created ON public.automation_events(operation_id, created_at);
CREATE INDEX idx_automation_steps_operation_sequence ON public.automation_steps(operation_id, sequence);
CREATE INDEX idx_automation_artifacts_operation ON public.automation_artifacts(operation_id);
CREATE INDEX idx_automation_documents_company_created ON public.automation_documents(company_id, created_at DESC);
CREATE INDEX idx_automation_locks_expires ON public.automation_locks(expires_at);
CREATE INDEX idx_automation_sessions_credential ON public.automation_sessions(credential_id);
CREATE INDEX idx_automation_workers_heartbeat ON public.automation_workers(last_heartbeat_at);
CREATE INDEX idx_automation_audit_logs_operation_created ON public.automation_audit_logs(operation_id, created_at);
CREATE INDEX idx_automation_audit_logs_workspace_created ON public.automation_audit_logs(workspace_id, created_at);

-- =====================================================
-- GRANTS
-- =====================================================
GRANT SELECT ON public.automation_credentials TO authenticated;
GRANT SELECT ON public.automation_operations TO authenticated;
GRANT SELECT ON public.automation_events TO authenticated;
GRANT SELECT ON public.automation_steps TO authenticated;
GRANT SELECT ON public.automation_artifacts TO authenticated;
GRANT SELECT, INSERT ON public.automation_documents TO authenticated;
GRANT SELECT ON public.automation_audit_logs TO authenticated;

GRANT ALL ON public.automation_credentials TO service_role;
GRANT ALL ON public.automation_operations TO service_role;
GRANT ALL ON public.automation_events TO service_role;
GRANT ALL ON public.automation_steps TO service_role;
GRANT ALL ON public.automation_artifacts TO service_role;
GRANT ALL ON public.automation_documents TO service_role;
GRANT ALL ON public.automation_locks TO service_role;
GRANT ALL ON public.automation_sessions TO service_role;
GRANT ALL ON public.automation_workers TO service_role;
GRANT ALL ON public.automation_audit_logs TO service_role;

REVOKE EXECUTE ON FUNCTION public.automation_redact_sensitive_data(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.automation_jsonb_has_sensitive_keys(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.automation_event_workspace_id(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_next_automation_operation(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.renew_automation_operation_lease(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.acquire_automation_lock(text, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_automation_lock(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_stale_automation_operations_for_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_event_workspace_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.automation_jsonb_has_sensitive_keys(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_automation_operation(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_automation_operation_lease(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_automation_lock(text, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_automation_lock(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_stale_automation_operations_for_review() TO service_role;

-- =====================================================
-- RLS
-- Frontend reads by workspace membership/requested_by.
-- Mutating worker operations are service-role only.
-- =====================================================
ALTER TABLE public.automation_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "automation_credentials_select_ws_admin" ON public.automation_credentials FOR SELECT TO authenticated
  USING (public.is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "automation_operations_select_ws_member" ON public.automation_operations FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "automation_events_select_ws_member" ON public.automation_events FOR SELECT TO authenticated
  USING (public.is_workspace_member(public.automation_event_workspace_id(operation_id), auth.uid()));

CREATE POLICY "automation_steps_select_ws_member" ON public.automation_steps FOR SELECT TO authenticated
  USING (public.is_workspace_member(public.automation_event_workspace_id(operation_id), auth.uid()));

CREATE POLICY "automation_artifacts_select_ws_member" ON public.automation_artifacts FOR SELECT TO authenticated
  USING (public.is_workspace_member(public.automation_event_workspace_id(operation_id), auth.uid()));

CREATE POLICY "automation_documents_select_ws_member" ON public.automation_documents FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "automation_documents_insert_ws_member_self" ON public.automation_documents FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "automation_audit_logs_select_ws_admin" ON public.automation_audit_logs FOR SELECT TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id, auth.uid()));

-- No authenticated policies for locks, sessions, workers.

-- =====================================================
-- PRIVATE STORAGE BUCKET
-- =====================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'koa-artifacts',
  'koa-artifacts',
  false,
  52428800,
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
