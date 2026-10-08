ALTER TYPE public.automation_operation_status ADD VALUE IF NOT EXISTS 'awaiting_authentication';

ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'authentication.required';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'authentication.submitted';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'authentication.started';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'authentication.succeeded';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'authentication.failed';
ALTER TYPE public.automation_event_type ADD VALUE IF NOT EXISTS 'authentication.saved_on_device';
