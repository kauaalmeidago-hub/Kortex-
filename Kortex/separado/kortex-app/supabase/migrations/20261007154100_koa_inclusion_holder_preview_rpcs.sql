-- Koa Hapvida INCLUSION_HOLDER prepare-only RPC and queue integration.
-- Final submit remains blocked by the worker unless KOA_INCLUSION_ENABLED is implemented later.

CREATE OR REPLACE FUNCTION public.create_koa_inclusion_holder_preview_operation(
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
  _payload_safe jsonb := COALESCE(_payload, '{}'::jsonb);
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF _operator <> 'hapvida' THEN
    RAISE EXCEPTION 'WORKFLOW_DISABLED';
  END IF;

  IF public.automation_jsonb_has_sensitive_keys(_payload_safe) THEN
    RAISE EXCEPTION 'SENSITIVE_PAYLOAD_BLOCKED';
  END IF;

  IF _payload_safe ? 'password'
     OR _payload_safe ? 'senha'
     OR _payload_safe ? 'holderUserCode'
     OR _payload_safe ? 'titularUserCode'
     OR _payload_safe ? 'cancellationDate'
     OR _payload_safe ? 'effectiveCancellationDate' THEN
    RAISE EXCEPTION 'PORTAL_DERIVED_OR_SECRET_FIELD_BLOCKED';
  END IF;

  IF COALESCE(_payload_safe->>'beneficiaryName', '') = '' THEN
    RAISE EXCEPTION 'MISSING_BENEFICIARY_NAME';
  END IF;

  IF COALESCE(_payload_safe->>'beneficiaryCpf', _payload_safe->>'cpf', '') = '' THEN
    RAISE EXCEPTION 'MISSING_BENEFICIARY_CPF';
  END IF;

  IF COALESCE(_payload_safe->>'birthDate', _payload_safe->>'dateOfBirth', '') = '' THEN
    RAISE EXCEPTION 'MISSING_BIRTH_DATE';
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
    'INCLUSION_HOLDER',
    'queued',
    COALESCE(_credential.credential_ref, _operator || ':' || _company_id::text),
    _payload_safe || jsonb_build_object('prepareOnly', true),
    'queued',
    1
  )
  RETURNING * INTO _operation;

  INSERT INTO public.automation_events (operation_id, event_type, step, message, payload)
  VALUES
    (_operation.id, 'operation.created', 'queued', 'Operacao de inclusao titular em preview criada.', jsonb_build_object('source', 'kortex-online', 'prepareOnly', true)),
    (_operation.id, 'operation.queued', 'queued', 'Operacao aguardando worker local.', jsonb_build_object('workerRequired', true));

  RETURN _operation;
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
      AND operation_type IN ('CARD_ISSUE', 'EXCLUSION_HOLDER', 'INCLUSION_HOLDER')
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

  IF _operation.status IN ('success', 'error', 'cancelled', 'manual_review', 'submission_confirmed') THEN
    RETURN _operation;
  END IF;

  UPDATE public.automation_operations
  SET cancel_requested_at = COALESCE(cancel_requested_at, now()),
      status = CASE
        WHEN status IN ('awaiting_confirmation', 'awaiting_human_verification')
        THEN 'cancelled'::public.automation_operation_status
        ELSE 'cancelling'::public.automation_operation_status
      END,
      current_step = CASE
        WHEN status = 'awaiting_confirmation' THEN 'cancelled_before_submit'
        WHEN status = 'awaiting_human_verification' THEN 'cancelled_before_human_verification'
        ELSE 'cancel_requested'
      END,
      finished_at = CASE
        WHEN status IN ('awaiting_confirmation', 'awaiting_human_verification') THEN now()
        ELSE finished_at
      END,
      updated_at = now()
  WHERE id = _operation_id
  RETURNING * INTO _operation;

  INSERT INTO public.automation_events (operation_id, event_type, step, message, payload)
  VALUES (
    _operation_id,
    CASE WHEN _operation.status = 'cancelled' THEN 'operation.cancelled'::public.automation_event_type ELSE 'operation.cancel_requested'::public.automation_event_type END,
    _operation.current_step,
    CASE WHEN _operation.status = 'cancelled' THEN 'Operacao cancelada antes do submit definitivo.' ELSE 'Cancelamento solicitado pelo usuario.' END,
    jsonb_build_object('requestedBy', _user_id)
  );

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
    AND status IN (
      'starting',
      'authenticating',
      'accessing_portal',
      'checking_active_users',
      'checking_cns',
      'checking_cpf',
      'generating_cpf_document',
      'validating_documents',
      'opening_inclusion',
      'filling_registration',
      'selecting_plan',
      'uploading_documents',
      'filling_health_questionnaire',
      'processing',
      'submitting',
      'checking_movement_status',
      'capturing_evidence',
      'verifying',
      'cancelling'
    );

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
  WHERE status IN (
      'starting',
      'authenticating',
      'accessing_portal',
      'checking_active_users',
      'checking_cns',
      'checking_cpf',
      'generating_cpf_document',
      'validating_documents',
      'opening_inclusion',
      'filling_registration',
      'selecting_plan',
      'uploading_documents',
      'filling_health_questionnaire',
      'processing',
      'submitting',
      'checking_movement_status',
      'capturing_evidence',
      'verifying',
      'cancelling'
    )
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < now();

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_koa_inclusion_holder_preview_operation(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_koa_inclusion_holder_preview_operation(uuid, uuid, text, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_koa_operation_cancel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_koa_operation_cancel(uuid) TO authenticated;
