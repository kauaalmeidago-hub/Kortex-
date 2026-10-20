-- Reuse the original tasks, workspace membership and authenticated identity.
-- Preserve account/workspace setup, but stop the old signup trigger from creating
-- demonstration tasks before there is an authenticated author. Existing rows stay intact.
DO $$ DECLARE definition text; cleaned text; BEGIN
 SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) INTO definition;
 cleaned:=regexp_replace(definition,$pattern$(?s)\n  -- Tasks\s+INSERT INTO public\.tasks [^;]*;\s*$pattern$,
 E'\n  -- Tasks are created only by authenticated user requests.\n\n  ');
 IF cleaned<>definition THEN EXECUTE cleaned; END IF;
END; $$;
-- Self-enrolment must not let a browser grant itself administrative privileges.
DROP POLICY members_insert_admin ON public.workspace_members;
CREATE POLICY members_insert_admin ON public.workspace_members FOR INSERT TO authenticated
 WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid()) OR
   (user_id = auth.uid() AND role = 'admin' AND EXISTS
     (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid())));

CREATE TABLE public.task_sectors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100), active boolean NOT NULL DEFAULT true,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,name)
);
CREATE TABLE public.task_sector_members (
 workspace_id uuid NOT NULL, sector_id uuid NOT NULL, user_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,sector_id,user_id),
 FOREIGN KEY(workspace_id,sector_id) REFERENCES public.task_sectors(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,user_id) REFERENCES public.workspace_members(workspace_id,user_id) ON DELETE CASCADE
);
CREATE TABLE public.task_stages (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE, id text NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80), color text NOT NULL DEFAULT 'blue',
 position integer NOT NULL, base_status public.task_status NOT NULL DEFAULT 'todo', archived boolean NOT NULL DEFAULT false,
 PRIMARY KEY(workspace_id,id)
);
INSERT INTO public.task_stages(workspace_id,id,name,color,position,base_status,archived)
 SELECT w.id,s.id,s.name,s.color,s.position,s.base_status::public.task_status,s.archived FROM public.workspaces w
 CROSS JOIN (VALUES ('todo','A fazer','blue',0,'todo',false),('in_progress','Em andamento','blue',1,'in_progress',false),
 ('review','Em revisão','blue',2,'review',false),('done','Concluído','blue',3,'done',false),('canceled','Cancelado','slate',99,'canceled',true))
 s(id,name,color,position,base_status,archived);
CREATE FUNCTION public.seed_task_stages() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.task_stages(workspace_id,id,name,color,position,base_status,archived)
 VALUES (NEW.id,'todo','A fazer','blue',0,'todo',false),(NEW.id,'in_progress','Em andamento','blue',1,'in_progress',false),
 (NEW.id,'review','Em revisão','blue',2,'review',false),(NEW.id,'done','Concluído','blue',3,'done',false),
 (NEW.id,'canceled','Cancelado','slate',99,'canceled',true); RETURN NEW;
END; $$;
CREATE TRIGGER workspace_task_stages AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.seed_task_stages();

ALTER TABLE public.tasks ADD COLUMN company_id uuid, ADD COLUMN operational_code text,
 ADD COLUMN operator text, ADD COLUMN project text, ADD COLUMN sector_id uuid,
 ADD COLUMN stage_id text, ADD COLUMN assigned_by uuid REFERENCES auth.users(id), ADD COLUMN assigned_at timestamptz,
 ADD COLUMN request_key uuid;
UPDATE public.tasks SET stage_id=status::text;
ALTER TABLE public.tasks ALTER COLUMN stage_id SET DEFAULT 'todo', ALTER COLUMN stage_id SET NOT NULL;
ALTER TABLE public.tasks ADD FOREIGN KEY(workspace_id,stage_id) REFERENCES public.task_stages(workspace_id,id),
 ADD FOREIGN KEY(workspace_id,company_id) REFERENCES public.companies(workspace_id,id),
 ADD FOREIGN KEY(workspace_id,sector_id) REFERENCES public.task_sectors(workspace_id,id);
CREATE UNIQUE INDEX tasks_request_once ON public.tasks(workspace_id,created_by,request_key) WHERE request_key IS NOT NULL;
CREATE INDEX tasks_sector_queue ON public.tasks(workspace_id,sector_id) WHERE assigned_to IS NULL;

