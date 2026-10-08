-- Queue functions aware of preflight/status-proof states.

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
        WHEN status = 'awaiting_confirmation'
        THEN 'cancelled'::public.automation_operation_status
        ELSE 'cancelling'::public.automation_operation_status
      END,
      current_step = CASE
        WHEN status = 'awaiting_confirmation' THEN 'cancelled_before_submit'
        ELSE 'cancel_requested'
      END,
      finished_at = CASE
        WHEN status = 'awaiting_confirmation' THEN now()
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

REVOKE EXECUTE ON FUNCTION public.request_koa_operation_cancel(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.renew_automation_operation_lease(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_stale_automation_operations_for_review() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_koa_operation_cancel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renew_automation_operation_lease(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_stale_automation_operations_for_review() TO service_role;
