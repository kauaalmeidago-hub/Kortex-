-- Apply this migration as one transaction. The isolation boundary must never
-- be deployed as a partially applied set of policies/functions.

-- ===== business_scope_foundation =====
-- Additive isolation foundation. Existing records remain intact; unknown scope
-- is restricted until explicitly reconciled. Profile declarations grant no team access.
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.task_sectors ADD COLUMN IF NOT EXISTS code text;
WITH named AS (
 SELECT id, workspace_id, CASE lower(btrim(name)) WHEN 'financeiro' THEN 'financeiro'
 WHEN 'relacionamento' THEN 'relacionamento' WHEN 'comercial' THEN 'comercial' END AS code
 FROM public.task_sectors
), unambiguous AS (SELECT workspace_id,code FROM named WHERE code IS NOT NULL GROUP BY workspace_id,code HAVING count(*)=1)
UPDATE public.task_sectors s SET code=n.code FROM named n JOIN unambiguous u USING(workspace_id,code) WHERE s.id=n.id;
CREATE UNIQUE INDEX task_sector_canonical_code ON public.task_sectors(workspace_id,code) WHERE code IS NOT NULL;
ALTER TABLE public.task_sectors ADD CHECK(code IS NULL OR code IN ('financeiro','relacionamento','comercial'));
ALTER TABLE public.task_sector_members
 ADD COLUMN active boolean NOT NULL DEFAULT true,
 ADD COLUMN can_create boolean NOT NULL DEFAULT true,
 ADD COLUMN can_dispatch boolean NOT NULL DEFAULT false,
 ADD COLUMN can_manage_boards boolean NOT NULL DEFAULT false,
 ADD COLUMN can_manage_members boolean NOT NULL DEFAULT false,
 ADD COLUMN can_read_personal boolean NOT NULL DEFAULT false;

CREATE TABLE public.business_boards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 sector_id uuid NOT NULL, owner_id uuid NOT NULL REFERENCES auth.users(id),
 kind text NOT NULL CHECK(kind IN ('tasks','pipeline')),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 visibility text NOT NULL DEFAULT 'personal' CHECK(visibility IN ('personal','sector','restricted')),
 access_mode text NOT NULL DEFAULT 'members' CHECK(access_mode IN ('members','sector')),
 archived boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,sector_id) REFERENCES public.task_sectors(workspace_id,id),
 UNIQUE(workspace_id,sector_id,id), UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX business_personal_board ON public.business_boards(workspace_id,sector_id,owner_id,kind)
 WHERE visibility='personal' AND kind='tasks' AND NOT archived;
CREATE TABLE public.business_board_members (
 workspace_id uuid NOT NULL,sector_id uuid NOT NULL,board_id uuid NOT NULL,user_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true,can_write boolean NOT NULL DEFAULT false,
 can_manage boolean NOT NULL DEFAULT false,can_share boolean NOT NULL DEFAULT false,
 can_read_personal boolean NOT NULL DEFAULT false,
 PRIMARY KEY(board_id,user_id),
 FOREIGN KEY(workspace_id,sector_id,board_id) REFERENCES public.business_boards(workspace_id,sector_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,sector_id,user_id) REFERENCES public.task_sector_members(workspace_id,sector_id,user_id) ON DELETE CASCADE
);
ALTER TABLE public.tasks ADD COLUMN board_id uuid, ADD COLUMN owner_id uuid REFERENCES auth.users(id),
 ADD COLUMN visibility text NOT NULL DEFAULT 'restricted' CHECK(visibility IN ('personal','assigned','sector','restricted'));
ALTER TABLE public.task_stages ADD COLUMN board_id uuid REFERENCES public.business_boards(id);
ALTER TABLE public.task_stages ADD UNIQUE(workspace_id,board_id,id);
ALTER TABLE public.tasks ADD FOREIGN KEY(workspace_id,sector_id,board_id) REFERENCES public.business_boards(workspace_id,sector_id,id),
 ADD FOREIGN KEY(workspace_id,board_id,stage_id) REFERENCES public.task_stages(workspace_id,board_id,id);
ALTER TABLE public.pipelines ADD COLUMN board_id uuid UNIQUE REFERENCES public.business_boards(id),
 ADD COLUMN owner_id uuid REFERENCES auth.users(id), ADD COLUMN sector_id uuid,
 ADD COLUMN visibility text NOT NULL DEFAULT 'restricted' CHECK(visibility IN ('personal','sector','restricted'));
ALTER TABLE public.pipelines ADD UNIQUE(workspace_id,id),
 ADD FOREIGN KEY(workspace_id,sector_id,board_id) REFERENCES public.business_boards(workspace_id,sector_id,id);
ALTER TABLE public.stages ADD UNIQUE(workspace_id,pipeline_id,id),
 ADD FOREIGN KEY(workspace_id,pipeline_id) REFERENCES public.pipelines(workspace_id,id) NOT VALID;
ALTER TABLE public.leads ADD COLUMN owner_id uuid REFERENCES auth.users(id),ADD COLUMN sector_id uuid,
 ADD COLUMN visibility text NOT NULL DEFAULT 'restricted' CHECK(visibility IN ('personal','assigned','sector','restricted')),
 ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.leads ADD FOREIGN KEY(workspace_id,sector_id) REFERENCES public.task_sectors(workspace_id,id),
 ADD FOREIGN KEY(workspace_id,pipeline_id) REFERENCES public.pipelines(workspace_id,id) NOT VALID,
 ADD FOREIGN KEY(workspace_id,pipeline_id,stage_id) REFERENCES public.stages(workspace_id,pipeline_id,id) NOT VALID;
CREATE INDEX tasks_board_scope ON public.tasks(workspace_id,sector_id,board_id);
CREATE INDEX leads_pipeline_scope ON public.leads(workspace_id,sector_id,pipeline_id);

CREATE TABLE public.task_participants (
 task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES auth.users(id),
 can_edit boolean NOT NULL DEFAULT false,PRIMARY KEY(task_id,user_id)
);
CREATE TABLE public.lead_participants (
 lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES auth.users(id),
 can_edit boolean NOT NULL DEFAULT false,PRIMARY KEY(lead_id,user_id)
);
CREATE FUNCTION app_private.member(p_workspace uuid,p_sector uuid,p_user uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p_user IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.task_sector_members m JOIN public.workspace_members w USING(workspace_id,user_id)
 JOIN public.task_sectors s ON s.workspace_id=m.workspace_id AND s.id=m.sector_id
 JOIN auth.users u ON u.id=m.user_id
 WHERE m.workspace_id=p_workspace AND m.sector_id=p_sector AND m.user_id=p_user AND m.active AND w.active
 AND s.active AND s.code IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<now()));
$$;
CREATE FUNCTION public.business_can_sector(p_sector uuid,p_capability text DEFAULT 'read') RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.task_sector_members m WHERE m.sector_id=p_sector AND m.user_id=auth.uid()
 AND app_private.member(m.workspace_id,m.sector_id,auth.uid()) AND CASE p_capability
 WHEN 'read' THEN true WHEN 'create' THEN m.can_create WHEN 'dispatch' THEN m.can_dispatch
 WHEN 'manage_boards' THEN m.can_manage_boards WHEN 'manage_members' THEN m.can_manage_members
 WHEN 'read_personal' THEN m.can_read_personal ELSE false END);
$$;
CREATE FUNCTION public.business_can_board(p_board uuid,p_capability text DEFAULT 'read') RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.business_boards b
 LEFT JOIN public.business_board_members bm ON bm.board_id=b.id AND bm.user_id=auth.uid() AND bm.active
 WHERE b.id=p_board AND NOT b.archived AND b.visibility<>'restricted'
 AND app_private.member(b.workspace_id,b.sector_id,auth.uid())
 AND (b.owner_id=auth.uid() OR bm.user_id IS NOT NULL OR (b.visibility='sector' AND b.access_mode='sector'))
 AND CASE p_capability WHEN 'read' THEN true
 WHEN 'write' THEN b.owner_id=auth.uid() OR coalesce(bm.can_write,false)
 WHEN 'manage' THEN b.owner_id=auth.uid() OR coalesce(bm.can_manage,false)
 WHEN 'share' THEN public.business_can_sector(b.sector_id,'dispatch') AND (b.owner_id=auth.uid() OR coalesce(bm.can_share,false) OR coalesce(bm.can_manage,false))
 WHEN 'dispatch' THEN public.business_can_sector(b.sector_id,'dispatch') AND (b.owner_id=auth.uid() OR coalesce(bm.can_write,false) OR coalesce(bm.can_manage,false))
 WHEN 'read_personal' THEN public.business_can_sector(b.sector_id,'read_personal') AND coalesce(bm.can_read_personal,false)
 ELSE false END);
$$;
CREATE OR REPLACE FUNCTION public.task_can_read(p_task_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND t.visibility<>'restricted'
 AND public.business_can_board(t.board_id,'read') AND CASE t.visibility
 WHEN 'sector' THEN true ELSE t.owner_id=auth.uid() OR t.assigned_to=auth.uid()
 OR EXISTS(SELECT 1 FROM public.task_participants p WHERE p.task_id=t.id AND p.user_id=auth.uid())
 OR public.business_can_board(t.board_id,'read_personal') END);
$$;
CREATE OR REPLACE FUNCTION public.task_can_edit(p_task_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND public.task_can_read(t.id)
 AND public.business_can_board(t.board_id,'write') AND (t.owner_id=auth.uid() OR t.assigned_to=auth.uid()
 OR EXISTS(SELECT 1 FROM public.task_participants p WHERE p.task_id=t.id AND p.user_id=auth.uid() AND p.can_edit)
 OR (t.visibility<>'personal' AND public.business_can_board(t.board_id,'dispatch'))
 OR public.business_can_board(t.board_id,'read_personal')));
$$;
CREATE FUNCTION public.business_can_lead(p_lead uuid,p_write boolean DEFAULT false) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.leads l JOIN public.pipelines p ON p.id=l.pipeline_id
 WHERE l.id=p_lead AND l.visibility<>'restricted' AND p.visibility<>'restricted'
 AND l.sector_id=p.sector_id AND public.business_can_board(p.board_id,CASE WHEN p_write THEN 'write' ELSE 'read' END)
 AND (l.visibility='sector' OR l.owner_id=auth.uid() OR l.assigned_to=auth.uid()
 OR EXISTS(SELECT 1 FROM public.business_boards b WHERE b.id=p.board_id AND b.visibility='personal')
 OR EXISTS(SELECT 1 FROM public.lead_participants m WHERE m.lead_id=l.id AND m.user_id=auth.uid() AND (NOT p_write OR m.can_edit))
 OR public.business_can_board(p.board_id,'read_personal'))
 AND (NOT p_write OR l.owner_id=auth.uid() OR l.assigned_to=auth.uid()
 OR (l.visibility='sector' AND public.business_can_board(p.board_id,'write'))
 OR EXISTS(SELECT 1 FROM public.business_boards b WHERE b.id=p.board_id AND b.visibility='personal' AND public.business_can_board(b.id,'write'))
 OR EXISTS(SELECT 1 FROM public.lead_participants m WHERE m.lead_id=l.id AND m.user_id=auth.uid() AND m.can_edit)
 OR public.business_can_board(p.board_id,'read_personal')));
