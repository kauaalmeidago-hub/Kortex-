
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ws_id UUID;
  _name TEXT;
  _slug TEXT;
  _p1 UUID; _p2 UUID;
  _s_new UUID; _s_qual UUID; _s_prop UUID; _s_won UUID;
  _c1 UUID; _c2 UUID; _c3 UUID;
  _co1 UUID; _co2 UUID;
BEGIN
  _name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1));
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, _name, NEW.raw_user_meta_data->>'avatar_url');

  _slug := lower(regexp_replace(_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(NEW.id::text,1,8);
  INSERT INTO public.workspaces (name, slug, owner_id)
  VALUES (_name || '''s Workspace', _slug, NEW.id) RETURNING id INTO _ws_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (_ws_id, NEW.id, 'admin');

  -- Pipelines
  INSERT INTO public.pipelines (workspace_id, name, slug, position) VALUES
    (_ws_id, 'Vendas', 'vendas', 0) RETURNING id INTO _p1;
  INSERT INTO public.pipelines (workspace_id, name, slug, position) VALUES
    (_ws_id, 'Suporte', 'suporte', 1) RETURNING id INTO _p2;

  -- Stages for Vendas
  INSERT INTO public.stages (pipeline_id, workspace_id, name, color, position) VALUES
    (_p1, _ws_id, 'Novo', 'blue', 0) RETURNING id INTO _s_new;
  INSERT INTO public.stages (pipeline_id, workspace_id, name, color, position) VALUES
    (_p1, _ws_id, 'Qualificado', 'yellow', 1) RETURNING id INTO _s_qual;
  INSERT INTO public.stages (pipeline_id, workspace_id, name, color, position) VALUES
    (_p1, _ws_id, 'Proposta', 'orange', 2) RETURNING id INTO _s_prop;
  INSERT INTO public.stages (pipeline_id, workspace_id, name, color, position) VALUES
    (_p1, _ws_id, 'Ganho', 'green', 3) RETURNING id INTO _s_won;
  INSERT INTO public.stages (pipeline_id, workspace_id, name, color, position) VALUES
    (_p1, _ws_id, 'Perdido', 'red', 4);

  -- Companies
  INSERT INTO public.companies (workspace_id, name, industry, website, created_by) VALUES
    (_ws_id, 'Alliance Corretora', 'Seguros', 'alliancecorretora.com.br', NEW.id) RETURNING id INTO _co1;
  INSERT INTO public.companies (workspace_id, name, industry, website, created_by) VALUES
    (_ws_id, 'TechNova Ltda', 'Tecnologia', 'technova.com', NEW.id) RETURNING id INTO _co2;
  INSERT INTO public.companies (workspace_id, name, industry, created_by) VALUES
    (_ws_id, 'Mercado Verde', 'Varejo', NEW.id);

  -- Contacts
  INSERT INTO public.contacts (workspace_id, company_id, full_name, email, phone, job_title, created_by) VALUES
    (_ws_id, _co1, 'Marina Souza', 'marina@alliancecorretora.com.br', '+55 11 99999-1234', 'Diretora Comercial', NEW.id) RETURNING id INTO _c1;
  INSERT INTO public.contacts (workspace_id, company_id, full_name, email, phone, job_title, created_by) VALUES
    (_ws_id, _co2, 'Carlos Mendes', 'carlos@technova.com', '+55 21 98888-5678', 'CEO', NEW.id) RETURNING id INTO _c2;
  INSERT INTO public.contacts (workspace_id, full_name, email, job_title, created_by) VALUES
    (_ws_id, 'Ana Beatriz', 'ana@mercadoverde.com', 'Gerente', NEW.id) RETURNING id INTO _c3;

  -- Leads
  INSERT INTO public.leads (workspace_id, pipeline_id, stage_id, contact_id, company_id, assigned_to, title, value, status, created_by) VALUES
    (_ws_id, _p1, _s_new, _c1, _co1, NEW.id, 'Implantação CRM Alliance', 15000, 'new', NEW.id),
    (_ws_id, _p1, _s_qual, _c2, _co2, NEW.id, 'Plataforma de seguros TechNova', 48000, 'qualified', NEW.id),
    (_ws_id, _p1, _s_prop, _c3, NULL, NEW.id, 'Proposta Mercado Verde', 8500, 'proposal', NEW.id),
    (_ws_id, _p1, _s_won, _c1, _co1, NEW.id, 'Renovação anual Alliance', 22000, 'won', NEW.id),
    (_ws_id, _p1, _s_new, _c2, _co2, NEW.id, 'Consultoria estratégica', 5500, 'new', NEW.id);

  -- Tasks
  INSERT INTO public.tasks (workspace_id, assigned_to, title, description, priority, status, due_date, created_by) VALUES
    (_ws_id, NEW.id, 'Ligar para Marina (Alliance)', 'Confirmar reunião de quinta-feira', 'high', 'todo', now() + interval '1 day', NEW.id),
    (_ws_id, NEW.id, 'Enviar proposta TechNova', NULL, 'high', 'in_progress', now() + interval '2 days', NEW.id),
    (_ws_id, NEW.id, 'Follow-up Mercado Verde', 'Conferir se receberam o e-mail', 'medium', 'todo', now() + interval '3 days', NEW.id),
    (_ws_id, NEW.id, 'Atualizar pipeline mensal', NULL, 'low', 'done', now() - interval '1 day', NEW.id);

  -- Automations
  INSERT INTO public.automations (workspace_id, name, description, trigger_type, action_type, is_active, created_by) VALUES
    (_ws_id, 'Boas-vindas a novos leads', 'Envia e-mail automático quando um lead é criado', 'lead_created', 'send_email', true, NEW.id),
    (_ws_id, 'Tarefa de follow-up após 3 dias', 'Cria tarefa de acompanhamento 3 dias após estágio qualificado', 'stage_changed', 'create_task', true, NEW.id);

  RETURN NEW;
END; $$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
