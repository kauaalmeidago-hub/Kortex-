-- Commit the enum extension before functions/defaults reference the new value.
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'review' AFTER 'in_progress';