$$;

-- Remove every permissive predecessor on these relations; policies combine with OR.
DO $$ DECLARE r record; BEGIN FOR r IN SELECT schemaname,tablename,policyname FROM pg_policies
 WHERE schemaname='public' AND tablename IN ('tasks','pipelines','stages','leads','task_stages','task_sectors','task_sector_members','task_events') LOOP
 EXECUTE format('DROP POLICY %I ON %I.%I',r.policyname,r.schemaname,r.tablename); END LOOP; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['business_boards','business_board_members','task_participants','lead_participants'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);END LOOP; END $$;
REVOKE ALL ON public.tasks,public.pipelines,public.stages,public.leads,public.task_stages,public.task_sectors,public.task_sector_members,public.task_events FROM anon;
REVOKE INSERT,UPDATE,DELETE ON public.business_boards,public.business_board_members,public.task_participants,public.lead_participants,
 public.task_stages,public.task_sectors,public.task_sector_members,public.pipelines,public.stages FROM authenticated;
CREATE POLICY business_boards_read ON public.business_boards FOR SELECT TO authenticated USING(public.business_can_board(id));
CREATE POLICY business_board_members_read ON public.business_board_members FOR SELECT TO authenticated USING(public.business_can_board(board_id) AND (user_id=auth.uid() OR public.business_can_board(board_id,'manage')));
CREATE POLICY task_participants_read ON public.task_participants FOR SELECT TO authenticated USING(public.task_can_read(task_id));
CREATE POLICY lead_participants_read ON public.lead_participants FOR SELECT TO authenticated USING(public.business_can_lead(lead_id));
CREATE FUNCTION public.business_participates(p_kind text,p_id uuid,p_write boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE p_kind WHEN 'tasks' THEN public.task_can_read(p_id) AND EXISTS(SELECT 1 FROM public.task_participants p WHERE p.task_id=p_id AND p.user_id=auth.uid() AND (NOT p_write OR p.can_edit))
 WHEN 'pipeline' THEN public.business_can_lead(p_id) AND EXISTS(SELECT 1 FROM public.lead_participants p WHERE p.lead_id=p_id AND p.user_id=auth.uid() AND (NOT p_write OR p.can_edit)) ELSE false END;$$;
CREATE POLICY tasks_read ON public.tasks FOR SELECT TO authenticated USING(visibility<>'restricted' AND public.business_can_board(board_id)
 AND (visibility='sector' OR owner_id=auth.uid() OR assigned_to=auth.uid() OR public.business_participates('tasks',id) OR public.business_can_board(board_id,'read_personal')));
CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO authenticated WITH CHECK(created_by=auth.uid() AND public.business_can_board(board_id,'write'));
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated USING(public.task_can_edit(id)) WITH CHECK(public.business_can_board(board_id,'write'));
CREATE POLICY tasks_delete ON public.tasks FOR DELETE TO authenticated USING(public.task_can_edit(id));
CREATE POLICY pipelines_read ON public.pipelines FOR SELECT TO authenticated USING(public.business_can_board(board_id));
CREATE POLICY stages_read ON public.stages FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.pipelines p WHERE p.id=pipeline_id AND p.workspace_id=stages.workspace_id AND public.business_can_board(p.board_id)));
CREATE POLICY leads_read ON public.leads FOR SELECT TO authenticated USING(visibility<>'restricted' AND EXISTS(SELECT 1 FROM public.pipelines p WHERE p.id=pipeline_id AND p.workspace_id=leads.workspace_id AND p.sector_id=leads.sector_id AND public.business_can_board(p.board_id)
 AND (leads.visibility='sector' OR leads.owner_id=auth.uid() OR leads.assigned_to=auth.uid() OR EXISTS(SELECT 1 FROM public.business_boards b WHERE b.id=p.board_id AND b.visibility='personal') OR public.business_participates('pipeline',leads.id) OR public.business_can_board(p.board_id,'read_personal'))));
CREATE POLICY leads_insert ON public.leads FOR INSERT TO authenticated WITH CHECK(created_by=auth.uid() AND EXISTS(SELECT 1 FROM public.pipelines p WHERE p.id=pipeline_id AND public.business_can_board(p.board_id,'write')));
CREATE POLICY leads_update ON public.leads FOR UPDATE TO authenticated USING(public.business_can_lead(id,true)) WITH CHECK(EXISTS(SELECT 1 FROM public.pipelines p WHERE p.id=pipeline_id AND public.business_can_board(p.board_id,'write')));
CREATE POLICY leads_delete ON public.leads FOR DELETE TO authenticated USING(public.business_can_lead(id,true));
CREATE POLICY task_stages_read ON public.task_stages FOR SELECT TO authenticated USING(public.business_can_board(board_id));
CREATE POLICY task_sectors_read ON public.task_sectors FOR SELECT TO authenticated USING(public.business_can_sector(id));
CREATE POLICY task_sector_members_read ON public.task_sector_members FOR SELECT TO authenticated USING(public.business_can_sector(sector_id) AND (user_id=auth.uid() OR public.business_can_sector(sector_id,'manage_members')));
CREATE POLICY task_events_read ON public.task_events FOR SELECT TO authenticated USING(task_id IS NOT NULL AND public.task_can_read(task_id));

-- A generic administrator is not a scoped manager. Only the organization owner
-- can provision memberships; scoped delegates are limited to their granted sector.
CREATE FUNCTION app_private.workspace_owner(p_workspace uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id AND m.user_id=auth.uid()
 WHERE w.id=p_workspace AND w.owner_id=auth.uid() AND m.active);
$$;
DO $$ DECLARE r record; BEGIN FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='workspace_members' LOOP
 EXECUTE format('DROP POLICY %I ON public.workspace_members',r.policyname);END LOOP;END $$;
CREATE FUNCTION public.business_is_owner(p_workspace uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app_private.workspace_owner(p_workspace); $$;
CREATE POLICY members_select_scoped ON public.workspace_members FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.business_is_owner(workspace_id));
CREATE POLICY members_insert_owner ON public.workspace_members FOR INSERT TO authenticated WITH CHECK(public.business_is_owner(workspace_id));
CREATE POLICY members_update_owner ON public.workspace_members FOR UPDATE TO authenticated USING(public.business_is_owner(workspace_id)) WITH CHECK(public.business_is_owner(workspace_id));
CREATE POLICY members_delete_owner ON public.workspace_members FOR DELETE TO authenticated USING(public.business_is_owner(workspace_id) AND user_id<>auth.uid());
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid,_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspace_members m JOIN auth.users u ON u.id=m.user_id WHERE m.workspace_id=_workspace_id AND m.user_id=_user_id AND m.active AND (u.banned_until IS NULL OR u.banned_until<now()));
$$;
CREATE OR REPLACE FUNCTION public.is_workspace_admin(_workspace_id uuid,_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=_workspace_id AND m.user_id=_user_id AND m.active AND m.role='admin');
$$;

