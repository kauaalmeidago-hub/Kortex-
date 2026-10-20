-- Explicit pipeline setup: one transaction, exactly the requested stages, no cards.
CREATE TABLE app_private.pipeline_setup_requests (
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid NOT NULL,
  board_id uuid NOT NULL REFERENCES public.business_boards(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, request_id)
);
ALTER TABLE app_private.pipeline_setup_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.pipeline_setup_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.business_pipeline_setup_scopes()
RETURNS TABLE(workspace_id uuid, workspace_name text, sector_id uuid, sector_name text, can_create boolean, can_create_shared boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.workspace_id, w.name, s.id, s.name,
    public.business_can_sector(s.id, 'create'),
    public.business_can_sector(s.id, 'create') AND public.business_can_sector(s.id, 'manage_boards')
  FROM public.task_sectors s JOIN public.workspaces w ON w.id = s.workspace_id
  WHERE public.business_can_sector(s.id)
  ORDER BY w.name, s.name, s.id;
$$;

CREATE FUNCTION public.business_pipeline_setup_status(p_request uuid)
RETURNS TABLE(board_id uuid, pipeline_id uuid, workspace_id uuid, sector_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request::text, 201200));
  RETURN QUERY SELECT b.id, p.id, b.workspace_id, b.sector_id
    FROM app_private.pipeline_setup_requests r
    JOIN public.business_boards b ON b.id = r.board_id
    JOIN public.pipelines p ON p.id = r.pipeline_id AND p.board_id = b.id
    WHERE r.actor_id = auth.uid() AND r.request_id = p_request AND public.business_can_board(b.id);
END; $$;