CREATE FUNCTION public.task_recipient_active(p_workspace uuid,p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspace_members m JOIN auth.users u ON u.id=m.user_id WHERE m.workspace_id=p_workspace AND m.user_id=p_user AND (u.banned_until IS NULL OR u.banned_until<now()));
$$;
CREATE FUNCTION public.task_people(p_workspace uuid) RETURNS TABLE(user_id uuid,full_name text,email text,role public.app_role) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_workspace_member(p_workspace,auth.uid()) THEN RAISE EXCEPTION 'TASK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT m.user_id,p.full_name,u.email::text,m.role FROM public.workspace_members m JOIN auth.users u ON u.id=m.user_id LEFT JOIN public.profiles p ON p.id=m.user_id
  WHERE m.workspace_id=p_workspace AND (u.banned_until IS NULL OR u.banned_until<now());
END; $$;

CREATE FUNCTION public.task_can_read(p_task_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND public.is_workspace_member(t.workspace_id,auth.uid()) AND
  (public.is_workspace_admin(t.workspace_id,auth.uid()) OR t.created_by=auth.uid() OR t.assigned_to=auth.uid() OR
    (t.assigned_to IS NULL AND EXISTS(SELECT 1 FROM public.task_sector_members m JOIN public.task_sectors s ON s.id=m.sector_id AND s.workspace_id=m.workspace_id
       WHERE m.workspace_id=t.workspace_id AND m.sector_id=t.sector_id AND m.user_id=auth.uid() AND s.active))));
$$;
CREATE FUNCTION public.task_can_edit(p_task_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND public.is_workspace_member(t.workspace_id,auth.uid()) AND
  (public.is_workspace_admin(t.workspace_id,auth.uid()) OR t.assigned_to=auth.uid() OR
    (t.assigned_to IS NULL AND t.sector_id IS NULL AND t.created_by=auth.uid())));
$$;
DROP POLICY tasks_ws_access ON public.tasks;
CREATE POLICY tasks_read ON public.tasks FOR SELECT TO authenticated USING(public.task_can_read(id));
CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO authenticated WITH CHECK(public.is_workspace_member(workspace_id,auth.uid()) AND created_by=auth.uid());
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated USING(public.task_can_edit(id)) WITH CHECK(public.is_workspace_member(workspace_id,auth.uid()));
CREATE POLICY tasks_delete ON public.tasks FOR DELETE TO authenticated USING(public.task_can_edit(id));