CREATE FUNCTION public.business_contexts() RETURNS TABLE(board_id uuid,workspace_id uuid,sector_id uuid,sector_name text,board_name text,kind text,visibility text,
 can_write boolean,can_manage boolean,can_dispatch boolean,can_share boolean,pipeline_id uuid,version timestamptz,workspace_name text,can_create_shared boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT b.id,b.workspace_id,b.sector_id,s.name,b.name,b.kind,b.visibility,public.business_can_board(b.id,'write'),
 public.business_can_board(b.id,'manage'),public.business_can_board(b.id,'dispatch'),public.business_can_board(b.id,'share'),p.id,b.updated_at,w.name,public.business_can_sector(b.sector_id,'manage_boards')
 FROM public.business_boards b JOIN public.task_sectors s ON s.id=b.sector_id AND s.workspace_id=b.workspace_id
 JOIN public.workspaces w ON w.id=b.workspace_id
 LEFT JOIN public.pipelines p ON p.board_id=b.id AND p.visibility<>'restricted'
 WHERE public.business_can_board(b.id) ORDER BY s.name,b.name,b.id;
$$;
DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='app_private' OR (n.nspname='public' AND p.proname LIKE 'business_%') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 IF f.signature::text NOT LIKE 'app_private.%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f.signature); END IF;
 END LOOP; END $$;


-- ===== business_provisioning =====
CREATE FUNCTION app_private.create_board(p_workspace uuid,p_sector uuid,p_owner uuid,p_kind text,p_name text,
 p_visibility text DEFAULT 'personal',p_access text DEFAULT 'members') RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b uuid; pipeline uuid; BEGIN
 IF NOT app_private.member(p_workspace,p_sector,p_owner) OR p_kind NOT IN ('tasks','pipeline') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 INSERT INTO public.business_boards(workspace_id,sector_id,owner_id,kind,name,visibility,access_mode,created_by)
 VALUES(p_workspace,p_sector,p_owner,p_kind,btrim(p_name),p_visibility,p_access,p_owner) RETURNING id INTO b;
 IF p_kind='tasks' THEN
  INSERT INTO public.task_stages(workspace_id,board_id,id,name,color,position,base_status)
  SELECT p_workspace,b,gen_random_uuid()::text,v.name,'blue',v.position,v.status::public.task_status
  FROM (VALUES('A fazer',0,'todo'),('Em andamento',1,'in_progress'),('Em revisão',2,'review'),('Concluído',3,'done')) v(name,position,status);
 ELSE
  INSERT INTO public.pipelines(workspace_id,board_id,owner_id,sector_id,visibility,name,slug)
  VALUES(p_workspace,b,p_owner,p_sector,p_visibility,btrim(p_name),'board-'||b::text) RETURNING id INTO pipeline;
  INSERT INTO public.stages(workspace_id,pipeline_id,name,color,position)
  SELECT p_workspace,pipeline,v.name,'blue',v.position
  FROM (VALUES('Entrada',0),('Qualificação',1),('Proposta',2),('Negociação',3),('Fechado',4)) v(name,position);
 END IF;
 RETURN b;
END; $$;
CREATE FUNCTION public.business_create_board(p_sector uuid,p_kind text,p_name text,p_visibility text DEFAULT 'personal',p_access text DEFAULT 'members')
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws uuid; BEGIN
 SELECT workspace_id INTO ws FROM public.task_sectors WHERE id=p_sector;
 IF NOT public.business_can_sector(p_sector,'create') OR p_visibility NOT IN ('personal','sector') OR p_access NOT IN ('members','sector')
 OR (p_visibility='personal' AND p_access<>'members') OR (p_visibility='sector' AND NOT public.business_can_sector(p_sector,'manage_boards'))
 THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 RETURN app_private.create_board(ws,p_sector,auth.uid(),p_kind,p_name,p_visibility,p_access);
END; $$;
CREATE FUNCTION public.business_set_sector_member(p_sector uuid,p_user uuid,p_active boolean,p_dispatch boolean DEFAULT false,
 p_manage_boards boolean DEFAULT false,p_manage_members boolean DEFAULT false,p_read_personal boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws uuid; owner_access boolean; BEGIN
 SELECT workspace_id INTO ws FROM public.task_sectors WHERE id=p_sector AND active AND code IS NOT NULL FOR UPDATE;
 owner_access:=app_private.workspace_owner(ws);
 IF ws IS NULL OR (NOT owner_access AND (NOT public.business_can_sector(p_sector,'manage_members') OR p_user=auth.uid()
 OR p_dispatch OR p_manage_boards OR p_manage_members OR p_read_personal))
 OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ws AND user_id=p_user AND active)
 THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF NOT owner_access AND EXISTS(SELECT 1 FROM public.workspaces WHERE id=ws AND owner_id=p_user) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 INSERT INTO public.task_sector_members AS m(workspace_id,sector_id,user_id,active,can_dispatch,can_manage_boards,can_manage_members,can_read_personal)
 VALUES(ws,p_sector,p_user,p_active,p_dispatch,p_manage_boards,p_manage_members,p_read_personal)
 ON CONFLICT(workspace_id,sector_id,user_id) DO UPDATE SET active=EXCLUDED.active,
 can_dispatch=CASE WHEN owner_access THEN EXCLUDED.can_dispatch ELSE m.can_dispatch END,
 can_manage_boards=CASE WHEN owner_access THEN EXCLUDED.can_manage_boards ELSE m.can_manage_boards END,
 can_manage_members=CASE WHEN owner_access THEN EXCLUDED.can_manage_members ELSE m.can_manage_members END,
 can_read_personal=CASE WHEN owner_access THEN EXCLUDED.can_read_personal ELSE m.can_read_personal END;
 IF p_active THEN
  IF NOT EXISTS(SELECT 1 FROM public.business_boards WHERE workspace_id=ws AND sector_id=p_sector AND owner_id=p_user AND kind='tasks' AND visibility='personal' AND NOT archived)
  THEN PERFORM app_private.create_board(ws,p_sector,p_user,'tasks','Minhas tarefas'); END IF;
 END IF;
END; $$;
CREATE FUNCTION public.business_set_board_member(p_board uuid,p_user uuid,p_active boolean,p_write boolean DEFAULT false,p_manage boolean DEFAULT false,
 p_share boolean DEFAULT false,p_read_personal boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards; BEGIN
 SELECT * INTO b FROM public.business_boards WHERE id=p_board FOR UPDATE;
 IF NOT public.business_can_board(p_board,'manage') OR NOT app_private.member(b.workspace_id,b.sector_id,p_user)
 OR (p_read_personal AND NOT public.business_can_sector(b.sector_id,'read_personal'))
 OR (p_share AND NOT public.business_can_sector(b.sector_id,'dispatch'))
 THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 INSERT INTO public.business_board_members(workspace_id,sector_id,board_id,user_id,active,can_write,can_manage,can_share,can_read_personal)
 VALUES(b.workspace_id,b.sector_id,b.id,p_user,p_active,p_write,p_manage,p_share,p_read_personal)
 ON CONFLICT(board_id,user_id) DO UPDATE SET active=EXCLUDED.active,can_write=EXCLUDED.can_write,can_manage=EXCLUDED.can_manage,can_share=EXCLUDED.can_share,can_read_personal=EXCLUDED.can_read_personal;
END; $$;

-- Provision only the newly created, exclusively owned organization. Selecting a
-- profile sector never enrols someone into any pre-existing team or shared board.
CREATE FUNCTION app_private.onboard_own_organization() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 PERFORM app_private.create_board(ws,s,NEW.id,'pipeline','Minha pipeline');
 RETURN NEW;
END; $$;
CREATE TRIGGER zz_business_onboarding AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION app_private.onboard_own_organization();

-- Only provable personal ownership plus one already-authorized sector is eligible
-- for legacy backfill. Mixed or missing provenance stays preserved/restricted.
DO $$ DECLARE r record;b uuid;st text;BEGIN
 FOR r IN SELECT t.id,t.workspace_id,t.created_by,t.status,m.sector_id FROM public.tasks t
 JOIN public.task_sector_members m ON m.workspace_id=t.workspace_id AND m.user_id=t.created_by
 WHERE t.sector_id IS NULL AND t.created_by IS NOT NULL AND t.assigned_to=t.created_by
 AND app_private.member(t.workspace_id,m.sector_id,t.created_by)
 AND (SELECT count(*) FROM public.task_sector_members sm WHERE sm.workspace_id=t.workspace_id AND sm.user_id=t.created_by AND app_private.member(sm.workspace_id,sm.sector_id,sm.user_id))=1
 LOOP
  SELECT id INTO b FROM public.business_boards WHERE workspace_id=r.workspace_id AND sector_id=r.sector_id AND owner_id=r.created_by AND kind='tasks' AND visibility='personal' AND NOT archived;
  IF b IS NULL THEN b:=app_private.create_board(r.workspace_id,r.sector_id,r.created_by,'tasks','Minhas tarefas'); END IF;
  SELECT id INTO st FROM public.task_stages WHERE board_id=b AND base_status=r.status ORDER BY position LIMIT 1;
  IF st IS NULL THEN INSERT INTO public.task_stages(workspace_id,board_id,id,name,color,position,base_status,archived)
   VALUES(r.workspace_id,b,gen_random_uuid()::text,'Cancelado','slate',99,'canceled',true) RETURNING id INTO st; END IF;
  -- The existing write trigger requires auth.uid(); backfill is postponed to the
  -- dedicated task migration, after its migration-safe guard is installed.
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app_private.create_board(uuid,uuid,uuid,text,text,text,text),app_private.onboard_own_organization() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('business_create_board','business_set_sector_member','business_set_board_member') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',f.sig);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f.sig);END LOOP; END $$;


-- ===== business_catalog_scope =====
-- Catalog rows without a proven sector stay quarantined, including old demo data.
ALTER TABLE public.companies ADD COLUMN sector_id uuid,ADD COLUMN owner_id uuid REFERENCES auth.users(id),
 ADD COLUMN visibility text NOT NULL DEFAULT 'restricted' CHECK(visibility IN ('personal','sector','restricted'));
ALTER TABLE public.companies ADD FOREIGN KEY(workspace_id,sector_id) REFERENCES public.task_sectors(workspace_id,id);
ALTER TABLE public.contacts ADD COLUMN sector_id uuid,ADD COLUMN owner_id uuid REFERENCES auth.users(id),
 ADD COLUMN visibility text NOT NULL DEFAULT 'restricted' CHECK(visibility IN ('personal','sector','restricted'));
ALTER TABLE public.contacts ADD FOREIGN KEY(workspace_id,sector_id) REFERENCES public.task_sectors(workspace_id,id);
CREATE FUNCTION public.business_can_company(p_id uuid,p_write boolean DEFAULT false) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.companies c WHERE c.id=p_id AND c.visibility<>'restricted'
 AND public.business_can_sector(c.sector_id) AND (c.owner_id=auth.uid() OR c.visibility='sector')
 AND (NOT p_write OR c.owner_id=auth.uid() OR public.business_can_sector(c.sector_id,'dispatch')));
$$;
CREATE FUNCTION public.business_can_contact(p_id uuid,p_write boolean DEFAULT false) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=p_id AND c.visibility<>'restricted'
 AND public.business_can_sector(c.sector_id) AND (c.owner_id=auth.uid() OR c.visibility='sector')
 AND (c.company_id IS NULL OR public.business_can_company(c.company_id))
 AND (NOT p_write OR c.owner_id=auth.uid() OR public.business_can_sector(c.sector_id,'dispatch')));
$$;
CREATE FUNCTION app_private.guard_catalog() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.sector_id IS NULL AND TG_TABLE_NAME='contacts' THEN
   SELECT c.sector_id INTO NEW.sector_id FROM public.companies c WHERE c.id=NEW.company_id AND c.workspace_id=NEW.workspace_id AND public.business_can_company(c.id);
  END IF;
  IF NEW.sector_id IS NULL AND (SELECT count(*) FROM public.task_sector_members m WHERE m.workspace_id=NEW.workspace_id AND m.user_id=auth.uid() AND app_private.member(m.workspace_id,m.sector_id,m.user_id))=1 THEN
   SELECT m.sector_id INTO NEW.sector_id FROM public.task_sector_members m WHERE m.workspace_id=NEW.workspace_id AND m.user_id=auth.uid() AND app_private.member(m.workspace_id,m.sector_id,m.user_id);
  END IF;
  IF NEW.visibility='restricted' THEN NEW.visibility:='personal';END IF;
 END IF;
 IF NOT public.business_can_sector(NEW.sector_id,'create') OR NEW.visibility NOT IN ('personal','sector')
 OR NOT app_private.member(NEW.workspace_id,NEW.sector_id,auth.uid()) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF (NEW.created_by IS NOT NULL AND NEW.created_by<>auth.uid()) OR (NEW.owner_id IS NOT NULL AND NEW.owner_id<>auth.uid()) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  NEW.created_by:=auth.uid();NEW.created_at:=now();NEW.updated_at:=now();NEW.owner_id:=auth.uid();
 ELSE
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.sector_id IS DISTINCT FROM OLD.sector_id
  OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at<>OLD.created_at
  THEN RAISE EXCEPTION 'SCOPE_IMMUTABLE' USING ERRCODE='42501'; END IF;
 END IF;
 IF NEW.visibility='sector' AND NOT public.business_can_sector(NEW.sector_id,'dispatch')
 AND (TG_OP='INSERT' OR NEW.visibility IS DISTINCT FROM OLD.visibility) THEN RAISE EXCEPTION 'SHARING_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='contacts' THEN
 IF NEW.company_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.companies c
  WHERE c.id=NEW.company_id AND c.workspace_id=NEW.workspace_id AND c.sector_id=NEW.sector_id AND public.business_can_company(c.id))
 THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER business_catalog_guard BEFORE INSERT OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION app_private.guard_catalog();
CREATE TRIGGER business_catalog_guard BEFORE INSERT OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION app_private.guard_catalog();
DO $$ DECLARE r record;BEGIN FOR r IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public'
 AND tablename IN ('companies','contacts','profiles','activities','notes','company_files') LOOP
 EXECUTE format('DROP POLICY %I ON public.%I',r.policyname,r.tablename);END LOOP;END $$;
