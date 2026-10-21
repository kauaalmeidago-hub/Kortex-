-- Atendimento is distinct from a WhatsApp conversation. No automatic messages
-- or retroactive AI jobs are created by this migration.
CREATE TABLE public.wa_channel_grants (
 connection_id uuid NOT NULL REFERENCES public.wa_connections(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 can_manage boolean NOT NULL DEFAULT false,
 granted_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connection_id,user_id)
);
CREATE TABLE public.wa_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 sector_id uuid NOT NULL, origin_connection_id uuid NOT NULL REFERENCES public.wa_connections(id),
 origin_conversation_id uuid NOT NULL REFERENCES public.wa_conversations(id),
 connection_id uuid NOT NULL REFERENCES public.wa_connections(id), conversation_id uuid NOT NULL,
 phase text NOT NULL DEFAULT 'triage' CHECK(phase IN('triage','active','pending','resolved')),
 triage_state text NOT NULL DEFAULT 'manual' CHECK(triage_state IN('manual','analyzing','waiting_customer','ready')),
 assigned_to uuid REFERENCES auth.users(id), claimed_by uuid REFERENCES auth.users(id),
 summary text NOT NULL DEFAULT '' CHECK(length(summary)<=6000), request_type text NOT NULL DEFAULT '' CHECK(length(request_type)<=120),
 pending_reason text NOT NULL DEFAULT '' CHECK(length(pending_reason)<=1000),
 continuity_pending boolean NOT NULL DEFAULT false, needs_review boolean NOT NULL DEFAULT false,
 is_current boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,sector_id) REFERENCES public.task_sectors(workspace_id,id),
 FOREIGN KEY(connection_id,conversation_id) REFERENCES public.wa_conversations(connection_id,id),
 CHECK(phase<>'active' OR claimed_by IS NOT NULL)
);
CREATE UNIQUE INDEX wa_case_current_conversation ON public.wa_cases(conversation_id) WHERE is_current;
CREATE INDEX wa_case_workspace_phase ON public.wa_cases(workspace_id,phase,updated_at DESC) WHERE is_current;
CREATE INDEX wa_case_assigned ON public.wa_cases(assigned_to,workspace_id) WHERE is_current;
CREATE INDEX wa_case_channel ON public.wa_cases(connection_id);
CREATE TABLE public.wa_case_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.wa_cases(id),
 actor_id uuid REFERENCES auth.users(id), action text NOT NULL, from_phase text, to_phase text,
 from_connection_id uuid, to_connection_id uuid, from_user_id uuid, to_user_id uuid,
 reason text NOT NULL DEFAULT '', version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(case_id,version)
);
CREATE INDEX wa_case_events_case_time ON public.wa_case_events(case_id,created_at);
CREATE INDEX wa_channel_grants_user ON public.wa_channel_grants(user_id,connection_id);

CREATE FUNCTION app_private.wa_channel_user(p_channel uuid,p_user uuid,p_manage boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p_user IS NOT NULL AND EXISTS(SELECT 1 FROM public.wa_connections c
 JOIN public.workspace_members w ON w.workspace_id=c.workspace_id AND w.user_id=p_user AND w.active
 JOIN auth.users u ON u.id=p_user AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<now())
 WHERE c.id=p_channel AND c.activated_at IS NOT NULL AND
 ((c.owner_id=p_user AND app_private.member(c.workspace_id,c.sector_id,p_user)) OR EXISTS(
 SELECT 1 FROM public.wa_channel_grants g WHERE g.connection_id=c.id AND g.user_id=p_user AND (NOT p_manage OR g.can_manage))));
$$;
CREATE FUNCTION app_private.wa_case_user(p_case uuid,p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.wa_cases k WHERE k.id=p_case AND
 (app_private.wa_channel_user(k.connection_id,p_user) OR
 (k.assigned_to=p_user AND app_private.member(k.workspace_id,k.sector_id,p_user))));