CREATE FUNCTION public.guard_task_write() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_admin boolean := public.is_workspace_admin(NEW.workspace_id,auth.uid()); v_stage public.task_stages;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_workspace_member(NEW.workspace_id,auth.uid()) THEN RAISE EXCEPTION 'TASK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by IS NOT NULL AND NEW.created_by<>auth.uid() THEN RAISE EXCEPTION 'TASK_AUTHOR_IMMUTABLE' USING ERRCODE='42501'; END IF;
  NEW.created_by:=auth.uid();
  IF NOT v_admin AND (NEW.assigned_to IS DISTINCT FROM auth.uid() OR NEW.sector_id IS NOT NULL) THEN RAISE EXCEPTION 'TASK_SELF_ASSIGN_ONLY' USING ERRCODE='42501'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at<>OLD.created_at
    OR NEW.request_key IS DISTINCT FROM OLD.request_key THEN RAISE EXCEPTION 'TASK_ORIGIN_IMMUTABLE' USING ERRCODE='42501'; END IF;
  IF NOT v_admin AND (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.sector_id IS DISTINCT FROM OLD.sector_id
      OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at) THEN
   RAISE EXCEPTION 'TASK_ASSIGN_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
 END IF;
 IF length(btrim(NEW.title))=0 OR length(NEW.title)>240 OR length(coalesce(NEW.description,''))>500 THEN RAISE EXCEPTION 'TASK_INVALID_TEXT' USING ERRCODE='22023'; END IF;
 IF NEW.company_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.companies c WHERE c.id=NEW.company_id AND c.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'TASK_INVALID_COMPANY' USING ERRCODE='22023'; END IF;
 -- Legacy context can remain unchanged; new/changed context must use real catalog values.
 IF NEW.operator IS NOT NULL AND (TG_OP='INSERT' OR NEW.operator IS DISTINCT FROM OLD.operator OR NEW.company_id IS DISTINCT FROM OLD.company_id) AND NOT EXISTS
  (SELECT 1 FROM public.companies c CROSS JOIN LATERAL jsonb_array_elements(c.offerings) o WHERE c.workspace_id=NEW.workspace_id AND (NEW.company_id IS NULL OR c.id=NEW.company_id) AND o->>'operator'=NEW.operator)
  THEN RAISE EXCEPTION 'TASK_INVALID_OPERATOR' USING ERRCODE='22023'; END IF;
 IF NEW.project IS NOT NULL AND (TG_OP='INSERT' OR NEW.project IS DISTINCT FROM OLD.project OR NEW.company_id IS DISTINCT FROM OLD.company_id) AND NOT EXISTS
  (SELECT 1 FROM public.companies c WHERE c.workspace_id=NEW.workspace_id AND (NEW.company_id IS NULL OR c.id=NEW.company_id) AND c.project=NEW.project)
  THEN RAISE EXCEPTION 'TASK_INVALID_PROJECT' USING ERRCODE='22023'; END IF;
 IF NEW.lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.leads l WHERE l.id=NEW.lead_id AND l.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'TASK_INVALID_LEAD' USING ERRCODE='22023'; END IF;
 IF NEW.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=NEW.contact_id AND c.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'TASK_INVALID_CONTACT' USING ERRCODE='22023'; END IF;
 IF TG_OP='INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.sector_id IS DISTINCT FROM OLD.sector_id THEN
  IF NEW.sector_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.task_sectors s WHERE s.workspace_id=NEW.workspace_id AND s.id=NEW.sector_id AND s.active) THEN RAISE EXCEPTION 'TASK_INVALID_SECTOR' USING ERRCODE='22023'; END IF;
  IF NEW.assigned_to IS NOT NULL AND (NOT public.task_recipient_active(NEW.workspace_id,NEW.assigned_to) OR (NEW.sector_id IS NOT NULL AND NOT EXISTS
   (SELECT 1 FROM public.task_sector_members m WHERE m.workspace_id=NEW.workspace_id AND m.sector_id=NEW.sector_id AND m.user_id=NEW.assigned_to)))
   THEN RAISE EXCEPTION 'TASK_RECIPIENT_INELIGIBLE' USING ERRCODE='22023'; END IF;
  NEW.assigned_by:=auth.uid(); NEW.assigned_at:=now();
 END IF;
 -- Honor legacy status-only consumers, while preserving custom stage IDs.
 IF TG_OP='UPDATE' AND NEW.stage_id=OLD.stage_id AND NEW.status<>OLD.status THEN NEW.stage_id:=NEW.status::text; END IF;
 SELECT * INTO v_stage FROM public.task_stages WHERE workspace_id=NEW.workspace_id AND id=NEW.stage_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TASK_INVALID_STAGE' USING ERRCODE='22023'; END IF;
 NEW.status:=v_stage.base_status;
 IF NEW.status='done' THEN
  IF TG_OP='UPDATE' THEN NEW.completed_at:=coalesce(OLD.completed_at,now()); ELSE NEW.completed_at:=now(); END IF;
 ELSE NEW.completed_at:=NULL; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER task_write_guard BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.guard_task_write();

CREATE TABLE public.task_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id)
);
CREATE TABLE public.task_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, conversation_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL CHECK(length(content)<=16000),
 request_key uuid NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES public.task_conversations(workspace_id,id) ON DELETE CASCADE,
 UNIQUE(conversation_id,role,request_key)
);
CREATE TABLE public.task_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, conversation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES auth.users(id), payload jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
 target_task_id uuid REFERENCES public.tasks(id), target_updated_at timestamptz,
 confirmed_task_id uuid REFERENCES public.tasks(id), confirmed_version integer,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES public.task_conversations(workspace_id,id) ON DELETE CASCADE,
 UNIQUE(workspace_id,id)
);
CREATE TABLE public.task_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, draft_id uuid NOT NULL, task_id uuid REFERENCES public.tasks(id),
 storage_path text NOT NULL UNIQUE, name text NOT NULL, mime_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 20971520),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,draft_id) REFERENCES public.task_drafts(workspace_id,id) ON DELETE CASCADE,
 CHECK(storage_path LIKE workspace_id::text||'/'||draft_id::text||'/%')
);
CREATE TABLE public.task_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL, draft_id uuid REFERENCES public.task_drafts(id),
 actor_id uuid NOT NULL, kind text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_drafts_conversation ON public.task_drafts(conversation_id,created_at);
