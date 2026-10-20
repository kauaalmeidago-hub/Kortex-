-- Administrative release is explicit and scoped. Never enable all production modules.
CREATE TABLE app_private.task_admin_invites (
 email text PRIMARY KEY CHECK(email=lower(btrim(email))),
 claimed_by uuid REFERENCES auth.users(id), workspace_id uuid REFERENCES public.workspaces(id),
 created_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz,
 CHECK((claimed_by IS NULL)=(workspace_id IS NULL))
);
CREATE TABLE app_private.task_admin_grants (
 user_id uuid NOT NULL REFERENCES auth.users(id),workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,workspace_id)
);
CREATE FUNCTION app_private.task_admin_actor(p_workspace uuid,p_user uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p_user IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users u JOIN public.workspace_members w ON w.user_id=u.id
 WHERE u.id=p_user AND w.workspace_id=p_workspace AND w.active AND u.email_confirmed_at IS NOT NULL
 AND (u.banned_until IS NULL OR u.banned_until<now())
 AND (public.business_modules_enabled() OR EXISTS(SELECT 1 FROM app_private.task_admin_grants g WHERE g.user_id=p_user AND g.workspace_id=p_workspace AND g.active))
 AND EXISTS(SELECT 1 FROM public.task_sector_members m WHERE m.user_id=p_user AND m.workspace_id=p_workspace AND m.can_dispatch AND app_private.member(m.workspace_id,m.sector_id,p_user)));
$$;
CREATE FUNCTION public.task_admin_accept_invite(p_workspace uuid DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u auth.users;i app_private.task_admin_invites;ws uuid;n integer;BEGIN
 SELECT * INTO u FROM auth.users WHERE id=auth.uid();
 IF u.id IS NULL OR u.email_confirmed_at IS NULL OR (u.banned_until IS NOT NULL AND u.banned_until>now()) THEN RETURN false;END IF;
 SELECT * INTO i FROM app_private.task_admin_invites WHERE email=lower(u.email) FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF i.claimed_by IS NOT NULL THEN RETURN i.claimed_by=u.id AND EXISTS(SELECT 1 FROM app_private.task_admin_grants g WHERE g.user_id=u.id AND g.workspace_id=i.workspace_id AND g.active);END IF;
 -- An unbound invitation can only be claimed in the user's own organization.
 -- It cannot enrol that person into a pre-existing organization owned by someone else.
 SELECT count(*),min(w.id::text)::uuid INTO n,ws FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id AND m.user_id=u.id AND m.active
 WHERE w.owner_id=u.id AND (p_workspace IS NULL OR w.id=p_workspace)
 AND EXISTS(SELECT 1 FROM public.task_sector_members sm WHERE sm.user_id=u.id AND sm.workspace_id=w.id AND app_private.member(sm.workspace_id,sm.sector_id,u.id));
 IF n<>1 THEN RETURN false;END IF;
 INSERT INTO app_private.task_admin_grants(user_id,workspace_id) VALUES(u.id,ws);
 UPDATE public.task_sector_members SET can_dispatch=true,can_manage_boards=true,can_manage_members=true
 WHERE user_id=u.id AND workspace_id=ws AND active;
 UPDATE app_private.task_admin_invites SET claimed_by=u.id,workspace_id=ws,claimed_at=now() WHERE email=i.email;
 RETURN true;
END;$$;
CREATE FUNCTION public.task_admin_access(p_board uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.business_boards b WHERE b.id=p_board AND b.kind='tasks'
 AND app_private.task_admin_actor(b.workspace_id,auth.uid()) AND public.business_can_board(b.id,'dispatch'));
$$;
CREATE OR REPLACE FUNCTION public.task_owns_conversation(p_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.task_conversations c WHERE c.id=p_id AND c.created_by=auth.uid() AND public.task_admin_access(c.board_id)
 AND NOT EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.conversation_id=c.id AND coalesce(d.confirmed_task_id,d.target_task_id) IS NOT NULL
 AND NOT public.task_can_read(coalesce(d.confirmed_task_id,d.target_task_id))));
