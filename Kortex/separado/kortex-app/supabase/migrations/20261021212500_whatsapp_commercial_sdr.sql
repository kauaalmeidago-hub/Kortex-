-- Explicit channel roles. Human channels never inherit automatic replies.
ALTER TABLE public.wa_connections ADD COLUMN channel_label text CHECK(length(channel_label) BETWEEN 1 AND 100),
 ADD COLUMN channel_role text NOT NULL DEFAULT 'human' CHECK(channel_role IN('human','sdr')),
 ADD COLUMN sort_order integer NOT NULL DEFAULT 100 CHECK(sort_order BETWEEN 0 AND 1000);
CREATE UNIQUE INDEX wa_primary_sdr ON public.wa_connections(workspace_id,sector_id) WHERE channel_role='sdr' AND activated_at IS NOT NULL;
CREATE TABLE public.wa_sdr_settings (
 connection_id uuid PRIMARY KEY REFERENCES public.wa_connections(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id), handoff_user_id uuid NOT NULL REFERENCES auth.users(id),
 enabled boolean NOT NULL DEFAULT false, activated_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.wa_sdr_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL UNIQUE REFERENCES public.wa_cases(id),
 source_id uuid NOT NULL REFERENCES public.wa_messages(id), generation integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','processing','dispatching','done','failed')),
 available_at timestamptz NOT NULL DEFAULT now()+interval '5 seconds',
 token uuid, lease_until timestamptz, case_version integer, request_id uuid,
 result jsonb, replies integer NOT NULL DEFAULT 0, last_code text, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wa_sdr_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_sdr_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_sdr_settings,public.wa_sdr_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.wa_sdr_settings,public.wa_sdr_jobs TO service_role;

CREATE FUNCTION app_private.wa_sdr_incoming() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k public.wa_cases;s public.wa_sdr_settings;BEGIN
 IF NEW.from_me OR NEW.remote_jid LIKE '%@g.us' THEN RETURN NEW;END IF;
 SELECT * INTO s FROM public.wa_sdr_settings WHERE connection_id=NEW.connection_id AND enabled;
 IF NOT FOUND OR NEW.sent_at<s.activated_at OR NEW.created_at<s.activated_at THEN RETURN NEW;END IF;
 SELECT * INTO k FROM public.wa_cases WHERE conversation_id=NEW.conversation_id AND is_current;
 IF NOT FOUND OR k.phase<>'triage' OR k.claimed_by IS NOT NULL OR k.assigned_to IS NOT NULL OR k.triage_state='ready' THEN RETURN NEW;END IF;
 INSERT INTO public.wa_sdr_jobs(case_id,source_id) VALUES(k.id,NEW.id)
 ON CONFLICT(case_id) DO UPDATE SET source_id=NEW.id,generation=wa_sdr_jobs.generation+1,state='queued',
 available_at=now()+interval '5 seconds',updated_at=now();
 RETURN NEW;
END $$;
CREATE TRIGGER wa_sdr_incoming AFTER INSERT ON public.wa_messages FOR EACH ROW EXECUTE FUNCTION app_private.wa_sdr_incoming();

CREATE FUNCTION app_private.wa_sdr_valid(p_job uuid,p_token uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.wa_sdr_jobs j JOIN public.wa_cases k ON k.id=j.case_id
 JOIN public.wa_sdr_settings s ON s.connection_id=k.connection_id
 JOIN public.wa_connections c ON c.id=s.connection_id
 WHERE j.id=p_job AND j.token=p_token AND j.state IN('processing','dispatching') AND j.lease_until>now()
 AND k.is_current AND k.phase='triage' AND k.claimed_by IS NULL AND k.assigned_to IS NULL AND k.version=j.case_version
 AND s.enabled AND c.channel_role='sdr' AND c.state='connected' AND c.owner_id=s.actor_id
 AND app_private.wa_channel_user(c.id,s.actor_id) AND app_private.wa_channel_user(c.id,s.handoff_user_id)
 AND app_private.member(k.workspace_id,k.sector_id,s.handoff_user_id)
 AND NOT EXISTS(SELECT 1 FROM public.wa_outbox o WHERE o.conversation_id=k.conversation_id AND o.state IN('sending','uncertain')));
$$;
CREATE FUNCTION public.wa_sdr_take(p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.wa_sdr_jobs;k public.wa_cases;s public.wa_sdr_settings;BEGIN
 IF p_token IS NULL THEN RAISE EXCEPTION 'TOKEN_REQUIRED';END IF;
 -- Abandoned inference/dispatch is handed to a human, never replayed automatically.
 WITH expired AS (UPDATE public.wa_sdr_jobs SET state='failed',last_code='LEASE_EXPIRED',updated_at=now()
 WHERE state IN('processing','dispatching') AND lease_until<now() RETURNING case_id,request_id)
 UPDATE public.wa_cases expired_case SET triage_state='ready',assigned_to=expired_settings.handoff_user_id,
 pending_reason='A triagem automática foi interrompida. Confira a última mensagem antes de responder.',version=version+1,updated_at=now()
 FROM expired e,public.wa_sdr_settings expired_settings WHERE expired_case.id=e.case_id AND expired_settings.connection_id=expired_case.connection_id
 AND expired_case.phase='triage' AND expired_case.claimed_by IS NULL AND expired_case.assigned_to IS NULL;
 UPDATE public.wa_outbox o SET state='uncertain' FROM public.wa_sdr_jobs expired_job
 WHERE expired_job.state='failed' AND expired_job.last_code='LEASE_EXPIRED' AND o.request_id=expired_job.request_id AND o.state='sending';
 SELECT job.* INTO j FROM public.wa_sdr_jobs job JOIN public.wa_cases kc ON kc.id=job.case_id
 JOIN public.wa_sdr_settings sc ON sc.connection_id=kc.connection_id
 JOIN public.wa_connections c ON c.id=sc.connection_id
 WHERE job.state='queued' AND job.available_at<=now() AND sc.enabled AND c.state='connected'
 AND kc.phase='triage' AND kc.is_current AND kc.claimed_by IS NULL AND kc.assigned_to IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.wa_outbox o WHERE o.conversation_id=kc.conversation_id AND o.state IN('sending','uncertain'))
 ORDER BY job.available_at FOR UPDATE OF job SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO k FROM public.wa_cases WHERE id=j.case_id FOR UPDATE;
 SELECT * INTO s FROM public.wa_sdr_settings WHERE connection_id=k.connection_id;
 UPDATE public.wa_sdr_jobs SET state='processing',token=p_token,lease_until=now()+interval '90 seconds',
 case_version=k.version,request_id=gen_random_uuid(),result=NULL,updated_at=now() WHERE id=j.id RETURNING * INTO j;
 IF NOT app_private.wa_sdr_valid(j.id,p_token) THEN UPDATE public.wa_sdr_jobs SET state='failed',last_code='ACCESS_CHANGED' WHERE id=j.id;RETURN NULL;END IF;
 RETURN to_jsonb(j)||jsonb_build_object('connectionId',k.connection_id,'conversationId',k.conversation_id,
 'caseCreatedAt',k.created_at,'activatedAt',s.activated_at,'actorId',s.actor_id,'workspaceId',k.workspace_id);
END $$;
CREATE FUNCTION public.wa_sdr_plan(p_job uuid,p_token uuid,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.wa_sdr_jobs;k public.wa_cases;s public.wa_sdr_settings;BEGIN
 SELECT * INTO j FROM public.wa_sdr_jobs WHERE id=p_job FOR UPDATE;
 SELECT * INTO k FROM public.wa_cases WHERE id=j.case_id FOR UPDATE;
 IF NOT app_private.wa_sdr_valid(p_job,p_token) THEN RETURN false;END IF;
 IF p_result->>'action' NOT IN('ask','handoff') OR length(coalesce(p_result->>'summary','')) NOT BETWEEN 3 AND 6000
 OR length(coalesce(p_result->>'reply',''))>1500 THEN RAISE EXCEPTION 'INVALID_SDR_RESULT';END IF;
 UPDATE public.wa_sdr_jobs SET result=p_result WHERE id=p_job AND token=p_token;
 IF p_result->>'action'='handoff' THEN
 SELECT * INTO s FROM public.wa_sdr_settings WHERE connection_id=k.connection_id;
 UPDATE public.wa_cases SET summary=p_result->>'summary',request_type=left(p_result->>'request_type',120),
 triage_state='ready',assigned_to=s.handoff_user_id,version=version+1,updated_at=now() WHERE id=k.id;
 INSERT INTO public.wa_case_events(case_id,actor_id,action,from_phase,to_phase,to_user_id,reason,version)
 VALUES(k.id,s.actor_id,'sdr_handoff','triage','triage',s.handoff_user_id,'Qualificação preparada para revisão humana.',k.version+1);
 UPDATE public.wa_sdr_jobs SET state='done' WHERE id=p_job AND token=p_token;
 END IF;RETURN true;
END $$;
CREATE FUNCTION public.wa_sdr_reserve(p_job uuid,p_token uuid,p_request uuid,p_hash text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.wa_sdr_jobs;k public.wa_cases;BEGIN
 SELECT * INTO j FROM public.wa_sdr_jobs WHERE id=p_job FOR UPDATE;
 SELECT * INTO k FROM public.wa_cases WHERE id=j.case_id FOR UPDATE;
 IF NOT app_private.wa_sdr_valid(p_job,p_token) OR j.state<>'processing' OR j.result->>'action'<>'ask' OR j.request_id<>p_request THEN RETURN false;END IF;
 INSERT INTO public.wa_outbox(connection_id,conversation_id,request_id,payload_hash) VALUES(k.connection_id,k.conversation_id,p_request,p_hash) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false;END IF;
 UPDATE public.wa_sdr_jobs SET state='dispatching' WHERE id=p_job AND token=p_token;RETURN true;
END $$;
CREATE FUNCTION public.wa_sdr_complete(p_job uuid,p_token uuid,p_ok boolean,p_code text DEFAULT '') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.wa_sdr_jobs;k public.wa_cases;s public.wa_sdr_settings;BEGIN
 SELECT * INTO j FROM public.wa_sdr_jobs WHERE id=p_job AND token=p_token FOR UPDATE;
 IF NOT FOUND OR j.state NOT IN('processing','dispatching','queued') THEN RETURN;END IF;
 SELECT * INTO k FROM public.wa_cases WHERE id=j.case_id FOR UPDATE;
 SELECT * INTO s FROM public.wa_sdr_settings WHERE connection_id=k.connection_id;
 IF p_ok AND NOT EXISTS(SELECT 1 FROM public.wa_outbox WHERE request_id=j.request_id AND connection_id=k.connection_id AND state='sent' AND provider_id IS NOT NULL) THEN RAISE EXCEPTION 'SEND_NOT_CONFIRMED';END IF;
 UPDATE public.wa_sdr_jobs SET state=CASE WHEN NOT p_ok THEN 'failed' WHEN state='queued' THEN 'queued' ELSE 'done' END,last_code=left(p_code,80),
 replies=replies+CASE WHEN p_ok THEN 1 ELSE 0 END,updated_at=now() WHERE id=j.id;
 IF k.phase='triage' AND k.claimed_by IS NULL AND k.assigned_to IS NULL THEN
 UPDATE public.wa_cases SET summary=coalesce(j.result->>'summary',summary),
 triage_state=CASE WHEN p_ok THEN 'waiting_customer' ELSE 'ready' END,
 assigned_to=CASE WHEN p_ok THEN NULL ELSE s.handoff_user_id END,
 pending_reason=CASE WHEN p_ok THEN '' ELSE 'A triagem automática precisa de revisão humana.' END,
 version=version+1,updated_at=now() WHERE id=k.id;
 INSERT INTO public.wa_case_events(case_id,actor_id,action,from_phase,to_phase,reason,version)
 VALUES(k.id,s.actor_id,CASE WHEN p_ok THEN 'sdr_reply' ELSE 'sdr_error' END,'triage','triage',CASE WHEN p_ok THEN 'Pergunta de qualificação enviada e confirmada.' ELSE 'Falha encaminhada para revisão humana.' END,k.version+1);
 END IF;
END $$;
CREATE FUNCTION app_private.wa_sdr_mode(p_channel uuid,p_enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.wa_connections c JOIN public.wa_sdr_settings s ON s.connection_id=c.id
 WHERE c.id=p_channel AND c.owner_id=auth.uid() AND app_private.wa_channel_user(c.id,auth.uid(),true)) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
 UPDATE public.wa_sdr_settings SET enabled=p_enabled,activated_at=CASE WHEN p_enabled AND NOT enabled THEN now() ELSE activated_at END,updated_at=now() WHERE connection_id=p_channel;
END $$;
CREATE FUNCTION public.wa_sdr_mode(p_channel uuid,p_enabled boolean) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT app_private.wa_sdr_mode(p_channel,p_enabled); $$;

-- Preserve all access predicates while presenting the configured channel name/order.
DO $$ DECLARE definition text;name text;BEGIN
 FOREACH name IN ARRAY ARRAY['wa_inbox','wa_transfer_options','wa_channel_settings'] LOOP
 SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app_private' AND p.proname=name;
 IF definition IS NULL THEN RAISE EXCEPTION 'CASE_FUNCTION_REQUIRED';END IF;
 definition:=replace(definition,'coalesce(cp.full_name,''Canal autorizado'')','coalesce(c.channel_label,cp.full_name,''Canal autorizado'')');
 definition:=replace(definition,'coalesce(cp.full_name,''Canal'')','coalesce(c.channel_label,cp.full_name,''Canal'')');
 definition:=replace(definition,'''connected'',c.state=''connected''','''sortOrder'',c.sort_order,''role'',c.channel_role,''connected'',c.state=''connected''');
 definition:=replace(definition,'coalesce(p.full_name,''Meu canal'')','coalesce(c.channel_label,p.full_name,''Meu canal'')');
 IF name='wa_channel_settings' THEN
 definition:=replace(definition,'''state'',c.state,''workspaceId'',c.workspace_id,','''state'',c.state,''workspaceId'',c.workspace_id,''role'',c.channel_role,''sortOrder'',c.sort_order,''sdrEnabled'',coalesce((SELECT s.enabled FROM public.wa_sdr_settings s WHERE s.connection_id=c.id),false),');
 END IF;
 EXECUTE definition;
 END LOOP;
END $$;
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure sig,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname LIKE 'wa_sdr_%' AND n.nspname IN('public','app_private') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
 IF f.proname='wa_sdr_mode' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.sig);END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