CREATE POLICY company_read ON public.companies FOR SELECT TO authenticated USING(visibility<>'restricted' AND public.business_can_sector(sector_id) AND (owner_id=auth.uid() OR visibility='sector'));
CREATE POLICY company_insert ON public.companies FOR INSERT TO authenticated WITH CHECK(owner_id=auth.uid() AND public.business_can_sector(sector_id,'create'));
CREATE POLICY company_update ON public.companies FOR UPDATE TO authenticated USING(public.business_can_company(id,true)) WITH CHECK(public.business_can_company(id,true));
CREATE POLICY company_delete ON public.companies FOR DELETE TO authenticated USING(public.business_can_company(id,true));
CREATE POLICY contact_read ON public.contacts FOR SELECT TO authenticated USING(visibility<>'restricted' AND public.business_can_sector(sector_id) AND (owner_id=auth.uid() OR visibility='sector') AND (company_id IS NULL OR public.business_can_company(company_id)));
CREATE POLICY contact_insert ON public.contacts FOR INSERT TO authenticated WITH CHECK(owner_id=auth.uid() AND public.business_can_sector(sector_id,'create'));
CREATE POLICY contact_update ON public.contacts FOR UPDATE TO authenticated USING(public.business_can_contact(id,true)) WITH CHECK(public.business_can_contact(id,true));
CREATE POLICY contact_delete ON public.contacts FOR DELETE TO authenticated USING(public.business_can_contact(id,true));
-- Profiles are personal. The minimal authorized directory is an explicit RPC.
CREATE POLICY profiles_own_read ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid());
CREATE POLICY profiles_own_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK(id=auth.uid());
CREATE POLICY profiles_own_update ON public.profiles FOR UPDATE TO authenticated USING(id=auth.uid()) WITH CHECK(id=auth.uid());
CREATE FUNCTION public.business_people(p_board uuid) RETURNS TABLE(user_id uuid,full_name text,email text,role public.app_role)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;BEGIN
 IF NOT public.business_can_board(p_board) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.business_boards WHERE id=p_board;
 RETURN QUERY SELECT m.user_id,p.full_name,u.email::text,'member'::public.app_role
 FROM public.task_sector_members m JOIN auth.users u ON u.id=m.user_id LEFT JOIN public.profiles p ON p.id=m.user_id
 WHERE m.workspace_id=b.workspace_id AND m.sector_id=b.sector_id AND app_private.member(m.workspace_id,m.sector_id,m.user_id)
 AND (m.user_id=auth.uid() OR public.business_can_board(b.id,'dispatch') OR public.business_can_board(b.id,'manage'));
END;$$;
-- The old workspace-wide directory is intentionally closed to older clients.
CREATE OR REPLACE FUNCTION public.task_people(p_workspace uuid) RETURNS TABLE(user_id uuid,full_name text,email text,role public.app_role)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'SCOPED_CLIENT_REQUIRED' USING ERRCODE='42501';END;$$;

CREATE FUNCTION app_private.child_access(p_workspace uuid,p_lead uuid,p_contact uuid,p_company uuid,p_write boolean) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT (p_lead IS NOT NULL OR p_contact IS NOT NULL OR p_company IS NOT NULL)
 AND (p_lead IS NULL OR EXISTS(SELECT 1 FROM public.leads l WHERE l.id=p_lead AND l.workspace_id=p_workspace AND public.business_can_lead(l.id,p_write)))
 AND (p_contact IS NULL OR EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=p_contact AND c.workspace_id=p_workspace AND public.business_can_contact(c.id,p_write)))
 AND (p_company IS NULL OR EXISTS(SELECT 1 FROM public.companies c WHERE c.id=p_company AND c.workspace_id=p_workspace AND public.business_can_company(c.id,p_write)));
$$;
-- Public wrapper exposes only an authorization boolean for supplied UUIDs.
CREATE FUNCTION public.business_child_access(p_workspace uuid,p_lead uuid,p_contact uuid,p_company uuid,p_write boolean DEFAULT false) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app_private.child_access(p_workspace,p_lead,p_contact,p_company,p_write); $$;
CREATE POLICY activities_read ON public.activities FOR SELECT TO authenticated USING(public.business_child_access(workspace_id,lead_id,contact_id,NULL));
CREATE POLICY activities_insert ON public.activities FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND public.business_child_access(workspace_id,lead_id,contact_id,NULL,true));
CREATE POLICY notes_read ON public.notes FOR SELECT TO authenticated USING(public.business_child_access(workspace_id,lead_id,contact_id,company_id));
CREATE POLICY notes_insert ON public.notes FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND public.business_child_access(workspace_id,lead_id,contact_id,company_id,true));
CREATE POLICY notes_update ON public.notes FOR UPDATE TO authenticated USING(user_id=auth.uid() AND public.business_child_access(workspace_id,lead_id,contact_id,company_id,true)) WITH CHECK(user_id=auth.uid() AND public.business_child_access(workspace_id,lead_id,contact_id,company_id,true));
CREATE POLICY notes_delete ON public.notes FOR DELETE TO authenticated USING(user_id=auth.uid() AND public.business_child_access(workspace_id,lead_id,contact_id,company_id,true));
CREATE POLICY company_files_read ON public.company_files FOR SELECT TO authenticated USING(public.business_can_company(company_id));
CREATE POLICY company_files_insert ON public.company_files FOR INSERT TO authenticated WITH CHECK(created_by=auth.uid() AND public.business_can_company(company_id,true));
CREATE POLICY company_files_delete ON public.company_files FOR DELETE TO authenticated USING(public.business_can_company(company_id,true));
REVOKE ALL ON public.companies,public.contacts,public.profiles,public.activities,public.notes,public.company_files FROM anon;
REVOKE UPDATE,DELETE ON public.activities FROM authenticated;
REVOKE UPDATE ON public.company_files FROM authenticated;
DROP POLICY company_media_workspace_read ON storage.objects;
DROP POLICY company_media_workspace_insert ON storage.objects;
DROP POLICY company_media_workspace_delete ON storage.objects;
CREATE POLICY company_media_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='company-media' AND EXISTS(SELECT 1 FROM public.companies c WHERE c.workspace_id::text=(storage.foldername(name))[1] AND c.id::text=(storage.foldername(name))[2] AND public.business_can_company(c.id)));
CREATE POLICY company_media_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='company-media' AND EXISTS(SELECT 1 FROM public.companies c WHERE c.workspace_id::text=(storage.foldername(name))[1] AND c.id::text=(storage.foldername(name))[2] AND public.business_can_company(c.id,true)));
CREATE POLICY company_media_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='company-media' AND EXISTS(SELECT 1 FROM public.companies c WHERE c.workspace_id::text=(storage.foldername(name))[1] AND c.id::text=(storage.foldername(name))[2] AND public.business_can_company(c.id,true)));

-- Stop all demonstration business records for future accounts, retaining real
-- profile + private-organization onboarding and the existing profile-sector hook.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws uuid;person_name text;BEGIN
 person_name:=coalesce(nullif(btrim(NEW.raw_user_meta_data->>'full_name'),''),split_part(NEW.email,'@',1),'Minha conta');
 INSERT INTO public.profiles(id,full_name,avatar_url) VALUES(NEW.id,person_name,NEW.raw_user_meta_data->>'avatar_url');
 INSERT INTO public.workspaces(name,slug,owner_id) VALUES('Minha organização','org-'||NEW.id::text,NEW.id) RETURNING id INTO ws;
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(ws,NEW.id,'admin');
 RETURN NEW;
END;$$;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='app_private' OR (n.nspname='public' AND p.proname LIKE 'business_%') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
 IF f.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f.sig);END IF;END LOOP;END $$;


-- ===== business_writes =====
CREATE FUNCTION app_private.board_user(p_board uuid,p_user uuid,p_write boolean DEFAULT false) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.business_boards b LEFT JOIN public.business_board_members m ON m.board_id=b.id AND m.user_id=p_user AND m.active
 WHERE b.id=p_board AND NOT b.archived AND b.visibility<>'restricted' AND app_private.member(b.workspace_id,b.sector_id,p_user)
 AND (b.owner_id=p_user OR m.user_id IS NOT NULL OR (b.visibility='sector' AND b.access_mode='sector'))
 AND (NOT p_write OR b.owner_id=p_user OR coalesce(m.can_write,false)));
$$;
CREATE OR REPLACE FUNCTION public.guard_task_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;s public.task_stages; changed_scope boolean;BEGIN
 SELECT * INTO b FROM public.business_boards WHERE id=NEW.board_id FOR SHARE;
 IF auth.uid() IS NULL OR NOT public.business_can_board(b.id,'write') OR b.kind<>'tasks'
 OR NEW.workspace_id IS DISTINCT FROM b.workspace_id OR NEW.sector_id IS DISTINCT FROM b.sector_id
 OR NEW.visibility NOT IN ('personal','assigned','sector') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by IS NOT NULL AND NEW.created_by<>auth.uid() THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  NEW.created_by:=auth.uid();NEW.created_at:=now();NEW.updated_at:=now();NEW.owner_id:=coalesce(NEW.owner_id,auth.uid());
  IF NEW.visibility='personal' THEN NEW.assigned_to:=coalesce(NEW.assigned_to,auth.uid());END IF;
  changed_scope:=NEW.visibility<>'personal' OR NEW.owner_id<>auth.uid() OR NEW.assigned_to IS DISTINCT FROM auth.uid();
 ELSE
  IF NOT public.task_can_edit(OLD.id) OR NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id
  OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.request_key IS DISTINCT FROM OLD.request_key
  THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  changed_scope:=NEW.board_id IS DISTINCT FROM OLD.board_id OR NEW.sector_id IS DISTINCT FROM OLD.sector_id
   OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.visibility<>OLD.visibility OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to;
  IF changed_scope AND NOT public.business_can_board(OLD.board_id,'dispatch') THEN RAISE EXCEPTION 'DISPATCH_FORBIDDEN' USING ERRCODE='42501';END IF;
 END IF;
 IF changed_scope AND NOT public.business_can_board(b.id,'dispatch') THEN RAISE EXCEPTION 'DISPATCH_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF NEW.owner_id IS NULL OR NOT app_private.board_user(b.id,NEW.owner_id)
 OR (NEW.assigned_to IS NOT NULL AND NOT app_private.board_user(b.id,NEW.assigned_to,true)) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF NEW.visibility='assigned' AND NEW.assigned_to IS NULL THEN RAISE EXCEPTION 'ASSIGNEE_REQUIRED' USING ERRCODE='22023';END IF;
 IF NEW.visibility='personal' AND NEW.owner_id IS DISTINCT FROM NEW.assigned_to THEN RAISE EXCEPTION 'PERSONAL_OWNER_REQUIRED' USING ERRCODE='22023';END IF;
 IF length(btrim(NEW.title)) NOT BETWEEN 1 AND 240 OR length(coalesce(NEW.description,''))>500 THEN RAISE EXCEPTION 'TASK_INVALID_TEXT' USING ERRCODE='22023';END IF;
 IF NEW.company_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.companies c WHERE c.id=NEW.company_id AND c.workspace_id=b.workspace_id AND c.sector_id=b.sector_id AND public.business_can_company(c.id)) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF NEW.operator IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.companies c CROSS JOIN LATERAL jsonb_array_elements(c.offerings) o WHERE c.workspace_id=b.workspace_id AND c.sector_id=b.sector_id AND public.business_can_company(c.id) AND (NEW.company_id IS NULL OR c.id=NEW.company_id) AND o->>'operator'=NEW.operator) THEN RAISE EXCEPTION 'TASK_INVALID_OPERATOR' USING ERRCODE='22023';END IF;
 IF NEW.project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.companies c WHERE c.workspace_id=b.workspace_id AND c.sector_id=b.sector_id AND public.business_can_company(c.id) AND (NEW.company_id IS NULL OR c.id=NEW.company_id) AND c.project=NEW.project) THEN RAISE EXCEPTION 'TASK_INVALID_PROJECT' USING ERRCODE='22023';END IF;
 IF NEW.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=NEW.contact_id AND c.workspace_id=b.workspace_id AND c.sector_id=b.sector_id AND public.business_can_contact(c.id)) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF NEW.lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.leads l WHERE l.id=NEW.lead_id AND l.workspace_id=b.workspace_id AND l.sector_id=b.sector_id AND public.business_can_lead(l.id)) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM public.task_stages WHERE workspace_id=b.workspace_id AND board_id=b.id AND id=NEW.stage_id AND NOT archived FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TASK_INVALID_STAGE' USING ERRCODE='22023';END IF;
 NEW.status:=s.base_status;
 IF NEW.status='done' THEN NEW.completed_at:=CASE WHEN TG_OP='UPDATE' THEN coalesce(OLD.completed_at,now()) ELSE now() END;ELSE NEW.completed_at:=NULL;END IF;
 IF TG_OP='INSERT' OR changed_scope THEN NEW.assigned_by:=auth.uid();NEW.assigned_at:=now();
 ELSE NEW.assigned_by:=OLD.assigned_by;NEW.assigned_at:=OLD.assigned_at;END IF;
 RETURN NEW;