$$;
CREATE FUNCTION public.wa_can_read_conversation(p_conversation uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.wa_conversations v WHERE v.id=p_conversation AND
 (app_private.wa_channel_user(v.connection_id,auth.uid()) OR EXISTS(
 SELECT 1 FROM public.wa_cases k WHERE k.conversation_id=v.id AND k.is_current AND app_private.wa_case_user(k.id,auth.uid()))));
$$;
-- Keep connection-wide Storage grants narrow; an assignment never grants a channel.
CREATE OR REPLACE FUNCTION public.wa_can_access(p_connection uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app_private.wa_channel_user(p_connection,auth.uid());
$$;
DROP POLICY wa_conversations_read ON public.wa_conversations;
CREATE POLICY wa_conversations_read ON public.wa_conversations FOR SELECT TO authenticated USING(public.wa_can_read_conversation(id));
DROP POLICY wa_messages_read ON public.wa_messages;
CREATE POLICY wa_messages_read ON public.wa_messages FOR SELECT TO authenticated USING(public.wa_can_read_conversation(conversation_id));

-- The trigger creates a manual triage record, never an AI job. The provider
-- message IDs and the original channel/conversation are not rewritten.
CREATE FUNCTION app_private.wa_create_case() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.wa_cases(workspace_id,sector_id,origin_connection_id,origin_conversation_id,connection_id,conversation_id,phase)
 SELECT c.workspace_id,c.sector_id,c.id,NEW.id,c.id,NEW.id,CASE NEW.status WHEN 'resolved' THEN 'resolved' WHEN 'pending' THEN 'pending' ELSE 'triage' END
 FROM public.wa_connections c WHERE c.id=NEW.connection_id AND c.activated_at IS NOT NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER wa_conversation_case AFTER INSERT ON public.wa_conversations FOR EACH ROW EXECUTE FUNCTION app_private.wa_create_case();
INSERT INTO public.wa_cases(workspace_id,sector_id,origin_connection_id,origin_conversation_id,connection_id,conversation_id,phase)
 SELECT c.workspace_id,c.sector_id,c.id,v.id,c.id,v.id,CASE v.status WHEN 'resolved' THEN 'resolved' WHEN 'pending' THEN 'pending' ELSE 'triage' END
 FROM public.wa_conversations v JOIN public.wa_connections c ON c.id=v.connection_id WHERE c.activated_at IS NOT NULL;

CREATE FUNCTION app_private.wa_inbox(p_workspace uuid,p_phase text,p_query text,p_selected uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH visible AS (SELECT k.*,v.name,v.preview,v.last_message_at,v.unread_count,v.remote_jid,c.state channel_state,
 s.name sector_name,coalesce(cp.full_name,'Canal autorizado') channel_label,coalesce(p.full_name,'Responsável') assignee_name,
 app_private.wa_channel_user(k.connection_id,auth.uid(),true) manager
 FROM public.wa_cases k JOIN public.wa_conversations v ON v.id=k.conversation_id
 JOIN public.wa_connections c ON c.id=k.connection_id JOIN public.task_sectors s ON s.id=k.sector_id
 LEFT JOIN public.profiles p ON p.id=k.assigned_to LEFT JOIN public.profiles cp ON cp.id=c.owner_id
 WHERE k.workspace_id=p_workspace AND k.is_current AND app_private.wa_case_user(k.id,auth.uid())),
 projected AS (SELECT conversation_id,phase,last_message_at,name,preview,jsonb_build_object('id',conversation_id,'connection_id',connection_id,'remote_jid',remote_jid,
 'name',name,'preview',preview,'last_message_at',last_message_at,'unread_count',unread_count,'status',phase,
 'case_id',id,'case_version',version,'assigned_to',assigned_to,'assignee_name',CASE WHEN assigned_to IS NOT NULL THEN assignee_name END,
 'claimed_by',claimed_by,'summary',summary,'request_type',request_type,'pending_reason',pending_reason,'triage_state',triage_state,
 'continuity_pending',continuity_pending,'needs_review',needs_review,'sector_name',sector_name,'channel_state',channel_state,'channel_label',channel_label,
 'can_claim',(claimed_by IS NULL OR claimed_by=auth.uid()) AND (assigned_to IS NULL OR assigned_to=auth.uid() OR manager),
 'can_manage',manager OR claimed_by=auth.uid() OR (claimed_by IS NULL AND (assigned_to IS NULL OR assigned_to=auth.uid())),
 'can_send',phase='active' AND claimed_by=auth.uid() AND app_private.wa_channel_user(connection_id,auth.uid())) item
 FROM visible), items AS (SELECT * FROM projected WHERE (p_phase IS NULL OR p_phase='all' OR phase=p_phase)
 AND (coalesce(p_query,'')='' OR name ILIKE '%'||left(p_query,200)||'%' OR preview ILIKE '%'||left(p_query,200)||'%')
 ORDER BY last_message_at DESC NULLS LAST,conversation_id LIMIT 250)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(item) FROM items),'[]'::jsonb),
 'selected',(SELECT item FROM projected WHERE conversation_id=p_selected),'counts',
 (SELECT jsonb_build_object('all',count(*),'triage',count(*) FILTER(WHERE phase='triage'),'active',count(*) FILTER(WHERE phase='active'),
 'pending',count(*) FILTER(WHERE phase='pending'),'resolved',count(*) FILTER(WHERE phase='resolved')) FROM visible));
