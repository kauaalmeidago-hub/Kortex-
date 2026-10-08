-- Koa Hapvida INCLUSION_HOLDER prepare-only support.
-- Adds workflow states/events needed before enabling a real final submit.

ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'checking_cns';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'checking_cpf';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'awaiting_human_verification';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'generating_cpf_document';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'validating_documents';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'opening_inclusion';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'filling_registration';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'selecting_plan';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'uploading_documents';
ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'filling_health_questionnaire';

ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.started';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.cns.started';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.cns.found';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.cns.failed';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.cpf.started';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.cpf.human_verification_required';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.cpf.validated';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.cpf.document_created';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.registration.started';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.registration.completed';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.plan.selected';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.document.uploaded';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.health.started';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.health.completed';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.awaiting_confirmation';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.submitted';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.error';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'inclusion.cancelled';