END;$$;
CREATE FUNCTION public.business_save_task(p_board uuid,p_request uuid,p_id uuid,p_updated timestamptz,p_payload jsonb) RETURNS public.tasks
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;t public.tasks;p jsonb:=p_payload;st text;BEGIN
 IF NOT public.business_can_board(p_board,'write') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.business_boards WHERE id=p_board AND kind='tasks' FOR SHARE;
 IF b.id IS NULL OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF (p ? 'created_by' AND p->>'created_by' IS DISTINCT FROM auth.uid()::text) OR (p ? 'owner_id' AND p->>'owner_id' IS DISTINCT FROM auth.uid()::text)
 OR (p ? 'board_id' AND p->>'board_id' IS DISTINCT FROM b.id::text) OR (p ? 'sector_id' AND nullif(p->>'sector_id','') IS DISTINCT FROM b.sector_id::text)
 OR (p ? 'workspace_id' AND p->>'workspace_id' IS DISTINCT FROM b.workspace_id::text) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 st:=coalesce(nullif(p->>'stage_id',''),(SELECT id FROM public.task_stages WHERE board_id=b.id AND NOT archived ORDER BY position,id LIMIT 1));
 IF p_id IS NULL THEN
  IF p_request IS NULL OR (p ? 'assigned_to' AND p->>'assigned_to' IS DISTINCT FROM auth.uid()::text) OR (p ? 'visibility' AND p->>'visibility'<>'personal') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text||auth.uid()::text,0));
  SELECT * INTO t FROM public.tasks WHERE board_id=b.id AND created_by=auth.uid() AND request_key=p_request;
  IF FOUND THEN IF NOT public.task_can_read(t.id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;RETURN t;END IF;
  INSERT INTO public.tasks(workspace_id,sector_id,board_id,owner_id,visibility,title,description,company_id,operational_code,operator,project,due_date,priority,stage_id,created_by,assigned_to,request_key)
  VALUES(b.workspace_id,b.sector_id,b.id,auth.uid(),'personal',btrim(p->>'title'),nullif(p->>'description',''),nullif(p->>'company_id','')::uuid,nullif(p->>'operational_code',''),nullif(p->>'operator',''),nullif(p->>'project',''),
  CASE WHEN nullif(p->>'due_date','') IS NULL THEN NULL ELSE ((p->>'due_date')::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo' END,
  coalesce(nullif(p->>'priority',''),'medium')::public.task_priority,st,auth.uid(),auth.uid(),p_request) RETURNING * INTO t;
 ELSE
  IF NOT public.task_can_edit(p_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  SELECT * INTO t FROM public.tasks WHERE id=p_id AND board_id=b.id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  IF t.updated_at IS DISTINCT FROM p_updated THEN RAISE EXCEPTION 'TASK_TARGET_VERSION_CONFLICT' USING ERRCODE='40001';END IF;
  IF (p ? 'assigned_to' AND p->>'assigned_to' IS DISTINCT FROM t.assigned_to::text) OR (p ? 'visibility' AND p->>'visibility' IS DISTINCT FROM t.visibility) THEN RAISE EXCEPTION 'SCOPE_IMMUTABLE' USING ERRCODE='42501';END IF;
  UPDATE public.tasks SET title=btrim(p->>'title'),description=nullif(p->>'description',''),company_id=nullif(p->>'company_id','')::uuid,operational_code=nullif(p->>'operational_code',''),operator=nullif(p->>'operator',''),project=nullif(p->>'project',''),
   due_date=CASE WHEN nullif(p->>'due_date','') IS NULL THEN NULL ELSE ((p->>'due_date')::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo' END,
   priority=coalesce(nullif(p->>'priority',''),'medium')::public.task_priority,stage_id=st WHERE id=t.id RETURNING * INTO t;
 END IF;
 RETURN t;
END;$$;
CREATE OR REPLACE FUNCTION public.task_save_personal(p_workspace uuid,p_request uuid,p_id uuid,p_updated timestamptz,p_payload jsonb) RETURNS public.tasks
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'SCOPED_CLIENT_REQUIRED' USING ERRCODE='42501';END;$$;
CREATE OR REPLACE FUNCTION public.task_save_stages(p_workspace uuid,p_stages jsonb) RETURNS SETOF public.task_stages
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'SCOPED_CLIENT_REQUIRED' USING ERRCODE='42501';END;$$;
CREATE FUNCTION public.business_task_permissions(p_board uuid) RETURNS TABLE(id uuid,can_edit boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT t.id,public.task_can_edit(t.id) FROM public.tasks t WHERE t.board_id=p_board AND public.task_can_read(t.id);$$;

CREATE FUNCTION app_private.guard_lead() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;p public.pipelines;BEGIN
 SELECT * INTO p FROM public.pipelines WHERE id=NEW.pipeline_id FOR SHARE;SELECT * INTO b FROM public.business_boards WHERE id=p.board_id FOR SHARE;
 IF auth.uid() IS NULL OR NOT public.business_can_board(b.id,'write') OR b.kind<>'pipeline' OR NEW.workspace_id IS DISTINCT FROM b.workspace_id
 OR NEW.sector_id IS DISTINCT FROM b.sector_id OR NEW.visibility NOT IN ('personal','assigned','sector') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF TG_OP='INSERT' THEN
  IF (NEW.created_by IS NOT NULL AND NEW.created_by<>auth.uid()) OR (NEW.owner_id IS NOT NULL AND NEW.owner_id<>auth.uid()) OR (NEW.assigned_to IS NOT NULL AND NEW.assigned_to<>auth.uid()) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  NEW.created_by:=auth.uid();NEW.created_at:=now();NEW.updated_at:=now();NEW.owner_id:=auth.uid();NEW.assigned_to:=auth.uid();
  IF NEW.visibility<>'personal' AND NOT public.business_can_board(b.id,'share') THEN RAISE EXCEPTION 'SHARING_FORBIDDEN' USING ERRCODE='42501';END IF;
 ELSE
  IF NOT public.business_can_lead(OLD.id,true) OR NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.pipeline_id<>OLD.pipeline_id OR NEW.sector_id IS DISTINCT FROM OLD.sector_id
   OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
   OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.visibility<>OLD.visibility THEN RAISE EXCEPTION 'SCOPE_IMMUTABLE' USING ERRCODE='42501';END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stages s WHERE s.id=NEW.stage_id AND s.pipeline_id=p.id AND s.workspace_id=b.workspace_id)
 OR (NEW.company_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.companies c WHERE c.id=NEW.company_id AND c.workspace_id=b.workspace_id AND c.sector_id=b.sector_id AND public.business_can_company(c.id)))
 OR (NEW.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=NEW.contact_id AND c.workspace_id=b.workspace_id AND c.sector_id=b.sector_id AND public.business_can_contact(c.id)))
 THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF length(btrim(NEW.title)) NOT BETWEEN 1 AND 240 OR coalesce(NEW.value,0)<0 OR length(coalesce(NEW.description,''))>16000 OR cardinality(NEW.tags)>30 THEN RAISE EXCEPTION 'INVALID_LEAD' USING ERRCODE='22023';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER business_lead_guard BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION app_private.guard_lead();
CREATE FUNCTION public.business_lead_permissions(p_board uuid) RETURNS TABLE(id uuid,can_edit boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT l.id,public.business_can_lead(l.id,true) FROM public.leads l JOIN public.pipelines p ON p.id=l.pipeline_id WHERE p.board_id=p_board AND public.business_can_lead(l.id);$$;

-- Column changes lock the board and all records being moved. An inaccessible row
-- aborts the entire transaction without revealing its count, title or existence.
CREATE FUNCTION public.business_save_columns(p_board uuid,p_version timestamptz,p_columns jsonb,p_moves jsonb DEFAULT '{}') RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;c jsonb;r record;dest text;n integer:=0;pipeline uuid;BEGIN
 IF NOT public.business_can_board(p_board,'manage') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.business_boards WHERE id=p_board FOR UPDATE;
 IF b.updated_at IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'BOARD_VERSION_CONFLICT' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_columns)<>'array' OR jsonb_array_length(p_columns) NOT BETWEEN 1 AND 30 OR jsonb_typeof(p_moves)<>'object'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_columns) v WHERE length(btrim(v->>'name')) NOT BETWEEN 1 AND 80 OR nullif(v->>'id','') IS NULL)
 OR (SELECT count(DISTINCT v->>'id') FROM jsonb_array_elements(p_columns) v)<>jsonb_array_length(p_columns) THEN RAISE EXCEPTION 'INVALID_COLUMNS' USING ERRCODE='22023';END IF;
 IF b.kind='tasks' THEN
  FOR c IN SELECT * FROM jsonb_array_elements(p_columns) LOOP
   IF EXISTS(SELECT 1 FROM public.task_stages WHERE workspace_id=b.workspace_id AND id=c->>'id' AND board_id IS DISTINCT FROM b.id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
   INSERT INTO public.task_stages(workspace_id,board_id,id,name,color,position,base_status) VALUES(b.workspace_id,b.id,c->>'id',btrim(c->>'name'),coalesce(c->>'color','blue'),n,coalesce(c->>'base_status','todo')::public.task_status)
   ON CONFLICT(workspace_id,id) DO UPDATE SET name=EXCLUDED.name,color=EXCLUDED.color,position=EXCLUDED.position;
   n:=n+1;
  END LOOP;
  FOR r IN SELECT id FROM public.task_stages WHERE board_id=b.id AND id NOT IN(SELECT v->>'id' FROM jsonb_array_elements(p_columns) v) FOR UPDATE LOOP
   dest:=p_moves->>r.id;
   IF dest IS NULL OR NOT EXISTS(SELECT 1 FROM public.task_stages WHERE board_id=b.id AND id=dest AND id IN(SELECT v->>'id' FROM jsonb_array_elements(p_columns) v)) THEN RAISE EXCEPTION 'COLUMN_DESTINATION_REQUIRED' USING ERRCODE='22023';END IF;
   PERFORM 1 FROM public.tasks WHERE board_id=b.id AND stage_id=r.id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.tasks t WHERE t.board_id=b.id AND t.stage_id=r.id AND NOT public.task_can_edit(t.id)) THEN RAISE EXCEPTION 'COLUMN_MOVE_REQUIRES_AUTHORITY' USING ERRCODE='42501';END IF;
   UPDATE public.tasks SET stage_id=dest WHERE board_id=b.id AND stage_id=r.id;
   DELETE FROM public.task_stages WHERE board_id=b.id AND id=r.id;
  END LOOP;
 ELSE
  SELECT id INTO pipeline FROM public.pipelines WHERE board_id=b.id;
  FOR c IN SELECT * FROM jsonb_array_elements(p_columns) LOOP
   IF EXISTS(SELECT 1 FROM public.stages WHERE id=(c->>'id')::uuid AND pipeline_id<>pipeline) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
   INSERT INTO public.stages(id,workspace_id,pipeline_id,name,color,position) VALUES((c->>'id')::uuid,b.workspace_id,pipeline,btrim(c->>'name'),coalesce(c->>'color','blue'),n)
   ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,color=EXCLUDED.color,position=EXCLUDED.position;
   n:=n+1;
  END LOOP;
  FOR r IN SELECT id FROM public.stages WHERE pipeline_id=pipeline AND id NOT IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(p_columns) v) FOR UPDATE LOOP
   dest:=p_moves->>r.id::text;
   IF dest IS NULL OR NOT EXISTS(SELECT 1 FROM public.stages WHERE pipeline_id=pipeline AND id=dest::uuid AND id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(p_columns) v)) THEN RAISE EXCEPTION 'COLUMN_DESTINATION_REQUIRED' USING ERRCODE='22023';END IF;
   PERFORM 1 FROM public.leads WHERE pipeline_id=pipeline AND stage_id=r.id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.leads l WHERE l.pipeline_id=pipeline AND l.stage_id=r.id AND NOT public.business_can_lead(l.id,true)) THEN RAISE EXCEPTION 'COLUMN_MOVE_REQUIRES_AUTHORITY' USING ERRCODE='42501';END IF;
   UPDATE public.leads SET stage_id=dest::uuid WHERE pipeline_id=pipeline AND stage_id=r.id;
   DELETE FROM public.stages WHERE pipeline_id=pipeline AND id=r.id;
  END LOOP;
 END IF;
 UPDATE public.business_boards SET updated_at=clock_timestamp() WHERE id=b.id;
