-- =====================================================
-- Koa online frontend + local worker orchestration
-- Frontend creates/cancels operations through authenticated RPCs.
-- Local worker uses service role to claim, heartbeat and upload artifacts.
-- =====================================================

CREATE OR REPLACE FUNCTION public.create_koa_card_issue_operation(
  _workspace_id uuid,
  _company_id uuid,
  _operator text DEFAULT 'hapvida',
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS public.automation_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _credential record;
  _operation public.automation_operations;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF _operator <> 'hapvida' THEN
    RAISE EXCEPTION 'WORKFLOW_DISABLED';
  END IF;

  IF public.automation_jsonb_has_sensitive_keys(COALESCE(_payload, '{}'::jsonb)) THEN
    RAISE EXCEPTION 'SENSITIVE_PAYLOAD_BLOCKED';
  END IF;

  IF NOT public.is_workspace_member(_workspace_id, _user_id) THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.companies
    WHERE id = _company_id
      AND workspace_id = _workspace_id
  ) THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  SELECT id, credential_ref
  INTO _credential
  FROM public.automation_credentials
  WHERE workspace_id = _workspace_id
    AND company_id = _company_id
    AND operator = _operator
    AND status IN ('active', 'needs_verification')
  ORDER BY (status = 'active') DESC, updated_at DESC
  LIMIT 1;

  INSERT INTO public.automation_operations (
    workspace_id,
    company_id,
    requested_by,
    credential_id,
    operator,
    operation_type,
    status,
    credential_ref,
    payload,
    current_step,
    max_attempts
  )
  VALUES (
    _workspace_id,
    _company_id,
    _user_id,
    _credential.id,
    _operator,
    'CARD_ISSUE',
    'queued',
    COALESCE(_credential.credential_ref, _operator || ':' || _company_id::text),
    COALESCE(_payload, '{}'::jsonb),
    'queued',
    1
  )
  RETURNING * INTO _operation;

  INSERT INTO public.automation_events (operation_id, event_type, step, message, payload)
  VALUES
    (_operation.id, 'operation.created', 'queued', 'Operacao de carteirinha criada.', jsonb_build_object('source', 'kortex-online')),
    (_operation.id, 'operation.queued', 'queued', 'Operacao aguardando worker local.', jsonb_build_object('workerRequired', true));

  RETURN _operation;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_koa_operation_cancel(_operation_id uuid)
RETURNS public.automation_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _operation public.automation_operations;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT *
  INTO _operation
  FROM public.automation_operations
  WHERE id = _operation_id;

  IF _operation.id IS NULL THEN
    RAISE EXCEPTION 'OPERATION_NOT_FOUND';
  END IF;

  IF NOT public.is_workspace_member(_operation.workspace_id, _user_id) THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED';
  END IF;

  IF _operation.status IN ('success', 'error', 'cancelled', 'manual_review') THEN
    RETURN _operation;
  END IF;

  UPDATE public.automation_operations
  SET cancel_requested_at = COALESCE(cancel_requested_at, now()),
      status = 'cancelling',
      current_step = 'cancel_requested',
      updated_at = now()
  WHERE id = _operation_id
  RETURNING * INTO _operation;

  INSERT INTO public.automation_events (operation_id, event_type, step, message, payload)
  VALUES (
    _operation_id,
    'operation.cancel_requested',
    'cancel_requested',
    'Cancelamento solicitado pelo usuario.',
    jsonb_build_object('requestedBy', _user_id)
  );

  RETURN _operation;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_automation_worker_heartbeat(
  _worker_id text,
  _status public.automation_worker_status DEFAULT 'online',
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.automation_workers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _worker public.automation_workers;
BEGIN
  INSERT INTO public.automation_workers (id, hostname, version, status, last_heartbeat_at, started_at, metadata)
  VALUES (
    _worker_id,
    COALESCE(_metadata->>'host', _metadata->>'hostname'),
    _metadata->>'version',
    _status,
    now(),
    now(),
    public.automation_redact_sensitive_data(COALESCE(_metadata, '{}'::jsonb))
  )
  ON CONFLICT (id) DO UPDATE
  SET hostname = COALESCE(EXCLUDED.hostname, public.automation_workers.hostname),
      version = COALESCE(EXCLUDED.version, public.automation_workers.version),
      status = EXCLUDED.status,
      last_heartbeat_at = now(),
      metadata = EXCLUDED.metadata
  RETURNING * INTO _worker;

  RETURN _worker;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_automation_worker_offline(_worker_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.automation_workers
  SET status = 'offline',
      last_heartbeat_at = now(),
      metadata = metadata || jsonb_build_object('stoppedAt', now())
  WHERE id = _worker_id;
END;
$$;

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
    SELECT id, status
    FROM public.automation_operations
    WHERE status IN ('queued', 'cancelling')
      AND operation_type = 'CARD_ISSUE'
      AND attempt < max_attempts
    ORDER BY priority ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.automation_operations op
  SET
    status = CASE WHEN candidate.status = 'cancelling'
      THEN 'cancelling'::public.automation_operation_status
      ELSE 'starting'::public.automation_operation_status
    END,
    worker_id = _worker_id,
    lease_expires_at = now() + make_interval(secs => _lease_seconds),
    started_at = COALESCE(started_at, now()),
    current_step = CASE WHEN candidate.status = 'cancelling' THEN 'cancel_requested' ELSE 'claimed' END,
    attempt = CASE WHEN candidate.status = 'queued' THEN attempt + 1 ELSE attempt END,
    updated_at = now()
  FROM candidate
  WHERE op.id = candidate.id
  RETURNING op.* INTO _operation;

  IF _operation.id IS NOT NULL THEN
    INSERT INTO public.automation_events (operation_id, event_type, step, message, payload)
    VALUES (
      _operation.id,
      'operation.started',
      _operation.current_step,
      'Worker assumiu a operacao.',
      jsonb_build_object('workerId', _worker_id)
    );
  END IF;

  RETURN _operation;
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
  SET status = CASE
        WHEN operation_type = 'CARD_ISSUE' AND attempt < max_attempts
        THEN 'queued'::public.automation_operation_status
        ELSE 'manual_review'::public.automation_operation_status
      END,
      current_step = 'lease_expired',
      error_code = 'LEASE_EXPIRED',
      error_message = 'Worker lease expired before the operation could be safely verified.',
      worker_id = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE status IN ('starting', 'authenticating', 'accessing_portal', 'processing', 'verifying', 'cancelling')
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < now();

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_koa_card_issue_operation(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_koa_operation_cancel(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_automation_worker_heartbeat(text, public.automation_worker_status, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_automation_worker_offline(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_koa_card_issue_operation(uuid, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_koa_operation_cancel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_automation_worker_heartbeat(text, public.automation_worker_status, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_automation_worker_offline(text) TO service_role;

DROP POLICY IF EXISTS "koa_artifacts_select_ws_member" ON storage.objects;

CREATE POLICY "koa_artifacts_select_ws_member"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'koa-artifacts'
  AND (storage.foldername(name))[1] = 'operations'
  AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.is_workspace_member(((storage.foldername(name))[2])::uuid, auth.uid())
);
