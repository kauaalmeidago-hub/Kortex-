-- Lead-owned optional fields; NULL inherits an authorized linked source, ''/[] explicitly clears.
ALTER TABLE public.leads ADD COLUMN phone text, ADD COLUMN email text,
 ADD COLUMN city text, ADD COLUMN project text, ADD COLUMN offerings jsonb;
ALTER TABLE public.leads ADD CONSTRAINT lead_profile_valid CHECK (
 length(coalesce(phone,''))<=40 AND (coalesce(phone,'')='' OR regexp_replace(phone,'\D','','g') ~ '^[0-9]{10,13}$')
 AND length(coalesce(email,''))<=254 AND (coalesce(email,'')='' OR email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')
 AND length(coalesce(city,''))<=160 AND length(coalesce(project,''))<=160
 AND (offerings IS NULL OR (public.valid_company_offerings(offerings) AND jsonb_array_length(offerings)<=30)));

-- Validate new links, without requiring access to an unchanged company/contact
-- in order to edit independently authorized lead fields.
DO $guard$ DECLARE source text; changed text; BEGIN
 SELECT pg_get_functiondef('app_private.guard_lead()'::regprocedure) INTO source;
 changed:=replace(source,'NEW.company_id IS NOT NULL AND NOT EXISTS','NEW.company_id IS NOT NULL AND (TG_OP=''INSERT'' OR NEW.company_id IS DISTINCT FROM OLD.company_id) AND NOT EXISTS');
 changed:=replace(changed,'NEW.contact_id IS NOT NULL AND NOT EXISTS','NEW.contact_id IS NOT NULL AND (TG_OP=''INSERT'' OR NEW.contact_id IS DISTINCT FROM OLD.contact_id) AND NOT EXISTS');
 IF changed=source OR changed NOT LIKE '%NEW.company_id IS DISTINCT FROM OLD.company_id%' OR changed NOT LIKE '%NEW.contact_id IS DISTINCT FROM OLD.contact_id%' THEN RAISE EXCEPTION 'LEAD_GUARD_REVIEW_REQUIRED'; END IF;
 EXECUTE changed;
END; $guard$;

CREATE TABLE public.lead_contacts (
 lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(lead_id,contact_id));
ALTER TABLE public.lead_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_contacts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lead_contacts TO authenticated;
GRANT ALL ON public.lead_contacts TO service_role;
CREATE POLICY lead_contacts_read ON public.lead_contacts FOR SELECT TO authenticated
 USING(public.business_can_lead(lead_id) AND public.business_can_contact(contact_id));

CREATE FUNCTION public.business_lead_contact(p_lead uuid,p_contact uuid,p_action text,p_values jsonb DEFAULT '{}'::jsonb,p_updated timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l public.leads; c public.contacts; BEGIN
 IF auth.uid() IS NULL OR NOT public.business_can_lead(p_lead,true) OR p_contact IS NULL OR p_action NOT IN ('create','link','unlink','edit') OR p_action IS NULL THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.leads WHERE id=p_lead FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_lead::text||p_contact::text,201400));
 SELECT * INTO c FROM public.contacts WHERE id=p_contact FOR UPDATE;
 IF p_action='create' THEN
  IF c.id IS NOT NULL THEN
   IF c.owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.lead_contacts x WHERE x.lead_id=p_lead AND x.contact_id=p_contact) THEN RETURN c.id; END IF;
   RAISE EXCEPTION 'CONTACT_REQUEST_CONFLICT' USING ERRCODE='PT409';
  END IF;
 ELSE
  IF c.id IS NULL OR c.workspace_id<>l.workspace_id OR c.sector_id IS DISTINCT FROM l.sector_id OR NOT public.business_can_contact(c.id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_action IN ('create','edit') THEN
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR length(btrim(coalesce(p_values->>'full_name',''))) NOT BETWEEN 1 AND 240
   OR length(coalesce(p_values->>'job_title',''))>160 OR length(coalesce(p_values->>'email',''))>254 OR length(coalesce(p_values->>'phone',''))>40
   OR (coalesce(p_values->>'email','')<>'' AND p_values->>'email' !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')
   OR (coalesce(p_values->>'phone','')<>'' AND regexp_replace(p_values->>'phone','\D','','g') !~ '^[0-9]{10,13}$')
   THEN RAISE EXCEPTION 'INVALID_CONTACT' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_action='create' THEN
  IF NOT public.business_can_sector(l.sector_id,'create') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  INSERT INTO public.contacts(id,workspace_id,sector_id,full_name,job_title,email,phone,created_by,owner_id,visibility)
   VALUES(p_contact,l.workspace_id,l.sector_id,btrim(p_values->>'full_name'),nullif(btrim(p_values->>'job_title'),''),nullif(btrim(p_values->>'email'),''),nullif(btrim(p_values->>'phone'),''),auth.uid(),auth.uid(),'personal');
 END IF;
 IF p_action IN ('create','link') THEN
  INSERT INTO public.lead_contacts(lead_id,contact_id,created_by) VALUES(l.id,p_contact,auth.uid()) ON CONFLICT DO NOTHING;
 ELSIF p_action='unlink' THEN
  DELETE FROM public.lead_contacts x WHERE x.lead_id=p_lead AND x.contact_id=p_contact;
  IF l.contact_id=p_contact THEN UPDATE public.leads SET contact_id=NULL WHERE id=l.id; END IF;
 ELSIF p_action='edit' THEN
  IF NOT public.business_can_contact(p_contact,true) OR NOT public.business_can_sector(c.sector_id,'create')
   OR NOT (l.contact_id=c.id OR (c.company_id IS NOT NULL AND (c.company_id=l.company_id OR c.company_id=(SELECT pc.company_id FROM public.contacts pc WHERE pc.id=l.contact_id AND public.business_can_contact(pc.id)))) OR EXISTS(SELECT 1 FROM public.lead_contacts x WHERE x.lead_id=l.id AND x.contact_id=c.id)) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF p_updated IS DISTINCT FROM c.updated_at THEN RAISE EXCEPTION 'CONTACT_CONFLICT' USING ERRCODE='PT409'; END IF;
  UPDATE public.contacts SET full_name=btrim(p_values->>'full_name'),job_title=nullif(btrim(p_values->>'job_title'),''),email=nullif(btrim(p_values->>'email'),''),phone=nullif(btrim(p_values->>'phone'),'') WHERE id=c.id;
 END IF;
 RETURN p_contact;
END; $$;
REVOKE ALL ON FUNCTION public.business_lead_contact(uuid,uuid,text,jsonb,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_lead_contact(uuid,uuid,text,jsonb,timestamptz) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
