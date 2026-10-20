-- Keep existing shared boards and their permissions. Create a new destination only
-- when the administrator has no writable team board in the deliberately selected sector.
CREATE OR REPLACE FUNCTION public.task_admin_create_sector(p_workspace uuid,p_code text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.task_sectors;BEGIN
 IF NOT app_private.workspace_owner(p_workspace) OR NOT app_private.task_admin_actor(p_workspace,auth.uid())
 OR p_code NOT IN ('financeiro','relacionamento','comercial') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_code,8));
 SELECT * INTO s FROM public.task_sectors WHERE workspace_id=p_workspace AND code=p_code AND active;
 IF s.id IS NULL THEN SELECT * INTO s FROM public.task_sectors WHERE id=public.business_create_sector(p_workspace,p_code);END IF;
 PERFORM public.business_set_sector_member(s.id,auth.uid(),true,true,true,true,false);
 IF NOT EXISTS(SELECT 1 FROM public.business_boards b WHERE b.workspace_id=p_workspace AND b.sector_id=s.id AND b.kind='tasks' AND b.visibility='sector' AND NOT b.archived AND public.business_can_board(b.id,'dispatch')) THEN
  PERFORM app_private.create_board(p_workspace,s.id,auth.uid(),'tasks',s.name||' · Equipe','sector','sector');
 END IF;
 RETURN s.id;
END;$$;
REVOKE ALL ON FUNCTION public.task_admin_create_sector(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.task_admin_create_sector(uuid,text) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