CREATE INDEX task_messages_conversation ON public.task_messages(conversation_id,created_at);
CREATE INDEX task_attachments_task ON public.task_attachments(task_id);

CREATE FUNCTION public.task_owns_conversation(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.task_conversations c WHERE c.id=p_id AND c.created_by=auth.uid() AND public.is_workspace_admin(c.workspace_id,auth.uid()));
$$;
CREATE FUNCTION public.task_owns_draft(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.id=p_id AND d.created_by=auth.uid() AND public.task_owns_conversation(d.conversation_id));
$$;

-- Explicit grants and policies for every new public table.
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['task_sectors','task_sector_members','task_stages','task_conversations','task_messages','task_drafts','task_attachments','task_events'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP; END; $$;
GRANT INSERT,UPDATE,DELETE ON public.task_sectors,public.task_sector_members,public.task_stages TO authenticated;
CREATE POLICY task_sectors_read ON public.task_sectors FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id,auth.uid()));
CREATE POLICY task_sectors_write ON public.task_sectors FOR ALL TO authenticated USING(public.is_workspace_admin(workspace_id,auth.uid())) WITH CHECK(public.is_workspace_admin(workspace_id,auth.uid()));
CREATE POLICY task_sector_members_read ON public.task_sector_members FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id,auth.uid()));
CREATE POLICY task_sector_members_write ON public.task_sector_members FOR ALL TO authenticated USING(public.is_workspace_admin(workspace_id,auth.uid())) WITH CHECK(public.is_workspace_admin(workspace_id,auth.uid()));
CREATE POLICY task_stages_read ON public.task_stages FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id,auth.uid()));
CREATE POLICY task_stages_write ON public.task_stages FOR ALL TO authenticated USING(public.is_workspace_admin(workspace_id,auth.uid())) WITH CHECK(public.is_workspace_admin(workspace_id,auth.uid()));
CREATE POLICY task_conversations_read ON public.task_conversations FOR SELECT TO authenticated USING(public.task_owns_conversation(id));
CREATE POLICY task_messages_read ON public.task_messages FOR SELECT TO authenticated USING(public.task_owns_conversation(conversation_id));
CREATE POLICY task_drafts_read ON public.task_drafts FOR SELECT TO authenticated USING(public.task_owns_draft(id));
CREATE POLICY task_attachments_read ON public.task_attachments FOR SELECT TO authenticated USING(public.task_owns_draft(draft_id) OR (task_id IS NOT NULL AND public.task_can_read(task_id)));
CREATE POLICY task_events_read ON public.task_events FOR SELECT TO authenticated USING(public.is_workspace_admin(workspace_id,auth.uid()) OR (task_id IS NOT NULL AND public.task_can_read(task_id)));

CREATE FUNCTION public.task_start_conversation(p_workspace uuid, p_id uuid) RETURNS public.task_conversations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.task_conversations; BEGIN
 IF NOT public.is_workspace_admin(p_workspace,auth.uid()) THEN RAISE EXCEPTION 'TASK_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
 INSERT INTO public.task_conversations(id,workspace_id,created_by) VALUES(p_id,p_workspace,auth.uid()) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO STRICT v FROM public.task_conversations WHERE id=p_id AND workspace_id=p_workspace AND created_by=auth.uid(); RETURN v;
