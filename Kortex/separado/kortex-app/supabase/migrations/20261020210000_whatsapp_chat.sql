-- Atendimento WhatsApp: separate from task_messages and the administrative KOA.
CREATE TABLE public.wa_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 workspace_id uuid REFERENCES public.workspaces(id), sector_id uuid REFERENCES public.task_sectors(id),
 instance_name text NOT NULL UNIQUE, activated_at timestamptz, onboarding_required boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'preparing' CHECK(state IN ('preparing','qr','connecting','connected','expired','disconnected','error')),
 phone_jid text, qr_data text, qr_expires_at timestamptz, provider_updated_at timestamptz,
 sync_page integer NOT NULL DEFAULT 1, sync_state text NOT NULL DEFAULT 'pending',
 lease_until timestamptz, lease_token uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,workspace_id,sector_id),
 FOREIGN KEY(workspace_id,sector_id) REFERENCES public.task_sectors(workspace_id,id),
 CHECK(activated_at IS NULL OR (workspace_id IS NOT NULL AND sector_id IS NOT NULL))
);
CREATE UNIQUE INDEX wa_pending_owner ON public.wa_connections(owner_id) WHERE activated_at IS NULL;
CREATE UNIQUE INDEX wa_phone_binding ON public.wa_connections(phone_jid) WHERE phone_jid IS NOT NULL AND state='connected';
CREATE TABLE public.wa_onboarding (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.wa_rate_limits (key text PRIMARY KEY, hits integer NOT NULL, window_at timestamptz NOT NULL);
CREATE TABLE public.wa_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES public.wa_connections(id) ON DELETE CASCADE,
 remote_jid text NOT NULL, name text NOT NULL, preview text NOT NULL DEFAULT '', last_message_at timestamptz,
 unread_count integer NOT NULL DEFAULT 0, last_read_at timestamptz, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','resolved')),
 UNIQUE(connection_id,remote_jid), UNIQUE(connection_id,id)
);
CREATE TABLE public.wa_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES public.wa_connections(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL, provider_id text NOT NULL, remote_jid text NOT NULL, participant text,
 from_me boolean NOT NULL DEFAULT false, body text NOT NULL DEFAULT '', kind text NOT NULL DEFAULT 'text',
 sent_at timestamptz NOT NULL, status_rank integer NOT NULL DEFAULT 0 CHECK(status_rank BETWEEN 0 AND 4),
 quoted_id text, media_name text, media_mime text, media_size bigint, storage_path text,
 provider_key jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,provider_id), UNIQUE(connection_id,id),
 FOREIGN KEY(connection_id,conversation_id) REFERENCES public.wa_conversations(connection_id,id) ON DELETE CASCADE
);
CREATE INDEX wa_messages_timeline ON public.wa_messages(conversation_id,sent_at DESC,id DESC);
CREATE TABLE public.wa_events (
 connection_id uuid NOT NULL REFERENCES public.wa_connections(id) ON DELETE CASCADE, event_hash text NOT NULL,
 event_type text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 PRIMARY KEY(connection_id,event_hash)
);
CREATE TABLE public.wa_message_receipts (
 connection_id uuid NOT NULL REFERENCES public.wa_connections(id) ON DELETE CASCADE, provider_id text NOT NULL,
 status_rank integer NOT NULL, PRIMARY KEY(connection_id,provider_id)
);
CREATE TABLE public.wa_outbox (
 connection_id uuid NOT NULL REFERENCES public.wa_connections(id) ON DELETE CASCADE, request_id uuid NOT NULL,
 conversation_id uuid NOT NULL, payload_hash text NOT NULL, state text NOT NULL DEFAULT 'sending',
 provider_id text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(connection_id,request_id),
 FOREIGN KEY(connection_id,conversation_id) REFERENCES public.wa_conversations(connection_id,id)
);

