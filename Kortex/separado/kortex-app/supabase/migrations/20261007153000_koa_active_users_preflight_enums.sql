-- Koa Hapvida active users preflight and movement status proofing.
-- Adds workflow states/events and the private evidence artifact type.

ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'checking_active_users';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'submitting';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'checking_movement_status';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'capturing_evidence';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'submission_confirmed';

ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'preflight.active_users.started';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'preflight.active_users.loaded';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'preflight.beneficiary.found';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'preflight.beneficiary.not_found';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'preflight.beneficiary.validated';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'preflight.failed';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'movement.status.check_started';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'movement.status.page_loaded';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'movement.status.matched';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'movement.status.not_found';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'movement.status.confirmed';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'movement.status.evidence_captured';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'movement.status.manual_review';

ALTER TABLE public.automation_artifacts
  DROP CONSTRAINT IF EXISTS automation_artifacts_type_check;

ALTER TABLE public.automation_artifacts
  DROP CONSTRAINT IF EXISTS automation_artifacts_type_allowed;

ALTER TABLE public.automation_artifacts
  ADD CONSTRAINT automation_artifacts_type_allowed CHECK (
    type IN (
      'card_pdf',
      'confirmation_pdf',
      'screenshot',
      'status_screenshot',
      'movement_status_evidence',
      'receipt',
      'document'
    )
  );