CREATE FUNCTION public.business_create_pipeline_setup(p_sector uuid, p_name text, p_columns jsonb, p_request uuid, p_visibility text DEFAULT 'personal')
RETURNS TABLE(board_id uuid, pipeline_id uuid, workspace_id uuid, sector_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ws uuid; b uuid; p uuid; names jsonb; payload jsonb; prior app_private.pipeline_setup_requests;
BEGIN
  IF auth.uid() IS NULL OR p_request IS NULL OR p_sector IS NULL
    OR NOT public.business_can_sector(p_sector, 'create')
    OR p_visibility IS NULL OR p_visibility NOT IN ('personal','sector')
    OR (p_visibility = 'sector' AND NOT public.business_can_sector(p_sector, 'manage_boards'))
    THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
  SELECT s.workspace_id INTO ws FROM public.task_sectors s WHERE s.id = p_sector;
  IF ws IS NULL OR NOT app_private.member(ws, p_sector, auth.uid()) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'PIPELINE_NAME_INVALID' USING ERRCODE = '22023'; END IF;
  IF p_columns IS NULL OR jsonb_typeof(p_columns) <> 'array' THEN RAISE EXCEPTION 'INVALID_COLUMNS' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_columns) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'INVALID_COLUMNS' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_columns) c WHERE jsonb_typeof(c) <> 'object'
    OR jsonb_typeof(c->'name') IS DISTINCT FROM 'string' OR length(btrim(c->>'name')) NOT BETWEEN 1 AND 80)
    THEN RAISE EXCEPTION 'INVALID_COLUMNS' USING ERRCODE = '22023'; END IF;
  -- The existing model permits repeated stage names. IDs and ordinal positions are distinct.
  SELECT jsonb_agg(jsonb_build_object('name', btrim(c->>'name')) ORDER BY n) INTO names
    FROM jsonb_array_elements(p_columns) WITH ORDINALITY a(c,n);
  payload := jsonb_build_object('sector',p_sector,'name',btrim(p_name),'columns',names,'visibility',p_visibility);
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request::text, 201200));
  SELECT * INTO prior FROM app_private.pipeline_setup_requests r WHERE r.actor_id = auth.uid() AND r.request_id = p_request;
  IF FOUND THEN
    IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'PIPELINE_REQUEST_CONFLICT' USING ERRCODE = 'PT409'; END IF;
    IF NOT public.business_can_board(prior.board_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
    RETURN QUERY SELECT prior.board_id, prior.pipeline_id, ws, p_sector; RETURN;
  END IF;
  INSERT INTO public.business_boards(workspace_id,sector_id,owner_id,kind,name,visibility,access_mode,created_by)
    VALUES(ws,p_sector,auth.uid(),'pipeline',btrim(p_name),p_visibility,CASE WHEN p_visibility='sector' THEN 'sector' ELSE 'members' END,auth.uid()) RETURNING id INTO b;
  INSERT INTO public.pipelines(workspace_id,board_id,owner_id,sector_id,visibility,name,slug)
    VALUES(ws,b,auth.uid(),p_sector,p_visibility,btrim(p_name),'board-'||b::text) RETURNING id INTO p;
  INSERT INTO public.stages(workspace_id,pipeline_id,name,color,position)
    SELECT ws,p,c->>'name','blue',(n-1)::integer FROM jsonb_array_elements(names) WITH ORDINALITY a(c,n) ORDER BY n;
  INSERT INTO app_private.pipeline_setup_requests(actor_id,request_id,board_id,pipeline_id,payload) VALUES(auth.uid(),p_request,b,p,payload);
  RETURN QUERY SELECT b,p,ws,p_sector;
END; $$;

REVOKE ALL ON FUNCTION public.business_pipeline_setup_scopes(), public.business_pipeline_setup_status(uuid),
  public.business_create_pipeline_setup(uuid,text,jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_pipeline_setup_scopes(), public.business_pipeline_setup_status(uuid),
  public.business_create_pipeline_setup(uuid,text,jsonb,uuid,text) TO authenticated,service_role;

-- Keep the existing private-organization onboarding and task board. A pipeline is
-- now created only by explicit confirmation. Existing boards are never touched.
CREATE OR REPLACE FUNCTION app_private.onboard_own_organization() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws uuid;s uuid;sector_code text; BEGIN
 sector_code:=lower(btrim(coalesce(NEW.raw_user_meta_data->>'sector','')));
 IF sector_code NOT IN ('financeiro','relacionamento','comercial') THEN RETURN NEW; END IF;
 SELECT w.id INTO ws FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id AND m.user_id=NEW.id
 WHERE w.owner_id=NEW.id AND m.active AND NOT EXISTS(SELECT 1 FROM public.workspace_members other WHERE other.workspace_id=w.id AND other.user_id<>NEW.id)
 ORDER BY w.created_at DESC LIMIT 1;
 IF ws IS NULL THEN RETURN NEW; END IF;
 INSERT INTO public.task_sectors(workspace_id,name,code) VALUES(ws,CASE sector_code WHEN 'financeiro' THEN 'Financeiro' WHEN 'relacionamento' THEN 'Relacionamento' ELSE 'Comercial' END,sector_code)
 RETURNING id INTO s;
 INSERT INTO public.task_sector_members(workspace_id,sector_id,user_id) VALUES(ws,s,NEW.id);
 PERFORM app_private.create_board(ws,s,NEW.id,'tasks','Minhas tarefas');
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.business_onboard_personal(p_sector text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws uuid;s uuid;BEGIN
 IF auth.uid() IS NULL OR p_sector NOT IN ('financeiro','relacionamento','comercial') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 IF EXISTS(SELECT 1 FROM public.task_sector_members WHERE user_id=auth.uid()) THEN RETURN;END IF;
 SELECT w.id INTO ws FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id AND m.user_id=auth.uid()
 WHERE w.owner_id=auth.uid() AND m.active AND NOT EXISTS(SELECT 1 FROM public.workspace_members other WHERE other.workspace_id=w.id AND other.user_id<>auth.uid())
 AND NOT EXISTS(SELECT 1 FROM public.task_sectors s WHERE s.workspace_id=w.id)
 ORDER BY w.created_at LIMIT 1 FOR UPDATE OF w;
 IF ws IS NULL THEN RAISE EXCEPTION 'ASSOCIATION_REQUIRED' USING ERRCODE='42501';END IF;
 INSERT INTO public.task_sectors(workspace_id,name,code) VALUES(ws,CASE p_sector WHEN 'financeiro' THEN 'Financeiro' WHEN 'relacionamento' THEN 'Relacionamento' ELSE 'Comercial' END,p_sector) RETURNING id INTO s;
 INSERT INTO public.task_sector_members(workspace_id,sector_id,user_id) VALUES(ws,s,auth.uid());
 PERFORM app_private.create_board(ws,s,auth.uid(),'tasks','Minhas tarefas');
END;$$;
NOTIFY pgrst,'reload schema';