END;$$;

-- Proven personal legacy rows only. Guards are disabled inside the migration
-- transaction (owner-only DDL), never through a browser-controllable session flag.
ALTER TABLE public.tasks DISABLE TRIGGER task_write_guard;
ALTER TABLE public.tasks DISABLE TRIGGER task_audit;
DO $$ DECLARE r record;b uuid;st text;BEGIN
 FOR r IN SELECT t.id,t.workspace_id,t.created_by,t.status,m.sector_id FROM public.tasks t JOIN public.task_sector_members m ON m.workspace_id=t.workspace_id AND m.user_id=t.created_by
 WHERE t.board_id IS NULL AND t.sector_id IS NULL AND t.created_by IS NOT NULL AND t.assigned_to=t.created_by AND app_private.member(t.workspace_id,m.sector_id,t.created_by)
 AND (SELECT count(*) FROM public.task_sector_members sm WHERE sm.workspace_id=t.workspace_id AND sm.user_id=t.created_by AND app_private.member(sm.workspace_id,sm.sector_id,sm.user_id))=1 LOOP
  SELECT id INTO b FROM public.business_boards WHERE workspace_id=r.workspace_id AND sector_id=r.sector_id AND owner_id=r.created_by AND kind='tasks' AND visibility='personal' AND NOT archived;
  SELECT id INTO st FROM public.task_stages WHERE board_id=b AND base_status=r.status ORDER BY position LIMIT 1;
  UPDATE public.tasks SET board_id=b,sector_id=r.sector_id,owner_id=r.created_by,visibility='personal',stage_id=st WHERE id=r.id;
 END LOOP;
END;$$;
ALTER TABLE public.tasks ENABLE TRIGGER task_write_guard;
ALTER TABLE public.tasks ENABLE TRIGGER task_audit;
-- Raw audit snapshots can contain a source-sector catalog after a transfer.
-- Keep them private; clients receive the minimal authorized event projection.
DROP POLICY task_events_read ON public.task_events;
REVOKE SELECT ON public.task_events FROM authenticated;
CREATE FUNCTION public.business_task_history(p_task uuid) RETURNS TABLE(id uuid,kind text,created_at timestamptz,actor_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT e.id,e.kind,e.created_at,e.actor_id FROM public.task_events e WHERE e.task_id=p_task AND public.task_can_read(p_task) ORDER BY e.created_at;$$;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='app_private' OR (n.nspname='public' AND p.proname LIKE 'business_%') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
 IF f.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f.sig);END IF;END LOOP;END $$;


-- ===== business_dispatch_files =====
ALTER TABLE public.task_conversations ADD COLUMN board_id uuid REFERENCES public.business_boards(id);
CREATE OR REPLACE FUNCTION public.task_owns_conversation(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.task_conversations c WHERE c.id=p_id AND c.created_by=auth.uid() AND public.business_can_board(c.board_id,'dispatch')
 AND NOT EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.conversation_id=c.id AND coalesce(d.confirmed_task_id,d.target_task_id) IS NOT NULL
 AND NOT public.task_can_read(coalesce(d.confirmed_task_id,d.target_task_id))));
$$;
CREATE OR REPLACE FUNCTION public.task_owns_draft(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.id=p_id AND d.created_by=auth.uid() AND public.task_owns_conversation(d.conversation_id)
 AND (coalesce(d.confirmed_task_id,d.target_task_id) IS NULL OR public.task_can_read(coalesce(d.confirmed_task_id,d.target_task_id))));
