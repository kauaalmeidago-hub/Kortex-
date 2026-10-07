
-- =====================================================
-- ENUMS
-- =====================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'member');
CREATE TYPE public.task_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE public.task_status AS ENUM ('todo', 'in_progress', 'done', 'canceled');
CREATE TYPE public.lead_status AS ENUM ('new', 'qualified', 'proposal', 'negotiation', 'won', 'lost');

-- =====================================================
-- UTIL: updated_at trigger
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =====================================================
-- PROFILES
-- =====================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  job_title TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all_auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- WORKSPACES
-- =====================================================
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_workspaces_updated BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- WORKSPACE MEMBERS (with role)
-- =====================================================
CREATE TABLE public.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- SECURITY DEFINER HELPERS
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members
                 WHERE workspace_id = _workspace_id AND user_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(_workspace_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members
                 WHERE workspace_id = _workspace_id AND user_id = _user_id AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.user_workspaces(_user_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT workspace_id FROM public.workspace_members WHERE user_id = _user_id;
$$;

-- Policies that depend on helpers
CREATE POLICY "workspaces_select_members" ON public.workspaces FOR SELECT TO authenticated
  USING (public.is_workspace_member(id, auth.uid()));
CREATE POLICY "workspaces_insert_self" ON public.workspaces FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "workspaces_update_admin" ON public.workspaces FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(id, auth.uid()));
CREATE POLICY "workspaces_delete_owner" ON public.workspaces FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "members_select_own_workspace" ON public.workspace_members FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members_insert_admin" ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid()) OR user_id = auth.uid());
CREATE POLICY "members_update_admin" ON public.workspace_members FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(workspace_id, auth.uid()));
CREATE POLICY "members_delete_admin" ON public.workspace_members FOR DELETE TO authenticated
  USING (public.is_workspace_admin(workspace_id, auth.uid()));

-- =====================================================
-- HANDLE NEW USER: profile + personal workspace + admin
-- =====================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ws_id UUID;
  _name TEXT;
  _slug TEXT;
BEGIN
  _name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1));
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, _name, NEW.raw_user_meta_data->>'avatar_url');

  _slug := lower(regexp_replace(_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(NEW.id::text,1,8);
  INSERT INTO public.workspaces (name, slug, owner_id)
  VALUES (_name || '''s Workspace', _slug, NEW.id)
  RETURNING id INTO _ws_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (_ws_id, NEW.id, 'admin');

  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- COMPANIES
-- =====================================================
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  industry TEXT,
  website TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "companies_ws_access" ON public.companies FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- CONTACTS
-- =====================================================
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  job_title TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts_ws_access" ON public.contacts FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_contacts_updated BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- PIPELINES + STAGES
-- =====================================================
CREATE TABLE public.pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipelines TO authenticated;
GRANT ALL ON public.pipelines TO service_role;
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pipelines_ws_access" ON public.pipelines FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_pipelines_updated BEFORE UPDATE ON public.pipelines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stages TO authenticated;
GRANT ALL ON public.stages TO service_role;
ALTER TABLE public.stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stages_ws_access" ON public.stages FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

-- =====================================================
-- LEADS
-- =====================================================
CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  pipeline_id UUID REFERENCES public.pipelines(id) ON DELETE SET NULL,
  stage_id UUID REFERENCES public.stages(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES auth.users(id),
  title TEXT NOT NULL,
  description TEXT,
  value NUMERIC(12,2) DEFAULT 0,
  status public.lead_status NOT NULL DEFAULT 'new',
  position INT NOT NULL DEFAULT 0,
  expected_close_date DATE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads_ws_access" ON public.leads FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- TASKS
-- =====================================================
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES auth.users(id),
  title TEXT NOT NULL,
  description TEXT,
  priority public.task_priority NOT NULL DEFAULT 'medium',
  status public.task_status NOT NULL DEFAULT 'todo',
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_ws_access" ON public.tasks FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- AUTOMATIONS
-- =====================================================
CREATE TABLE public.automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB DEFAULT '{}'::jsonb,
  action_type TEXT NOT NULL,
  action_config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  run_count INT NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automations TO authenticated;
GRANT ALL ON public.automations TO service_role;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "automations_ws_access" ON public.automations FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_automations_updated BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- ACTIVITIES (timeline)
-- =====================================================
CREATE TABLE public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  type TEXT NOT NULL,
  content TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO authenticated;
GRANT ALL ON public.activities TO service_role;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activities_ws_access" ON public.activities FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

-- =====================================================
-- NOTES
-- =====================================================
CREATE TABLE public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
GRANT ALL ON public.notes TO service_role;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes_ws_access" ON public.notes FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_notes_updated BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_members_user ON public.workspace_members(user_id);
CREATE INDEX idx_members_ws ON public.workspace_members(workspace_id);
CREATE INDEX idx_companies_ws ON public.companies(workspace_id);
CREATE INDEX idx_contacts_ws ON public.contacts(workspace_id);
CREATE INDEX idx_pipelines_ws ON public.pipelines(workspace_id);
CREATE INDEX idx_stages_pipeline ON public.stages(pipeline_id);
CREATE INDEX idx_leads_ws ON public.leads(workspace_id);
CREATE INDEX idx_leads_pipeline ON public.leads(pipeline_id);
CREATE INDEX idx_leads_stage ON public.leads(stage_id);
CREATE INDEX idx_tasks_ws ON public.tasks(workspace_id);
CREATE INDEX idx_tasks_assigned ON public.tasks(assigned_to);
CREATE INDEX idx_automations_ws ON public.automations(workspace_id);
CREATE INDEX idx_activities_lead ON public.activities(lead_id);
CREATE INDEX idx_notes_lead ON public.notes(lead_id);
