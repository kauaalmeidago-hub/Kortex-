-- Qualify the uploaded object's path. Inside the subquery, an unqualified name
-- resolves to companies.name instead, breaking uploads and the intended binding.
ALTER POLICY company_media_read ON storage.objects USING (
  bucket_id = 'company-media' AND EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.workspace_id::text = (storage.foldername(objects.name))[1]
      AND c.id::text = (storage.foldername(objects.name))[2]
      AND public.business_can_company(c.id)
  )
);
ALTER POLICY company_media_insert ON storage.objects WITH CHECK (
  bucket_id = 'company-media' AND EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.workspace_id::text = (storage.foldername(objects.name))[1]
      AND c.id::text = (storage.foldername(objects.name))[2]
      AND public.business_can_company(c.id, true)
  )
);
ALTER POLICY company_media_delete ON storage.objects USING (
  bucket_id = 'company-media' AND EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.workspace_id::text = (storage.foldername(objects.name))[1]
      AND c.id::text = (storage.foldername(objects.name))[2]
      AND public.business_can_company(c.id, true)
  )
);
NOTIFY pgrst, 'reload schema';