CREATE FUNCTION public.wa_can_access(p_connection uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.wa_connections c JOIN auth.users u ON u.id=c.owner_id
 WHERE c.id=p_connection AND c.owner_id=auth.uid() AND c.activated_at IS NOT NULL
 AND u.email_confirmed_at IS NOT NULL AND app_private.member(c.workspace_id,c.sector_id,auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.wa_can_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wa_can_access(uuid) TO authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['wa_connections','wa_onboarding','wa_rate_limits','wa_conversations','wa_messages','wa_events','wa_outbox','wa_message_receipts'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
-- QR and tokens have no direct browser table access. Authorized API returns a projection.
GRANT SELECT ON public.wa_conversations,public.wa_messages TO authenticated;
CREATE POLICY wa_conversations_read ON public.wa_conversations FOR SELECT TO authenticated USING(public.wa_can_access(connection_id));
CREATE POLICY wa_messages_read ON public.wa_messages FOR SELECT TO authenticated USING(public.wa_can_access(connection_id));

CREATE FUNCTION public.wa_rate_limit(p_key text,p_max integer,p_seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE n integer;BEGIN
 INSERT INTO public.wa_rate_limits(key,hits,window_at) VALUES(p_key,1,now()) ON CONFLICT(key) DO UPDATE
 SET hits=CASE WHEN wa_rate_limits.window_at<now()-make_interval(secs=>p_seconds) THEN 1 ELSE wa_rate_limits.hits+1 END,
 window_at=CASE WHEN wa_rate_limits.window_at<now()-make_interval(secs=>p_seconds) THEN now() ELSE wa_rate_limits.window_at END RETURNING hits INTO n;
 RETURN n<=p_max;
END $$;
CREATE FUNCTION public.wa_ingest(p_connection uuid,p_hash text,p_type text,p_messages jsonb DEFAULT '[]',p_receipts jsonb DEFAULT '[]',p_chats jsonb DEFAULT '[]') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m jsonb;r jsonb;cv uuid;inserted uuid;ts timestamptz;BEGIN
 INSERT INTO public.wa_events(connection_id,event_hash,event_type) VALUES(p_connection,p_hash,p_type) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN; END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(p_chats) LOOP
 INSERT INTO public.wa_conversations(connection_id,remote_jid,name) VALUES(p_connection,m->>'remote_jid',coalesce(nullif(m->>'name',''),m->>'remote_jid'))
 ON CONFLICT(connection_id,remote_jid) DO UPDATE SET name=coalesce(nullif(m->>'name',''),wa_conversations.name);
 END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(p_receipts) LOOP
 INSERT INTO public.wa_message_receipts(connection_id,provider_id,status_rank) VALUES(p_connection,r->>'id',(r->>'rank')::integer)
 ON CONFLICT(connection_id,provider_id) DO UPDATE SET status_rank=greatest(wa_message_receipts.status_rank,excluded.status_rank);
 UPDATE public.wa_messages SET status_rank=greatest(status_rank,(r->>'rank')::integer) WHERE connection_id=p_connection AND provider_id=r->>'id';
 END LOOP;
 FOR m IN SELECT value FROM jsonb_array_elements(p_messages) LOOP
 ts:=(m->>'sent_at')::timestamptz;
 INSERT INTO public.wa_conversations(connection_id,remote_jid,name) VALUES(p_connection,m->>'remote_jid',coalesce(nullif(m->>'name',''),m->>'remote_jid'))
 ON CONFLICT(connection_id,remote_jid) DO UPDATE SET name=CASE WHEN excluded.name<>excluded.remote_jid THEN excluded.name ELSE wa_conversations.name END RETURNING id INTO cv;
 inserted:=NULL;
 INSERT INTO public.wa_messages(connection_id,conversation_id,provider_id,remote_jid,participant,from_me,body,kind,sent_at,status_rank,quoted_id,media_name,media_mime,media_size,provider_key)
 VALUES(p_connection,cv,m->>'provider_id',m->>'remote_jid',m->>'participant',(m->>'from_me')::boolean,coalesce(m->>'body',''),m->>'kind',ts,
 greatest(coalesce((m->>'status_rank')::integer,0),coalesce((SELECT status_rank FROM public.wa_message_receipts WHERE connection_id=p_connection AND provider_id=m->>'provider_id'),0)),
 m->>'quoted_id',m->>'media_name',m->>'media_mime',(m->>'media_size')::bigint,coalesce(m->'provider_key','{}'))
 ON CONFLICT(connection_id,provider_id) DO UPDATE SET status_rank=greatest(wa_messages.status_rank,excluded.status_rank) RETURNING CASE WHEN xmax=0 THEN id END INTO inserted;
 UPDATE public.wa_conversations SET
 preview=CASE WHEN last_message_at IS NULL OR ts>=last_message_at THEN coalesce(nullif(m->>'body',''),m->>'kind') ELSE preview END,
 last_message_at=greatest(last_message_at,ts),
 unread_count=unread_count+CASE WHEN inserted IS NOT NULL AND NOT (m->>'from_me')::boolean AND (last_read_at IS NULL OR ts>last_read_at) THEN 1 ELSE 0 END WHERE id=cv;
 -- Reconcile both webhook-before-response and response-before-webhook without duplicate bubbles.
 UPDATE public.wa_outbox SET state='sent' WHERE connection_id=p_connection AND provider_id=m->>'provider_id';
 END LOOP;
 UPDATE public.wa_events SET processed_at=now() WHERE connection_id=p_connection AND event_hash=p_hash;
END $$;
CREATE FUNCTION public.wa_claim(p_id uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 UPDATE public.wa_connections SET lease_token=p_token,lease_until=now()+interval '45 seconds' WHERE id=p_id AND (lease_until IS NULL OR lease_until<now());RETURN FOUND;
END $$;
CREATE FUNCTION public.wa_activate(p_user uuid,p_workspace uuid,p_sector uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE c uuid;BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL) OR NOT app_private.member(p_workspace,p_sector,p_user)
 THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,42));
 SELECT id INTO c FROM public.wa_connections WHERE owner_id=p_user AND workspace_id=p_workspace AND sector_id=p_sector AND activated_at IS NOT NULL;
 IF c IS NULL THEN
 SELECT id INTO c FROM public.wa_connections WHERE owner_id=p_user AND activated_at IS NULL FOR UPDATE;
 IF c IS NOT NULL THEN UPDATE public.wa_connections SET workspace_id=p_workspace,sector_id=p_sector,activated_at=now() WHERE id=c;
 ELSE INSERT INTO public.wa_connections(owner_id,workspace_id,sector_id,instance_name,activated_at)
 VALUES(p_user,p_workspace,p_sector,'koa-'||replace(gen_random_uuid()::text,'-',''),now()) RETURNING id INTO c; END IF;
 END IF;
 UPDATE public.wa_onboarding SET revoked_at=now() WHERE user_id=p_user AND revoked_at IS NULL;
 RETURN c;
END $$;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('wa_rate_limit','wa_ingest','wa_claim','wa_activate') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);END LOOP;END $$;

INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('whatsapp-private','whatsapp-private',false,20971520);
CREATE POLICY wa_media_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='whatsapp-private' AND public.wa_can_access((storage.foldername(name))[1]::uuid));
CREATE POLICY wa_media_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='whatsapp-private' AND (storage.foldername(name))[2]=auth.uid()::text AND public.wa_can_access((storage.foldername(name))[1]::uuid));
-- Recovery/import is server-driven; never depend on a browser interval to persist webhooks.
NOTIFY pgrst,'reload schema';