$$;
CREATE OR REPLACE FUNCTION public.task_start_conversation(p_workspace uuid,p_id uuid) RETURNS public.task_conversations
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'SCOPED_CLIENT_REQUIRED' USING ERRCODE='42501';END;$$;
CREATE FUNCTION public.business_start_conversation(p_board uuid,p_id uuid) RETURNS public.task_conversations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;c public.task_conversations;BEGIN
 IF NOT public.business_modules_enabled() OR NOT public.business_can_board(p_board,'dispatch') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.business_boards WHERE id=p_board AND kind='tasks';
 IF b.id IS NULL THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 INSERT INTO public.task_conversations(id,workspace_id,board_id,created_by) VALUES(p_id,b.workspace_id,b.id,auth.uid()) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO c FROM public.task_conversations WHERE id=p_id AND board_id=b.id AND created_by=auth.uid();
 IF c.id IS NULL OR NOT public.task_owns_conversation(c.id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;RETURN c;
END;$$;
CREATE OR REPLACE FUNCTION public.task_save_draft(p_conversation uuid,p_id uuid,p_version integer,p_payload jsonb,p_target uuid DEFAULT NULL) RETURNS public.task_drafts
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.task_drafts;c public.task_conversations;t public.tasks;b public.business_boards;BEGIN
 IF NOT public.task_owns_conversation(p_conversation) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM public.task_conversations WHERE id=p_conversation;
 IF jsonb_typeof(p_payload)<>'object' OR length(p_payload::text)>24000 THEN RAISE EXCEPTION 'TASK_INVALID_DRAFT' USING ERRCODE='22023';END IF;
 -- An incomplete manual draft may omit the destination, but supplied IDs are
 -- authorized immediately and checked again at confirmation.
 IF nullif(p_payload->>'board_id','') IS NOT NULL THEN
  SELECT * INTO b FROM public.business_boards WHERE id=(p_payload->>'board_id')::uuid;
  IF NOT public.business_can_board(b.id,'dispatch') OR b.workspace_id<>c.workspace_id OR b.kind<>'tasks'
   OR b.sector_id::text IS DISTINCT FROM p_payload->>'sector_id' THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 END IF;
 IF p_target IS NOT NULL THEN
  IF NOT public.task_can_edit(p_target) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  SELECT * INTO t FROM public.tasks WHERE id=p_target AND workspace_id=c.workspace_id;
  IF t.id IS NULL OR NOT public.business_can_board(t.board_id,'dispatch') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 END IF;
 SELECT * INTO d FROM public.task_drafts WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF d.conversation_id<>p_conversation OR d.created_by<>auth.uid() OR d.target_task_id IS DISTINCT FROM p_target THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  IF d.confirmed_task_id IS NULL AND d.payload=p_payload AND (d.version=p_version+1 OR (p_version=0 AND d.version=1)) THEN RETURN d;END IF;
  IF d.confirmed_task_id IS NOT NULL OR d.version<>p_version THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='40001';END IF;
  UPDATE public.task_drafts SET payload=p_payload,version=version+1,updated_at=now() WHERE id=d.id RETURNING * INTO d;
 ELSE
  IF p_version<>0 THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='40001';END IF;
  INSERT INTO public.task_drafts(id,workspace_id,conversation_id,created_by,payload,target_task_id,target_updated_at)
  VALUES(p_id,c.workspace_id,c.id,auth.uid(),p_payload,p_target,t.updated_at) RETURNING * INTO d;
 END IF;
 INSERT INTO public.task_events(workspace_id,draft_id,actor_id,kind,details) VALUES(c.workspace_id,d.id,auth.uid(),'draft_saved',jsonb_build_object('version',d.version));RETURN d;
END;$$;
CREATE OR REPLACE FUNCTION public.task_confirm_draft(p_id uuid,p_version integer) RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.task_drafts;t public.tasks;b public.business_boards;p jsonb;assignee uuid;owner_user uuid;st text;BEGIN
 IF NOT public.task_owns_draft(p_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM public.task_drafts WHERE id=p_id FOR UPDATE;
 IF d.confirmed_task_id IS NOT NULL AND d.confirmed_version=p_version THEN
  IF NOT public.task_can_read(d.confirmed_task_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  SELECT * INTO t FROM public.tasks WHERE id=d.confirmed_task_id;RETURN t;
 END IF;
 IF d.version<>p_version OR d.confirmed_task_id IS NOT NULL THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='40001';END IF;
 p:=d.payload;
 IF jsonb_typeof(p->'unresolved')='array' AND jsonb_array_length(p->'unresolved')>0 THEN RAISE EXCEPTION 'TASK_REVIEW_REQUIRED' USING ERRCODE='22023';END IF;
 SELECT * INTO b FROM public.business_boards WHERE id=nullif(p->>'board_id','')::uuid FOR SHARE;
 IF b.id IS NULL OR b.workspace_id<>d.workspace_id OR b.sector_id::text IS DISTINCT FROM p->>'sector_id' OR b.kind<>'tasks'
 OR NOT public.business_can_board(b.id,'dispatch') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 assignee:=nullif(p->>'assigned_to','')::uuid;owner_user:=coalesce(assignee,auth.uid());
 st:=coalesce(nullif(p->>'stage_id',''),(SELECT id FROM public.task_stages WHERE board_id=b.id AND NOT archived ORDER BY position,id LIMIT 1));
 IF assignee IS NOT NULL AND NOT app_private.board_user(b.id,assignee,true) THEN RAISE EXCEPTION 'TASK_RECIPIENT_INELIGIBLE' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.task_attachments a WHERE a.draft_id=d.id AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='task-attachments' AND o.name=a.storage_path)) THEN RAISE EXCEPTION 'TASK_ATTACHMENT_UNAVAILABLE' USING ERRCODE='22023';END IF;
 IF d.target_task_id IS NULL THEN
  INSERT INTO public.tasks(workspace_id,sector_id,board_id,owner_id,visibility,title,description,company_id,operational_code,operator,project,assigned_to,created_by,due_date,priority,stage_id,request_key)
  VALUES(b.workspace_id,b.sector_id,b.id,owner_user,CASE WHEN assignee IS NULL THEN 'sector' ELSE 'assigned' END,btrim(p->>'title'),nullif(p->>'description',''),nullif(p->>'company_id','')::uuid,nullif(p->>'operational_code',''),nullif(p->>'operator',''),nullif(p->>'project',''),assignee,auth.uid(),
   CASE WHEN nullif(p->>'due_date','') IS NULL THEN NULL ELSE ((p->>'due_date')::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo' END,coalesce(nullif(p->>'priority',''),'medium')::public.task_priority,st,d.id) RETURNING * INTO t;
 ELSE
  IF NOT public.task_can_edit(d.target_task_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  SELECT * INTO t FROM public.tasks WHERE id=d.target_task_id FOR UPDATE;
  IF NOT public.business_can_board(t.board_id,'dispatch') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  IF t.updated_at<>d.target_updated_at THEN RAISE EXCEPTION 'TASK_TARGET_VERSION_CONFLICT' USING ERRCODE='40001';END IF;
  UPDATE public.tasks SET board_id=b.id,sector_id=b.sector_id,owner_id=owner_user,visibility=CASE WHEN assignee IS NULL THEN 'sector' ELSE 'assigned' END,
  title=btrim(p->>'title'),description=nullif(p->>'description',''),company_id=nullif(p->>'company_id','')::uuid,contact_id=NULL,lead_id=NULL,
  operational_code=nullif(p->>'operational_code',''),operator=nullif(p->>'operator',''),project=nullif(p->>'project',''),assigned_to=assignee,
  due_date=CASE WHEN nullif(p->>'due_date','') IS NULL THEN NULL ELSE ((p->>'due_date')::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo' END,
  priority=coalesce(nullif(p->>'priority',''),'medium')::public.task_priority,stage_id=st WHERE id=t.id RETURNING * INTO t;
  DELETE FROM public.task_participants WHERE task_id=t.id;
 END IF;
 UPDATE public.task_attachments SET task_id=t.id WHERE draft_id=d.id;
 UPDATE public.task_drafts SET confirmed_task_id=t.id,confirmed_version=p_version,updated_at=now() WHERE id=d.id;
 INSERT INTO public.task_events(workspace_id,task_id,draft_id,actor_id,kind,details) VALUES(t.workspace_id,t.id,d.id,auth.uid(),'confirmed',jsonb_build_object('board_id',b.id,'sector_id',b.sector_id,'assigned_to',assignee));RETURN t;
END;$$;
-- Once attached to a task, authorization follows that task exclusively.
DROP POLICY task_attachments_read ON public.task_attachments;
CREATE POLICY task_attachments_read ON public.task_attachments FOR SELECT TO authenticated USING(CASE WHEN task_id IS NOT NULL THEN public.task_can_read(task_id) ELSE public.task_owns_draft(draft_id) END);
DROP POLICY task_storage_read ON storage.objects;
CREATE POLICY task_storage_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='task-attachments' AND (
 EXISTS(SELECT 1 FROM public.task_attachments a WHERE a.storage_path=storage.objects.name AND CASE WHEN a.task_id IS NOT NULL THEN public.task_can_read(a.task_id) ELSE public.task_owns_draft(a.draft_id) END)
 OR EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.id::text=(storage.foldername(name))[2] AND d.workspace_id::text=(storage.foldername(name))[1] AND d.confirmed_task_id IS NULL AND public.task_owns_draft(d.id))));

CREATE TABLE public.lead_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.workspaces(id),lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
 name text NOT NULL,mime_type text NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 20971520),storage_path text NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(storage_path LIKE workspace_id::text||'/'||lead_id::text||'/%')
);
ALTER TABLE public.lead_files ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON public.lead_files TO authenticated;GRANT ALL ON public.lead_files TO service_role;
CREATE POLICY lead_files_read ON public.lead_files FOR SELECT TO authenticated USING(public.business_can_lead(lead_id));
CREATE POLICY lead_files_insert ON public.lead_files FOR INSERT TO authenticated WITH CHECK(created_by=auth.uid() AND EXISTS(SELECT 1 FROM public.leads l WHERE l.id=lead_id AND l.workspace_id=lead_files.workspace_id AND public.business_can_lead(l.id,true)));
CREATE POLICY lead_files_delete ON public.lead_files FOR DELETE TO authenticated USING(public.business_can_lead(lead_id,true));
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('lead-files','lead-files',false,20971520);
CREATE POLICY lead_storage_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='lead-files' AND EXISTS(SELECT 1 FROM public.leads l WHERE l.workspace_id::text=(storage.foldername(name))[1] AND l.id::text=(storage.foldername(name))[2] AND public.business_can_lead(l.id)));
CREATE POLICY lead_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='lead-files' AND EXISTS(SELECT 1 FROM public.leads l WHERE l.workspace_id::text=(storage.foldername(name))[1] AND l.id::text=(storage.foldername(name))[2] AND public.business_can_lead(l.id,true)));
CREATE POLICY lead_storage_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='lead-files' AND EXISTS(SELECT 1 FROM public.leads l WHERE l.workspace_id::text=(storage.foldername(name))[1] AND l.id::text=(storage.foldername(name))[2] AND public.business_can_lead(l.id,true)));
-- No UPDATE grant/policy for any protected object: upsert cannot replace a file.
UPDATE storage.buckets SET public=false WHERE id IN ('task-attachments','lead-files','company-media');

CREATE FUNCTION public.business_set_participant(p_kind text,p_record uuid,p_user uuid,p_edit boolean,p_remove boolean DEFAULT false) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE board uuid;BEGIN
 IF p_kind='tasks' THEN
  IF NOT public.task_can_edit(p_record) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  SELECT board_id INTO board FROM public.tasks WHERE id=p_record;
 ELSE
  IF p_kind<>'pipeline' OR NOT public.business_can_lead(p_record,true) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  SELECT p.board_id INTO board FROM public.leads l JOIN public.pipelines p ON p.id=l.pipeline_id WHERE l.id=p_record;
 END IF;
 IF NOT public.business_can_board(board,'share') OR NOT app_private.board_user(board,p_user,p_edit) THEN RAISE EXCEPTION 'SHARING_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF p_kind='tasks' THEN
  IF p_remove THEN DELETE FROM public.task_participants WHERE task_id=p_record AND user_id=p_user;ELSE INSERT INTO public.task_participants VALUES(p_record,p_user,p_edit) ON CONFLICT(task_id,user_id) DO UPDATE SET can_edit=EXCLUDED.can_edit;END IF;
 ELSE
  IF p_remove THEN DELETE FROM public.lead_participants WHERE lead_id=p_record AND user_id=p_user;ELSE INSERT INTO public.lead_participants VALUES(p_record,p_user,p_edit) ON CONFLICT(lead_id,user_id) DO UPDATE SET can_edit=EXCLUDED.can_edit;END IF;
 END IF;
END;$$;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='app_private' OR (n.nspname='public' AND p.proname LIKE 'business_%') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
 IF f.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f.sig);END IF;END LOOP;END $$;


-- ===== business_onboarding_hardening =====
-- Existing accounts can finish onboarding only inside an exclusively owned,
-- never-shared private organization. A declared profile sector never grants
-- membership in an existing team or a second sector.
CREATE FUNCTION public.business_onboard_personal(p_sector text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 PERFORM app_private.create_board(ws,s,auth.uid(),'tasks','Minhas tarefas');PERFORM app_private.create_board(ws,s,auth.uid(),'pipeline','Minha pipeline');
END;$$;
CREATE FUNCTION public.business_create_sector(p_workspace uuid,p_code text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s uuid;BEGIN
 IF NOT app_private.workspace_owner(p_workspace) OR p_code NOT IN ('financeiro','relacionamento','comercial') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 INSERT INTO public.task_sectors(workspace_id,name,code) VALUES(p_workspace,CASE p_code WHEN 'financeiro' THEN 'Financeiro' WHEN 'relacionamento' THEN 'Relacionamento' ELSE 'Comercial' END,p_code) RETURNING id INTO s;RETURN s;
END;$$;
-- Audit is owner/service-only and returns aggregates, never business content.
CREATE FUNCTION public.business_legacy_audit(p_workspace uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT app_private.workspace_owner(p_workspace) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('tasks_restricted',(SELECT count(*) FROM public.tasks WHERE workspace_id=p_workspace AND visibility='restricted'),
 'pipelines_restricted',(SELECT count(*) FROM public.pipelines WHERE workspace_id=p_workspace AND visibility='restricted'),
 'leads_restricted',(SELECT count(*) FROM public.leads WHERE workspace_id=p_workspace AND visibility='restricted'),
 'companies_restricted',(SELECT count(*) FROM public.companies WHERE workspace_id=p_workspace AND visibility='restricted'),
 'contacts_restricted',(SELECT count(*) FROM public.contacts WHERE workspace_id=p_workspace AND visibility='restricted'));
END;$$;
-- No business Postgres Changes subscription is used in this phase. Polling
-- rechecks active membership every 15 seconds and on focus; all new operations
-- authorize current database membership immediately. Broadcast/Presence are unused.
DO $$ DECLARE r record;BEGIN FOR r IN SELECT schemaname,tablename FROM pg_publication_tables
 WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename IN
 ('tasks','leads','pipelines','stages','task_stages','business_boards','task_events','task_messages','task_drafts','task_attachments','lead_files','activities','notes','companies','contacts','company_files','workspace_members','task_sector_members','business_board_members') LOOP
 EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I',r.schemaname,r.tablename);END LOOP;END $$;
-- A client may not invoke old trigger helpers or enumerate arbitrary membership
-- through functions accepting somebody else's user_id.
REVOKE ALL ON FUNCTION public.task_recipient_active(uuid,uuid) FROM PUBLIC,anon,authenticated;
-- Compatibility helpers used by non-business modules may inspect only the caller.
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid,_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT _user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.workspace_members m JOIN auth.users u ON u.id=m.user_id WHERE m.workspace_id=_workspace_id AND m.user_id=auth.uid() AND m.active AND (u.banned_until IS NULL OR u.banned_until<now()));$$;
CREATE OR REPLACE FUNCTION public.is_workspace_admin(_workspace_id uuid,_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT _user_id=auth.uid() AND app_private.workspace_owner(_workspace_id);$$;
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid,uuid),public.is_workspace_admin(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid,uuid),public.is_workspace_admin(uuid,uuid) TO authenticated,service_role;
CREATE FUNCTION public.business_my_workspace_admin(p_workspace uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app_private.workspace_owner(p_workspace);$$;
-- Workspaces themselves expose only a currently active membership. The prior
-- workspace-owner policy must not let a removed member recover business access.
DO $$ DECLARE r record;BEGIN FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='workspaces' LOOP
 EXECUTE format('DROP POLICY %I ON public.workspaces',r.policyname);END LOOP;END $$;
CREATE FUNCTION public.business_workspace_member(p_workspace uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT public.is_workspace_member(p_workspace,auth.uid());$$;
CREATE POLICY workspaces_read_active ON public.workspaces FOR SELECT TO authenticated USING(public.business_workspace_member(id));
-- Team creation/provisioning is performed by trusted onboarding, not direct
-- inserts/updates to organization IDs from an authenticated browser.
REVOKE INSERT,UPDATE,DELETE ON public.workspaces FROM authenticated;
-- Internal historical metadata remains inaccessible. No policy OR-bypass from
-- earlier migrations is left on the protected relations.
DO $$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='app_private' OR (n.nspname='public' AND p.proname LIKE 'business_%') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
 IF f.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f.sig);END IF;END LOOP;END $$;


-- ===== business_environment_integrations =====
CREATE TABLE app_private.deployment_environment(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),name text NOT NULL CHECK(name IN ('development','staging','production')));
INSERT INTO app_private.deployment_environment(singleton,name) VALUES(true,'production');
REVOKE ALL ON app_private.deployment_environment FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.business_modules_enabled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT name<>'production' FROM app_private.deployment_environment WHERE singleton),false);$$;
CREATE FUNCTION app_private.automation_actor_allowed(p_workspace uuid,p_company uuid,p_user uuid,p_write boolean DEFAULT false) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.business_modules_enabled() AND EXISTS(SELECT 1 FROM public.companies c WHERE c.id=p_company AND c.workspace_id=p_workspace AND c.visibility<>'restricted'
 AND app_private.member(c.workspace_id,c.sector_id,p_user) AND (c.owner_id=p_user OR c.visibility='sector')
 AND (NOT p_write OR c.owner_id=p_user OR EXISTS(SELECT 1 FROM public.task_sector_members m WHERE m.workspace_id=c.workspace_id AND m.sector_id=c.sector_id AND m.user_id=p_user AND m.can_dispatch)));