END; $$;
CREATE FUNCTION public.task_post_message(p_conversation uuid,p_request uuid,p_content text) RETURNS public.task_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.task_messages; v_ws uuid; BEGIN
 IF NOT public.task_owns_conversation(p_conversation) THEN RAISE EXCEPTION 'TASK_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
 SELECT workspace_id INTO v_ws FROM public.task_conversations WHERE id=p_conversation;
 INSERT INTO public.task_messages(workspace_id,conversation_id,role,content,request_key) VALUES(v_ws,p_conversation,'user',p_content,p_request) ON CONFLICT(conversation_id,role,request_key) DO NOTHING;
 SELECT * INTO STRICT v FROM public.task_messages WHERE conversation_id=p_conversation AND role='user' AND request_key=p_request; RETURN v;
END; $$;
CREATE FUNCTION public.task_save_draft(p_conversation uuid,p_id uuid,p_version integer,p_payload jsonb,p_target uuid DEFAULT NULL) RETURNS public.task_drafts LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.task_drafts; v_ws uuid; v_task public.tasks; BEGIN
 IF NOT public.task_owns_conversation(p_conversation) THEN RAISE EXCEPTION 'TASK_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_payload)<>'object' OR length(p_payload::text)>24000 THEN RAISE EXCEPTION 'TASK_INVALID_DRAFT' USING ERRCODE='22023'; END IF;
 SELECT workspace_id INTO v_ws FROM public.task_conversations WHERE id=p_conversation;
 SELECT * INTO v FROM public.task_drafts WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF v.conversation_id<>p_conversation OR v.created_by<>auth.uid() THEN RAISE EXCEPTION 'TASK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF v.confirmed_task_id IS NULL AND v.payload=p_payload AND (v.version=p_version+1 OR (p_version=0 AND v.version=1)) THEN RETURN v; END IF;
  IF v.confirmed_task_id IS NOT NULL OR v.version<>p_version THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  UPDATE public.task_drafts SET payload=p_payload,version=version+1,updated_at=now() WHERE id=p_id RETURNING * INTO v;
 ELSE
  IF p_version<>0 THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF p_target IS NOT NULL THEN
   SELECT * INTO STRICT v_task FROM public.tasks WHERE id=p_target AND workspace_id=v_ws;
  END IF;
  INSERT INTO public.task_drafts(id,workspace_id,conversation_id,created_by,payload,target_task_id,target_updated_at)
   VALUES(p_id,v_ws,p_conversation,auth.uid(),p_payload,p_target,v_task.updated_at) RETURNING * INTO v;
 END IF;
 INSERT INTO public.task_events(workspace_id,draft_id,actor_id,kind,details) VALUES(v_ws,v.id,auth.uid(),'draft_saved',jsonb_build_object('version',v.version));
 RETURN v;
END; $$;

