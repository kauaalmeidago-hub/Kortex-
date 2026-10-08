-- Koa Hapvida EXCLUSION_HOLDER prepare-only support.
-- Adds the pause status and specific SSE event names without enabling final submit.

ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'awaiting_confirmation';

ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'operation.status';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'operation.step';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.started';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.company_access_selected';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.active_users_loaded';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.beneficiary_found';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.holder_code_resolved';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.contract_loaded';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.contract_validated';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.reason_selected';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.attachment_uploaded';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.awaiting_confirmation';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.submitted';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.verifying';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.success';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.error';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.cancelled';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'exclusion.manual_review';
