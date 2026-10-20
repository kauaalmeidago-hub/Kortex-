-- Extend existing companies without replacing IDs or relationships.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS project text,
  ADD COLUMN IF NOT EXISTS responsible_name text,
  ADD COLUMN IF NOT EXISTS avatar_path text,
  ADD COLUMN IF NOT EXISTS offerings jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.valid_company_offerings(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT CASE WHEN jsonb_typeof(value) <> 'array' THEN false ELSE
   NOT EXISTS (SELECT 1 FROM jsonb_array_elements(value) AS entry
     WHERE jsonb_typeof(entry) <> 'object'
       OR jsonb_typeof(entry->'product') IS DISTINCT FROM 'string'
       OR jsonb_typeof(entry->'operator') IS DISTINCT FROM 'string'
       OR btrim(entry->>'product') = '' OR btrim(entry->>'operator') = '') END;
$$;
ALTER TABLE public.companies ADD CONSTRAINT companies_offerings_valid
  CHECK (public.valid_company_offerings(offerings));
ALTER TABLE public.companies ADD CONSTRAINT companies_cnpj_format
  CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$');
ALTER TABLE public.companies ADD CONSTRAINT companies_avatar_workspace_path
  CHECK (avatar_path IS NULL OR avatar_path LIKE workspace_id::text || '/' || id::text || '/%');
CREATE UNIQUE INDEX companies_workspace_cnpj_unique ON public.companies(workspace_id, cnpj) WHERE cnpj IS NOT NULL;
CREATE UNIQUE INDEX companies_workspace_identity ON public.companies(workspace_id, id);

ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.notes ADD CONSTRAINT notes_company_workspace_fkey
  FOREIGN KEY (workspace_id, company_id) REFERENCES public.companies(workspace_id, id) ON DELETE CASCADE;
CREATE INDEX notes_company_index ON public.notes(workspace_id, company_id, created_at);
-- Existing contact rows remain intact; new links must belong to the same workspace.
ALTER TABLE public.contacts ADD CONSTRAINT contacts_company_workspace_fkey
  FOREIGN KEY (workspace_id, company_id) REFERENCES public.companies(workspace_id, id) NOT VALID;

CREATE TABLE public.company_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  name text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK(size_bytes >= 0),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, company_id) REFERENCES public.companies(workspace_id, id) ON DELETE CASCADE,
  CHECK(storage_path LIKE workspace_id::text || '/' || company_id::text || '/%')
);
ALTER TABLE public.company_files ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_files TO authenticated;
GRANT ALL ON public.company_files TO service_role;
CREATE POLICY company_files_workspace_access ON public.company_files FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE INDEX company_files_company_index ON public.company_files(workspace_id, company_id, created_at);

INSERT INTO storage.buckets(id, name, public, file_size_limit)
VALUES ('company-media', 'company-media', false, 20971520)
ON CONFLICT(id) DO NOTHING;
-- Validate the complete workspace prefix without casts on untrusted object names.
CREATE POLICY company_media_workspace_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-media' AND EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id::text = (storage.foldername(name))[1] AND m.user_id = auth.uid()));
CREATE POLICY company_media_workspace_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-media' AND EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id::text = (storage.foldername(name))[1] AND m.user_id = auth.uid()));
CREATE POLICY company_media_workspace_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-media' AND EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id::text = (storage.foldername(name))[1] AND m.user_id = auth.uid()));
