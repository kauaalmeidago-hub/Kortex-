-- Keep the original single company FK: a second FK makes existing PostgREST
-- contacts -> companies embeds ambiguous. Validate scope with a trigger instead.
CREATE OR REPLACE FUNCTION public.check_contact_company_workspace()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.companies c WHERE c.id = NEW.company_id AND c.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Contact and company must belong to the same workspace' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER contacts_company_workspace_guard
BEFORE INSERT OR UPDATE OF workspace_id, company_id ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.check_contact_company_workspace();
ALTER TABLE public.contacts DROP CONSTRAINT contacts_company_workspace_fkey;