CREATE FUNCTION public.task_confirm_draft(p_id uuid,p_version integer) RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.task_drafts; t public.tasks; p jsonb; v_sector uuid; v_assignee uuid; v_company uuid; v_stage text; BEGIN
 IF NOT public.task_owns_draft(p_id) THEN RAISE EXCEPTION 'TASK_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT d FROM public.task_drafts WHERE id=p_id FOR UPDATE;
 IF d.confirmed_task_id IS NOT NULL AND d.confirmed_version=p_version THEN SELECT * INTO STRICT t FROM public.tasks WHERE id=d.confirmed_task_id; RETURN t; END IF;
 IF d.version<>p_version OR d.confirmed_task_id IS NOT NULL THEN RAISE EXCEPTION 'TASK_DRAFT_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 p:=d.payload;
 IF jsonb_typeof(p->'unresolved')='array' AND jsonb_array_length(p->'unresolved')>0 THEN RAISE EXCEPTION 'TASK_REVIEW_REQUIRED' USING ERRCODE='22023'; END IF;
 v_sector:=nullif(p->>'sector_id','')::uuid; v_assignee:=nullif(p->>'assigned_to','')::uuid; v_company:=nullif(p->>'company_id','')::uuid;
 IF v_sector IS NULL THEN RAISE EXCEPTION 'TASK_SECTOR_REQUIRED' USING ERRCODE='22023'; END IF;
 v_stage:=coalesce(nullif(p->>'stage_id',''),(SELECT id FROM public.task_stages WHERE workspace_id=d.workspace_id AND NOT archived ORDER BY position,id LIMIT 1));
 IF NOT EXISTS(SELECT 1 FROM public.task_sectors WHERE id=v_sector AND workspace_id=d.workspace_id AND active) OR
  (v_assignee IS NOT NULL AND (NOT public.task_recipient_active(d.workspace_id,v_assignee) OR NOT EXISTS(SELECT 1 FROM public.task_sector_members m JOIN public.workspace_members w USING(workspace_id,user_id) WHERE m.workspace_id=d.workspace_id AND m.sector_id=v_sector AND m.user_id=v_assignee)))
  THEN RAISE EXCEPTION 'TASK_RECIPIENT_INELIGIBLE' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.task_attachments a WHERE a.draft_id=d.id AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='task-attachments' AND o.name=a.storage_path))
  THEN RAISE EXCEPTION 'TASK_ATTACHMENT_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 IF d.target_task_id IS NULL THEN
  INSERT INTO public.tasks(workspace_id,title,description,company_id,operational_code,operator,project,sector_id,assigned_to,created_by,due_date,priority,stage_id,request_key)
   VALUES(d.workspace_id,btrim(p->>'title'),nullif(p->>'description',''),v_company,nullif(p->>'operational_code',''),nullif(p->>'operator',''),nullif(p->>'project',''),v_sector,v_assignee,auth.uid(),
    CASE WHEN nullif(p->>'due_date','') IS NULL THEN NULL ELSE ((p->>'due_date')::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo' END,
    coalesce(nullif(p->>'priority',''),'medium')::public.task_priority,v_stage,d.id) RETURNING * INTO t;
 ELSE
  SELECT * INTO STRICT t FROM public.tasks WHERE id=d.target_task_id AND workspace_id=d.workspace_id FOR UPDATE;
  IF t.updated_at<>d.target_updated_at THEN RAISE EXCEPTION 'TASK_TARGET_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  UPDATE public.tasks SET title=btrim(p->>'title'),description=nullif(p->>'description',''),company_id=v_company,operational_code=nullif(p->>'operational_code',''),operator=nullif(p->>'operator',''),project=nullif(p->>'project',''),sector_id=v_sector,assigned_to=v_assignee,
    due_date=CASE WHEN nullif(p->>'due_date','') IS NULL THEN NULL ELSE ((p->>'due_date')::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo' END,
    priority=coalesce(nullif(p->>'priority',''),'medium')::public.task_priority,stage_id=v_stage WHERE id=t.id RETURNING * INTO t;
 END IF;
 UPDATE public.task_attachments SET task_id=t.id WHERE draft_id=d.id;
 UPDATE public.task_drafts SET confirmed_task_id=t.id,confirmed_version=p_version,updated_at=now() WHERE id=d.id;
 INSERT INTO public.task_events(workspace_id,task_id,draft_id,actor_id,kind,details) VALUES(d.workspace_id,t.id,d.id,auth.uid(),'confirmed',jsonb_build_object('version',p_version,'sector_id',t.sector_id,'assigned_to',t.assigned_to));
 RETURN t;
END; $$;

CREATE FUNCTION public.task_register_attachment(p_draft uuid,p_id uuid,p_name text,p_mime text,p_size bigint,p_path text) RETURNS public.task_attachments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.task_drafts; a public.task_attachments; BEGIN
 IF NOT public.task_owns_draft(p_draft) THEN RAISE EXCEPTION 'TASK_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.task_attachments WHERE id=p_id;
 IF FOUND THEN
  IF a.draft_id<>p_draft OR a.storage_path<>p_path THEN RAISE EXCEPTION 'TASK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  RETURN a;
 END IF;
 SELECT * INTO STRICT d FROM public.task_drafts WHERE id=p_draft FOR UPDATE;
 IF d.confirmed_task_id IS NOT NULL THEN RAISE EXCEPTION 'TASK_ALREADY_CONFIRMED' USING ERRCODE='22023'; END IF;
 IF p_name !~* '\.(pdf|png|jpe?g|webp|txt|csv|docx?|xlsx?)$' THEN RAISE EXCEPTION 'TASK_INVALID_ATTACHMENT_FORMAT' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='task-attachments' AND name=p_path) THEN RAISE EXCEPTION 'TASK_ATTACHMENT_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 INSERT INTO public.task_attachments(id,workspace_id,draft_id,name,mime_type,size_bytes,storage_path,created_by) VALUES(p_id,d.workspace_id,d.id,p_name,p_mime,p_size,p_path,auth.uid()) RETURNING * INTO a;
 UPDATE public.task_drafts SET version=version+1,updated_at=now() WHERE id=d.id;
 RETURN a;
END; $$;

CREATE FUNCTION public.task_record_interpretation(p_message uuid,p_reply text,p_drafts jsonb,p_query_result jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.task_messages; entry jsonb; d public.task_drafts; ids jsonb:='[]'; result_value jsonb; BEGIN
 SELECT * INTO STRICT m FROM public.task_messages WHERE id=p_message FOR UPDATE;
 IF m.role<>'user' OR NOT public.task_owns_conversation(m.conversation_id) THEN RAISE EXCEPTION 'TASK_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
 IF m.result IS NOT NULL THEN RETURN m.result; END IF;
 IF jsonb_typeof(p_drafts)<>'array' OR jsonb_array_length(p_drafts)>20 THEN RAISE EXCEPTION 'TASK_INVALID_DRAFT' USING ERRCODE='22023'; END IF;
 FOR entry IN SELECT * FROM jsonb_array_elements(p_drafts) LOOP
  SELECT * INTO d FROM public.task_save_draft(m.conversation_id,coalesce(nullif(entry->>'id','')::uuid,gen_random_uuid()),coalesce((entry->>'version')::integer,0),entry->'payload',nullif(entry->>'target_task_id','')::uuid);
  ids:=ids||to_jsonb(d.id);
 END LOOP;
 result_value:=jsonb_build_object('draft_ids',ids,'tasks',p_query_result);
 UPDATE public.task_messages SET result=result_value WHERE id=m.id;
 INSERT INTO public.task_messages(workspace_id,conversation_id,role,content,request_key,result) VALUES(m.workspace_id,m.conversation_id,'assistant',p_reply,m.request_key,result_value);
 RETURN result_value;
END; $$;

CREATE FUNCTION public.task_audit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.task_events(workspace_id,task_id,actor_id,kind,details) VALUES(NEW.workspace_id,NEW.id,auth.uid(),CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,
 jsonb_build_object('current',to_jsonb(NEW),'previous',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END)); RETURN NEW;
END; $$;
CREATE TRIGGER task_audit AFTER INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.task_audit_change();

INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('task-attachments','task-attachments',false,20971520);
CREATE POLICY task_storage_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='task-attachments' AND
 (EXISTS(SELECT 1 FROM public.task_attachments a WHERE a.storage_path=storage.objects.name AND (public.task_owns_draft(a.draft_id) OR public.task_can_read(a.task_id))) OR
  EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.id::text=(storage.foldername(name))[2] AND d.workspace_id::text=(storage.foldername(name))[1] AND public.task_owns_draft(d.id))));