$$;
CREATE FUNCTION public.wa_case_inbox(p_workspace uuid,p_phase text DEFAULT null,p_query text DEFAULT '',p_selected uuid DEFAULT null) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT app_private.wa_inbox(p_workspace,p_phase,p_query,p_selected); $$;

CREATE FUNCTION app_private.wa_case_change(p_case uuid,p_version integer,p_action text,p_reason text,p_target uuid,p_channel uuid,p_sector uuid,p_summary text,p_type text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k public.wa_cases; old public.wa_cases; dest public.wa_connections; cv uuid; manager boolean; BEGIN
 SELECT * INTO k FROM public.wa_cases WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR NOT k.is_current OR NOT app_private.wa_case_user(k.id,auth.uid()) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF k.version<>p_version THEN RAISE EXCEPTION 'CASE_CHANGED' USING ERRCODE='PT409';END IF;
 IF EXISTS(SELECT 1 FROM public.wa_outbox o WHERE o.conversation_id=k.conversation_id AND o.state IN('sending','uncertain')) THEN
 RAISE EXCEPTION 'SEND_UNCERTAIN' USING ERRCODE='PT409';END IF;
 old:=k; manager:=app_private.wa_channel_user(k.connection_id,auth.uid(),true);
 IF k.claimed_by IS NOT NULL AND k.claimed_by<>auth.uid() AND NOT manager THEN RAISE EXCEPTION 'CASE_CLAIMED' USING ERRCODE='PT409';END IF;
 IF k.assigned_to IS NOT NULL AND k.assigned_to<>auth.uid() AND NOT manager THEN RAISE EXCEPTION 'ASSIGNEE_ONLY' USING ERRCODE='42501';END IF;
 IF length(coalesce(p_reason,''))>1000 OR length(coalesce(p_summary,''))>6000 OR length(coalesce(p_type,''))>120 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';END IF;
 IF p_action='claim' THEN
   IF k.phase NOT IN('triage','pending') OR NOT app_private.wa_channel_user(k.connection_id,auth.uid()) THEN RAISE EXCEPTION 'CLAIM_UNAVAILABLE' USING ERRCODE='PT409';END IF;
   k.phase:='active';k.assigned_to:=auth.uid();k.claimed_by:=auth.uid();k.needs_review:=false;
 ELSIF p_action IN('pending','resolve','triage') THEN
   IF k.claimed_by IS DISTINCT FROM auth.uid() AND NOT manager THEN RAISE EXCEPTION 'CLAIM_REQUIRED' USING ERRCODE='42501';END IF;
   IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE='22023';END IF;
   IF p_action='pending' AND k.phase<>'active' THEN RAISE EXCEPTION 'CLAIM_REQUIRED' USING ERRCODE='PT409';END IF;
   k.phase:=CASE p_action WHEN 'pending' THEN 'pending' WHEN 'resolve' THEN 'resolved' ELSE 'triage' END;
   k.pending_reason:=p_reason;
   IF p_action='triage' THEN k.claimed_by:=null;k.triage_state:='manual';END IF;
 ELSIF p_action='transfer' THEN
   IF length(btrim(coalesce(p_reason,'')))<3 OR length(btrim(coalesce(p_summary,'')))<3 OR length(btrim(coalesce(p_type,'')))<2 THEN RAISE EXCEPTION 'TRANSFER_CONTEXT_REQUIRED' USING ERRCODE='22023';END IF;
   SELECT * INTO dest FROM public.wa_connections WHERE id=p_channel AND workspace_id=k.workspace_id AND activated_at IS NOT NULL;
   IF NOT FOUND OR NOT app_private.member(k.workspace_id,p_sector,p_target) OR NOT app_private.wa_channel_user(dest.id,p_target)
    OR NOT app_private.wa_channel_user(dest.id,auth.uid()) THEN RAISE EXCEPTION 'DESTINATION_FORBIDDEN' USING ERRCODE='42501';END IF;
   IF dest.id<>k.connection_id THEN
     IF dest.state<>'connected' THEN RAISE EXCEPTION 'DESTINATION_OFFLINE' USING ERRCODE='PT409';END IF;
     -- Never merge a second existing request merely because the phone matches.
     SELECT v.id INTO cv FROM public.wa_conversations v JOIN public.wa_conversations original ON original.id=k.conversation_id
      WHERE v.connection_id=dest.id AND v.remote_jid=original.remote_jid;
     IF cv IS NOT NULL THEN RAISE EXCEPTION 'DESTINATION_HAS_CONVERSATION' USING ERRCODE='PT409';END IF;
     INSERT INTO public.wa_conversations(connection_id,remote_jid,name)
      SELECT dest.id,remote_jid,name FROM public.wa_conversations WHERE id=k.conversation_id RETURNING id INTO cv;
     -- Suppress only the empty manual case created by the INSERT trigger.
     DELETE FROM public.wa_cases WHERE conversation_id=cv AND origin_conversation_id=cv;
     k.connection_id:=dest.id;k.conversation_id:=cv;k.continuity_pending:=true;
   END IF;
   k.sector_id:=p_sector;k.assigned_to:=p_target;k.claimed_by:=null;k.phase:='triage';k.triage_state:='ready';
   k.summary:=p_summary;k.request_type:=p_type;k.pending_reason:=p_reason;
 ELSIF p_action='new' THEN
   IF k.phase<>'resolved' OR length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE='22023';END IF;
   UPDATE public.wa_cases SET is_current=false,updated_at=now(),version=version+1 WHERE id=k.id;
   INSERT INTO public.wa_case_events(case_id,actor_id,action,from_phase,to_phase,reason,version)
    VALUES(k.id,auth.uid(),'new','resolved','resolved',p_reason,k.version+1);
   INSERT INTO public.wa_cases(workspace_id,sector_id,origin_connection_id,origin_conversation_id,connection_id,conversation_id)
    VALUES(k.workspace_id,k.sector_id,k.connection_id,k.conversation_id,k.connection_id,k.conversation_id) RETURNING id INTO cv;
   RETURN jsonb_build_object('saved',true,'caseId',cv,'version',1);
 ELSIF p_action='reopen' THEN
   IF k.phase<>'resolved' OR length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE='22023';END IF;
   k.phase:='triage';k.claimed_by:=null;k.triage_state:='manual';k.pending_reason:=p_reason;k.needs_review:=false;
 ELSE RAISE EXCEPTION 'INVALID_ACTION' USING ERRCODE='22023';END IF;
 k.version:=k.version+1;
 UPDATE public.wa_cases SET connection_id=k.connection_id,conversation_id=k.conversation_id,sector_id=k.sector_id,
 phase=k.phase,triage_state=k.triage_state,assigned_to=k.assigned_to,claimed_by=k.claimed_by,summary=k.summary,request_type=k.request_type,
 pending_reason=k.pending_reason,continuity_pending=k.continuity_pending,needs_review=k.needs_review,version=k.version,updated_at=now() WHERE id=k.id;
 INSERT INTO public.wa_case_events(case_id,actor_id,action,from_phase,to_phase,from_connection_id,to_connection_id,from_user_id,to_user_id,reason,version)
 VALUES(k.id,auth.uid(),p_action,old.phase,k.phase,old.connection_id,k.connection_id,old.assigned_to,k.assigned_to,p_reason,k.version);
 RETURN jsonb_build_object('saved',true,'caseId',k.id,'version',k.version,'continuityPending',k.continuity_pending);
END $$;
CREATE FUNCTION public.wa_case_change(p_case uuid,p_version integer,p_action text,p_reason text DEFAULT '',p_target uuid DEFAULT null,p_channel uuid DEFAULT null,p_sector uuid DEFAULT null,p_summary text DEFAULT '',p_type text DEFAULT '') RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT app_private.wa_case_change(p_case,p_version,p_action,p_reason,p_target,p_channel,p_sector,p_summary,p_type); $$;

CREATE FUNCTION app_private.wa_transfer_options(p_case uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k public.wa_cases; BEGIN
 SELECT * INTO k FROM public.wa_cases WHERE id=p_case;
 IF NOT FOUND OR NOT app_private.wa_case_user(k.id,auth.uid()) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('userId',m.user_id,'name',coalesce(p.full_name,'Atendente'),
 'sectorId',s.id,'sector',s.name,'channelId',c.id,'channelOwner',coalesce(cp.full_name,'Canal'), 'connected',c.state='connected'))
 FROM public.wa_connections c JOIN public.task_sector_members m ON m.workspace_id=c.workspace_id
 JOIN public.task_sectors s ON s.id=m.sector_id AND s.workspace_id=c.workspace_id
 LEFT JOIN public.profiles p ON p.id=m.user_id LEFT JOIN public.profiles cp ON cp.id=c.owner_id
 WHERE c.workspace_id=k.workspace_id AND app_private.wa_channel_user(c.id,auth.uid()) AND
 app_private.member(c.workspace_id,s.id,m.user_id) AND app_private.wa_channel_user(c.id,m.user_id)), '[]'::jsonb);