$$;
CREATE OR REPLACE FUNCTION public.business_start_conversation(p_board uuid,p_id uuid) RETURNS public.task_conversations
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;c public.task_conversations;BEGIN
 IF NOT public.task_admin_access(p_board) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.business_boards WHERE id=p_board AND kind='tasks';
 INSERT INTO public.task_conversations(id,workspace_id,board_id,created_by) VALUES(p_id,b.workspace_id,b.id,auth.uid()) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO c FROM public.task_conversations WHERE id=p_id AND board_id=b.id AND created_by=auth.uid();
 IF c.id IS NULL OR NOT public.task_owns_conversation(c.id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;RETURN c;
END;$$;

CREATE TABLE app_private.task_ai_connections (
 user_id uuid NOT NULL REFERENCES auth.users(id),workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 secret_id uuid NOT NULL REFERENCES vault.secrets(id),model text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),window_start timestamptz NOT NULL DEFAULT now(),
 window_requests integer NOT NULL DEFAULT 0,usage_day date NOT NULL DEFAULT current_date,day_requests integer NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,workspace_id)
);
CREATE TABLE app_private.task_ai_runs (
 message_id uuid PRIMARY KEY REFERENCES public.task_messages(id),actor_id uuid NOT NULL REFERENCES auth.users(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),conversation_id uuid NOT NULL REFERENCES public.task_conversations(id),
 draft_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),state text NOT NULL CHECK(state IN ('pending','complete','failed')),
 lease_id uuid NOT NULL DEFAULT gen_random_uuid(),lease_until timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 error_code text
);
CREATE FUNCTION public.task_ai_status(p_workspace uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app_private.task_ai_connections;BEGIN
 IF NOT app_private.task_admin_actor(p_workspace,auth.uid()) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM app_private.task_ai_connections WHERE workspace_id=p_workspace AND user_id=auth.uid();
 RETURN jsonb_build_object('configured',c.secret_id IS NOT NULL,'model',c.model,'updated_at',c.updated_at);
END;$$;
-- These operations are executable only by the Edge Function's server role.
-- Every supplied actor must also pass the current organization/sector authorization.
CREATE FUNCTION public.task_ai_configure(p_user uuid,p_workspace uuid,p_key text,p_model text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE secret uuid;BEGIN
 IF NOT app_private.task_admin_actor(p_workspace,p_user) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF length(p_key) NOT BETWEEN 20 AND 512 OR p_key !~ '^sk-[A-Za-z0-9_-]+$' OR p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' THEN RAISE EXCEPTION 'INVALID_CONNECTION' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||p_workspace::text,7));
 SELECT secret_id INTO secret FROM app_private.task_ai_connections WHERE user_id=p_user AND workspace_id=p_workspace FOR UPDATE;
 IF secret IS NULL THEN SELECT vault.create_secret(p_key,'task-ai-'||p_user::text||'-'||p_workspace::text,'OpenAI: scoped task administration') INTO secret;
 ELSE PERFORM vault.update_secret(secret,p_key);END IF;
 INSERT INTO app_private.task_ai_connections(user_id,workspace_id,secret_id,model) VALUES(p_user,p_workspace,secret,p_model)
 ON CONFLICT(user_id,workspace_id) DO UPDATE SET model=EXCLUDED.model,updated_at=now();
END;$$;
CREATE FUNCTION public.task_ai_secret(p_user uuid,p_workspace uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE value jsonb;BEGIN
 IF NOT app_private.task_admin_actor(p_workspace,p_user) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('api_key',v.decrypted_secret,'model',c.model) INTO value FROM app_private.task_ai_connections c JOIN vault.decrypted_secrets v ON v.id=c.secret_id
 WHERE c.user_id=p_user AND c.workspace_id=p_workspace;RETURN value;
END;$$;
CREATE FUNCTION public.task_ai_disconnect(p_user uuid,p_workspace uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE secret uuid;BEGIN
 IF NOT app_private.task_admin_actor(p_workspace,p_user) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 DELETE FROM app_private.task_ai_connections WHERE user_id=p_user AND workspace_id=p_workspace RETURNING secret_id INTO secret;
 IF secret IS NOT NULL THEN DELETE FROM vault.secrets WHERE id=secret;END IF;
END;$$;
CREATE FUNCTION public.task_ai_claim(p_user uuid,p_message uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.task_conversations;m public.task_messages;r app_private.task_ai_runs;connection app_private.task_ai_connections;BEGIN
 SELECT * INTO m FROM public.task_messages WHERE id=p_message AND role='user';
 SELECT * INTO c FROM public.task_conversations WHERE id=m.conversation_id AND created_by=p_user;
 IF c.id IS NULL OR NOT app_private.task_admin_actor(c.workspace_id,p_user)
 OR NOT app_private.member(c.workspace_id,(SELECT sector_id FROM public.business_boards WHERE id=c.board_id),p_user)
 OR NOT EXISTS(SELECT 1 FROM public.business_boards b LEFT JOIN public.business_board_members bm ON bm.board_id=b.id AND bm.user_id=p_user AND bm.active
 JOIN public.task_sector_members sm ON sm.workspace_id=b.workspace_id AND sm.sector_id=b.sector_id AND sm.user_id=p_user AND sm.active AND sm.can_dispatch
 WHERE b.id=c.board_id AND NOT b.archived AND b.kind='tasks' AND b.visibility<>'restricted' AND (b.owner_id=p_user OR coalesce(bm.can_write,false) OR coalesce(bm.can_manage,false)))
 THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO connection FROM app_private.task_ai_connections WHERE user_id=p_user AND workspace_id=c.workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_NOT_CONFIGURED' USING ERRCODE='22023';END IF;
 SELECT * INTO r FROM app_private.task_ai_runs WHERE message_id=m.id FOR UPDATE;
 IF FOUND THEN
  IF r.actor_id<>p_user THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  IF EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.id=r.draft_id AND d.created_by=p_user AND d.conversation_id=c.id) THEN
   UPDATE app_private.task_ai_runs SET state='complete' WHERE message_id=m.id;RETURN jsonb_build_object('state','complete','draft_id',r.draft_id);
  END IF;
  IF r.state='pending' AND r.lease_until>now() THEN RAISE EXCEPTION 'AI_BUSY' USING ERRCODE='PT409';END IF;
 END IF;
 IF (connection.window_start>now()-interval '1 minute' AND connection.window_requests>=10) OR (connection.usage_day=current_date AND connection.day_requests>=100) THEN RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE='PT429';END IF;
 UPDATE app_private.task_ai_connections SET window_requests=CASE WHEN window_start>now()-interval '1 minute' THEN window_requests+1 ELSE 1 END,
 window_start=CASE WHEN window_start>now()-interval '1 minute' THEN window_start ELSE now() END,
 day_requests=CASE WHEN usage_day=current_date THEN day_requests+1 ELSE 1 END,usage_day=current_date WHERE user_id=p_user AND workspace_id=c.workspace_id;
 INSERT INTO app_private.task_ai_runs(message_id,actor_id,workspace_id,conversation_id,state,lease_until)
 VALUES(m.id,p_user,c.workspace_id,c.id,'pending',now()+interval '90 seconds')
 ON CONFLICT(message_id) DO UPDATE SET state='pending',lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds',error_code=NULL RETURNING * INTO r;
 RETURN jsonb_build_object('state',r.state,'draft_id',r.draft_id,'lease_id',r.lease_id);
END;$$;
CREATE FUNCTION public.task_ai_complete(p_user uuid,p_message uuid,p_lease uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.task_ai_runs;BEGIN
 SELECT * INTO r FROM app_private.task_ai_runs WHERE message_id=p_message AND actor_id=p_user AND lease_id=p_lease FOR UPDATE;
 IF r.message_id IS NULL OR NOT app_private.task_admin_actor(r.workspace_id,p_user)
 OR NOT EXISTS(SELECT 1 FROM public.task_drafts d WHERE d.id=r.draft_id AND d.created_by=p_user AND d.conversation_id=r.conversation_id)
 THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 INSERT INTO public.task_messages(workspace_id,conversation_id,role,content,request_key,result)
 VALUES(r.workspace_id,r.conversation_id,'assistant','Organizei um rascunho. Confira os dados e confirme o encaminhamento.',r.message_id,jsonb_build_object('draft_id',r.draft_id,'source_message_id',r.message_id))
 ON CONFLICT(conversation_id,role,request_key) DO NOTHING;
 UPDATE app_private.task_ai_runs SET state='complete',error_code=NULL WHERE message_id=r.message_id;
END;$$;
CREATE FUNCTION public.task_ai_fail(p_user uuid,p_message uuid,p_lease uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN UPDATE app_private.task_ai_runs SET state='failed',error_code='INTERPRETATION_FAILED' WHERE message_id=p_message AND actor_id=p_user AND lease_id=p_lease AND state='pending';END;$$;
DO $$ DECLARE t text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['task_admin_invites','task_admin_grants','task_ai_connections','task_ai_runs'] LOOP
 EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app_private.%I FROM PUBLIC,anon,authenticated,service_role',t);END LOOP;
 FOR f IN SELECT p.oid::regprocedure sig,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
 (n.nspname='public' AND (p.proname LIKE 'task_ai_%' OR p.proname IN ('task_admin_access','task_admin_accept_invite')))
 OR (n.nspname='app_private' AND p.proname='task_admin_actor') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 IF f.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
 IF f.proname IN ('task_ai_status','task_admin_access','task_admin_accept_invite') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.sig);END IF;END IF;END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