CREATE POLICY task_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='task-attachments' AND EXISTS
 (SELECT 1 FROM public.task_drafts d WHERE d.id::text=(storage.foldername(name))[2] AND d.workspace_id::text=(storage.foldername(name))[1] AND d.confirmed_task_id IS NULL AND public.task_owns_draft(d.id)));
CREATE POLICY task_storage_cleanup ON storage.objects FOR DELETE TO authenticated USING(bucket_id='task-attachments' AND NOT EXISTS(SELECT 1 FROM public.task_attachments a WHERE a.storage_path=storage.objects.name) AND EXISTS
 (SELECT 1 FROM public.task_drafts d WHERE d.id::text=(storage.foldername(name))[2] AND d.workspace_id::text=(storage.foldername(name))[1] AND d.confirmed_task_id IS NULL AND public.task_owns_draft(d.id)));

-- Only explicitly exposed functions can be invoked from a client.
DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.proname LIKE 'task\_%' ESCAPE '\' OR p.proname IN ('guard_task_write','seed_task_stages')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',f.signature);
 IF f.signature::text NOT LIKE '%task_audit_change%' AND f.signature::text NOT LIKE '%guard_task_write%' AND f.signature::text NOT LIKE '%seed_task_stages%' THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f.signature); END IF;
 END LOOP; END; $$;