$$;
-- Trigger-style parent checks cover privileged service writes as well as RPCs.
CREATE FUNCTION app_private.guard_automation_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' AND NOT app_private.automation_actor_allowed(NEW.workspace_id,NEW.company_id,NEW.requested_by,true) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF TG_OP='UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by) THEN RAISE EXCEPTION 'SCOPE_IMMUTABLE' USING ERRCODE='42501';END IF;
 RETURN NEW;
END;$$;
DO $$ BEGIN IF to_regclass('public.automation_operations') IS NOT NULL THEN
 CREATE TRIGGER business_automation_scope BEFORE INSERT OR UPDATE ON public.automation_operations FOR EACH ROW EXECUTE FUNCTION app_private.guard_automation_scope();
 END IF;END $$;
CREATE FUNCTION public.business_can_operation(p_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 RETURN EXISTS(SELECT 1 FROM public.automation_operations o WHERE o.id=p_id AND o.requested_by=auth.uid() AND app_private.automation_actor_allowed(o.workspace_id,o.company_id,auth.uid()));
END;$$;
CREATE FUNCTION public.business_worker_scope(p_workspace uuid,p_company uuid,p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app_private.automation_actor_allowed(p_workspace,p_company,p_user,true);$$;
DO $$ DECLARE r record;t text;BEGIN
 FOR r IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'automation_%' LOOP
 EXECUTE format('DROP POLICY %I ON public.%I',r.policyname,r.tablename);END LOOP;
 IF to_regclass('public.automation_operations') IS NOT NULL THEN
 CREATE POLICY operation_read_scoped ON public.automation_operations FOR SELECT TO authenticated USING(public.business_can_operation(id));
 FOREACH t IN ARRAY ARRAY['automation_events','automation_steps','automation_artifacts'] LOOP
 EXECUTE format('CREATE POLICY operation_child_read ON public.%I FOR SELECT TO authenticated USING(public.business_can_operation(operation_id))',t);END LOOP;
 CREATE POLICY automation_documents_read ON public.automation_documents FOR SELECT TO authenticated USING(uploaded_by=auth.uid() AND public.business_modules_enabled() AND public.business_can_company(company_id));
 CREATE POLICY automation_documents_insert ON public.automation_documents FOR INSERT TO authenticated WITH CHECK(uploaded_by=auth.uid() AND public.business_modules_enabled() AND public.business_can_company(company_id,true) AND EXISTS(SELECT 1 FROM public.companies c WHERE c.id=company_id AND c.workspace_id=automation_documents.workspace_id));
 REVOKE ALL ON public.automation_credentials,public.automation_audit_logs FROM authenticated,anon;
 END IF;
END $$;
-- Existing trusted orchestration keeps its implementation behind scoped wrappers.
DO $$ DECLARE f text;definition text;BEGIN
 FOREACH f IN ARRAY ARRAY['create_koa_card_issue_operation','create_koa_exclusion_holder_preview_operation','create_koa_inclusion_holder_preview_operation'] LOOP
 IF to_regprocedure('public.'||f||'(uuid,uuid,text,jsonb)') IS NOT NULL THEN
  EXECUTE format('ALTER FUNCTION public.%I(uuid,uuid,text,jsonb) SET SCHEMA app_private',f);
  EXECUTE format($func$CREATE FUNCTION public.%I(_workspace_id uuid,_company_id uuid,_operator text DEFAULT 'hapvida',_payload jsonb DEFAULT '{}') RETURNS public.automation_operations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
  BEGIN IF NOT app_private.automation_actor_allowed(_workspace_id,_company_id,auth.uid(),true) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  RETURN app_private.%I(_workspace_id,_company_id,_operator,_payload);END;$body$;$func$,f,f);
 END IF;END LOOP;
 IF to_regprocedure('public.request_koa_operation_cancel(uuid)') IS NOT NULL THEN
  ALTER FUNCTION public.request_koa_operation_cancel(uuid) SET SCHEMA app_private;
  EXECUTE $func$CREATE FUNCTION public.request_koa_operation_cancel(_operation_id uuid) RETURNS public.automation_operations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
  BEGIN IF NOT public.business_can_operation(_operation_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;RETURN app_private.request_koa_operation_cancel(_operation_id);END;$body$;$func$;
 END IF;
 IF to_regprocedure('public.claim_next_automation_operation(text,integer)') IS NOT NULL THEN
  SELECT pg_get_functiondef('public.claim_next_automation_operation(text,integer)'::regprocedure) INTO definition;
  IF strpos(definition,$needle$WHERE status IN ('queued', 'cancelling')$needle$)=0 THEN RAISE EXCEPTION 'WORKER_MIGRATION_REVIEW_REQUIRED';END IF;
  definition:=replace(definition,$needle$WHERE status IN ('queued', 'cancelling')$needle$,$replacement$WHERE status IN ('queued', 'cancelling') AND (status='cancelling' OR app_private.automation_actor_allowed(workspace_id,company_id,requested_by,true))$replacement$);
  EXECUTE definition;
 END IF;
END $$;
-- No direct artifact bucket upload/read bypass. Metadata must resolve to an
-- authorized operation or the caller's scoped pre-operation document.
DO $$ DECLARE r record;BEGIN FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND (qual LIKE '%koa-artifacts%' OR with_check LIKE '%koa-artifacts%') LOOP
 EXECUTE format('DROP POLICY %I ON storage.objects',r.policyname);END LOOP;END $$;
DO $$ BEGIN IF to_regclass('public.automation_artifacts') IS NOT NULL THEN
 CREATE POLICY koa_artifacts_scoped_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='koa-artifacts' AND public.business_modules_enabled() AND (
 EXISTS(SELECT 1 FROM public.automation_artifacts a WHERE a.storage_path=storage.objects.name AND public.business_can_operation(a.operation_id))
 OR EXISTS(SELECT 1 FROM public.automation_documents d WHERE d.storage_path=storage.objects.name AND d.uploaded_by=auth.uid() AND public.business_can_company(d.company_id))));
 END IF;END $$;
-- Production retains only the business modules plus their scoped dependencies.
DO $$ DECLARE r record;BEGIN FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='automations' LOOP
 EXECUTE format('DROP POLICY %I ON public.automations',r.policyname);END LOOP;END $$;
CREATE POLICY automations_personal ON public.automations FOR SELECT TO authenticated USING(public.business_modules_enabled() AND created_by=auth.uid() AND public.business_workspace_member(workspace_id));
REVOKE INSERT,UPDATE,DELETE ON public.automations FROM authenticated;
-- Close historical enumeration helpers and protect definer search paths.
REVOKE ALL ON FUNCTION public.user_workspaces(uuid) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app_private'
 OR (n.nspname='public' AND (p.proname LIKE 'business_%' OR p.proname LIKE 'create_koa_%' OR p.proname='request_koa_operation_cancel')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
 IF f.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f.sig);END IF;END LOOP;
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'task_%' LOOP
 EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog',f.sig);END LOOP;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.business_worker_scope(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.business_worker_scope(uuid,uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.task_owns_conversation(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.business_modules_enabled() AND EXISTS(SELECT 1 FROM public.task_conversations c WHERE c.id=p_id AND c.created_by=auth.uid() AND public.business_can_board(c.board_id,'dispatch')
 AND NOT EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.conversation_id=c.id AND coalesce(d.confirmed_task_id,d.target_task_id) IS NOT NULL
 AND NOT public.task_can_read(coalesce(d.confirmed_task_id,d.target_task_id))));$$;


-- ===== business_child_integrity =====
CREATE FUNCTION app_private.guard_note_origin() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.lead_id IS DISTINCT FROM OLD.lead_id OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
 OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'SCOPE_IMMUTABLE' USING ERRCODE='42501';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER business_note_origin BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION app_private.guard_note_origin();
CREATE FUNCTION app_private.reset_task_participants() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.board_id IS DISTINCT FROM OLD.board_id OR NEW.sector_id IS DISTINCT FROM OLD.sector_id OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.visibility<>OLD.visibility
 THEN DELETE FROM public.task_participants WHERE task_id=NEW.id;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER task_scope_participants AFTER UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION app_private.reset_task_participants();
-- A lead or contact must never cascade-delete another person's personal task.
-- Preserve all existing links; deleting a linked parent requires reconciliation.
ALTER TABLE public.tasks DROP CONSTRAINT tasks_lead_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_lead_id_fkey FOREIGN KEY(lead_id) REFERENCES public.leads(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.tasks DROP CONSTRAINT tasks_contact_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_contact_id_fkey FOREIGN KEY(contact_id) REFERENCES public.contacts(id) ON DELETE RESTRICT NOT VALID;
REVOKE ALL ON FUNCTION app_private.guard_note_origin(),app_private.reset_task_participants() FROM PUBLIC,anon,authenticated;