END $$;
CREATE FUNCTION public.wa_case_destinations(p_case uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT app_private.wa_transfer_options(p_case); $$;
CREATE FUNCTION public.wa_case_history(p_case uuid) RETURNS SETOF public.wa_case_events LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT * FROM public.wa_case_events WHERE case_id=p_case ORDER BY created_at DESC LIMIT 30; $$;

CREATE FUNCTION app_private.wa_send_begin(p_conversation uuid,p_request uuid,p_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k public.wa_cases;BEGIN
 SELECT * INTO k FROM public.wa_cases WHERE conversation_id=p_conversation AND is_current FOR UPDATE;
 IF NOT FOUND OR NOT app_private.wa_case_user(k.id,auth.uid()) OR k.claimed_by IS DISTINCT FROM auth.uid()
 OR k.phase<>'active' OR NOT app_private.wa_channel_user(k.connection_id,auth.uid()) THEN
 RAISE EXCEPTION 'CLAIM_REQUIRED' USING ERRCODE='42501';END IF;
 INSERT INTO public.wa_outbox(connection_id,conversation_id,request_id,payload_hash)
 VALUES(k.connection_id,k.conversation_id,p_request,p_hash) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
CREATE FUNCTION public.wa_case_send_begin(p_conversation uuid,p_request uuid,p_hash text) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT app_private.wa_send_begin(p_conversation,p_request,p_hash); $$;

CREATE FUNCTION app_private.wa_continuity_sent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.state='sent' AND NEW.provider_id IS NOT NULL THEN
 UPDATE public.wa_cases SET continuity_pending=false,updated_at=now() WHERE conversation_id=NEW.conversation_id AND is_current AND continuity_pending;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER wa_continuity_sent AFTER UPDATE ON public.wa_outbox FOR EACH ROW EXECUTE FUNCTION app_private.wa_continuity_sent();
CREATE FUNCTION app_private.wa_resolved_incoming() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT NEW.from_me THEN
 UPDATE public.wa_cases SET needs_review=true,version=version+1 WHERE conversation_id=NEW.conversation_id AND is_current
 AND phase='resolved' AND NEW.sent_at>updated_at AND NOT needs_review;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER wa_resolved_incoming AFTER INSERT ON public.wa_messages FOR EACH ROW EXECUTE FUNCTION app_private.wa_resolved_incoming();

CREATE FUNCTION app_private.wa_channel_config(p_channel uuid,p_user uuid,p_manage boolean,p_remove boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.wa_connections;BEGIN
 SELECT * INTO c FROM public.wa_connections WHERE id=p_channel;
 IF NOT FOUND OR c.owner_id IS DISTINCT FROM auth.uid() OR NOT app_private.wa_channel_user(c.id,auth.uid(),true) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members w JOIN auth.users u ON u.id=w.user_id
 WHERE w.workspace_id=c.workspace_id AND w.user_id=p_user AND w.active AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<now())) THEN
 RAISE EXCEPTION 'WORKSPACE_MEMBER_REQUIRED' USING ERRCODE='42501';END IF;
 IF p_remove THEN DELETE FROM public.wa_channel_grants WHERE connection_id=c.id AND user_id=p_user;
 ELSE INSERT INTO public.wa_channel_grants(connection_id,user_id,can_manage,granted_by) VALUES(c.id,p_user,p_manage,auth.uid())
 ON CONFLICT(connection_id,user_id) DO UPDATE SET can_manage=excluded.can_manage,granted_by=excluded.granted_by;END IF;
END $$;
CREATE FUNCTION public.wa_channel_config(p_channel uuid,p_user uuid,p_manage boolean DEFAULT false,p_remove boolean DEFAULT false) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT app_private.wa_channel_config(p_channel,p_user,p_manage,p_remove); $$;
CREATE FUNCTION app_private.wa_channel_settings() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'label',coalesce(p.full_name,'Meu canal'),'state',c.state,'workspaceId',c.workspace_id,
 'members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(pr.full_name,u.email),'email',u.email,
 'granted',g.user_id IS NOT NULL,'canManage',coalesce(g.can_manage,false))) FROM public.workspace_members w
 JOIN auth.users u ON u.id=w.user_id AND u.email_confirmed_at IS NOT NULL
 LEFT JOIN public.profiles pr ON pr.id=u.id LEFT JOIN public.wa_channel_grants g ON g.user_id=u.id AND g.connection_id=c.id
 WHERE w.workspace_id=c.workspace_id AND w.active AND u.id<>auth.uid()),'[]'::jsonb))), '[]'::jsonb)
 FROM public.wa_connections c LEFT JOIN public.profiles p ON p.id=c.owner_id
 WHERE c.owner_id=auth.uid() AND app_private.wa_channel_user(c.id,auth.uid(),true);
