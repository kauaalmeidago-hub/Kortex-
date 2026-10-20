-- Application version conflicts are permanent for the submitted payload.
-- PostgREST 14 retries SQLSTATE 40001 internally; use its HTTP 409 mapping.
-- Preserve existing signatures, owners, grants, RLS and transaction boundaries.
DO $$
DECLARE routine record;
BEGIN
 FOR routine IN
  SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
   AND p.proname IN ('business_save_task','business_save_columns','task_save_draft','task_confirm_draft')
   AND p.prosrc LIKE '%''40001''%'
 LOOP
  EXECUTE replace(pg_get_functiondef(routine.oid),'''40001''','''PT409''');
 END LOOP;
END;
$$;
NOTIFY pgrst,'reload schema';