$$;
CREATE FUNCTION public.wa_channel_settings() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT app_private.wa_channel_settings(); $$;

DO $$ DECLARE t text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['wa_channel_grants','wa_cases','wa_case_events'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t); END LOOP;
 FOR f IN SELECT oid::regprocedure sig,pronamespace::regnamespace::text ns,proname FROM pg_proc
 WHERE (pronamespace='app_private'::regnamespace AND proname LIKE 'wa_%') OR
 (pronamespace='public'::regnamespace AND proname IN('wa_case_inbox','wa_case_change','wa_case_destinations','wa_case_history','wa_case_send_begin','wa_channel_config','wa_channel_settings','wa_can_read_conversation')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
 IF f.proname NOT IN('wa_create_case','wa_continuity_sent','wa_resolved_incoming') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f.sig);END IF;END LOOP;
END $$;
GRANT SELECT ON public.wa_cases,public.wa_case_events TO authenticated;
GRANT USAGE ON SCHEMA app_private TO authenticated,service_role;
CREATE POLICY wa_cases_read ON public.wa_cases FOR SELECT TO authenticated USING(app_private.wa_case_user(id,auth.uid()));
CREATE POLICY wa_case_events_read ON public.wa_case_events FOR SELECT TO authenticated USING(app_private.wa_case_user(case_id,auth.uid()));
NOTIFY pgrst,'reload schema';
