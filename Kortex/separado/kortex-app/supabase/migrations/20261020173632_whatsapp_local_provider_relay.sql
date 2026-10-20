-- Independent from wa_connections so fresh databases can apply this migration
-- before the existing later-timestamped WhatsApp migrations.
CREATE TABLE public.wa_provider_workers (
 id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 state text NOT NULL CHECK (state IN ('ready','offline')),
 version text NOT NULL,
 last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.wa_provider_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 worker_id text NOT NULL CHECK (worker_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 path text NOT NULL CHECK (length(path) < 500),
 method text NOT NULL CHECK (method IN ('GET','POST','DELETE')),
 body jsonb,
 safe_retry boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','succeeded','failed','uncertain','canceled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 seconds',
 lease_token uuid,
 lease_until timestamptz,
 dispatched_at timestamptz,
 response jsonb,
 result_path text,
 error_status integer,
 error_code text
);
ALTER TABLE public.wa_provider_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_provider_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_provider_workers,public.wa_provider_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.wa_provider_workers,public.wa_provider_jobs TO service_role;
CREATE INDEX wa_provider_pending ON public.wa_provider_jobs(worker_id,created_at,id) WHERE state='queued';
CREATE INDEX wa_provider_processing ON public.wa_provider_jobs(worker_id,lease_until) WHERE state='processing';
CREATE INDEX wa_provider_cleanup ON public.wa_provider_jobs(worker_id,created_at) WHERE state IN ('succeeded','failed','uncertain','canceled');

CREATE FUNCTION public.wa_provider_heartbeat(p_worker text,p_state text,p_version text) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 INSERT INTO public.wa_provider_workers(id,state,version,last_seen_at)
 VALUES(p_worker,p_state,p_version,now())
 ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,version=EXCLUDED.version,last_seen_at=now();
$$;
CREATE FUNCTION public.wa_provider_claim(p_worker text,p_token uuid,p_limit integer DEFAULT 4)
RETURNS SETOF public.wa_provider_jobs
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF p_token IS NULL THEN RAISE EXCEPTION 'LEASE_REQUIRED'; END IF;
 -- Never replay an operation after a worker may have submitted it.
 UPDATE public.wa_provider_jobs SET state=CASE WHEN safe_retry THEN 'failed' ELSE 'uncertain' END,
 error_code='WORKER_LEASE_EXPIRED',error_status=503,body=NULL
 WHERE worker_id=p_worker AND state='processing' AND lease_until<now();
 UPDATE public.wa_provider_jobs SET state='canceled',body=NULL
 WHERE worker_id=p_worker AND state='queued' AND expires_at<=now();
 RETURN QUERY WITH picked AS (
   SELECT id FROM public.wa_provider_jobs WHERE worker_id=p_worker AND state='queued' AND expires_at>now()
   ORDER BY created_at,id LIMIT least(greatest(coalesce(p_limit,4),1),4) FOR UPDATE SKIP LOCKED
 )
 UPDATE public.wa_provider_jobs j SET state='processing',lease_token=p_token,lease_until=now()+interval '60 seconds'
 FROM picked WHERE j.id=picked.id RETURNING j.*;
END $$;
CREATE FUNCTION public.wa_provider_dispatch(p_id uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.wa_provider_jobs SET dispatched_at=now()
 WHERE id=p_id AND lease_token=p_token AND state='processing' AND dispatched_at IS NULL
 AND lease_until>now() AND expires_at>now();
 RETURN FOUND;
END $$;
CREATE FUNCTION public.wa_provider_complete(p_id uuid,p_token uuid,p_state text,p_response jsonb,
 p_result_path text,p_error_status integer,p_error_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF p_state NOT IN ('succeeded','failed','uncertain') THEN RAISE EXCEPTION 'RESULT_INVALID'; END IF;
 UPDATE public.wa_provider_jobs j SET state=p_state,response=p_response,result_path=p_result_path,
 body=NULL,error_status=p_error_status,error_code=left(p_error_code,80)
 WHERE j.id=p_id AND j.lease_token=p_token AND j.state='processing' AND j.lease_until>now()
 AND (p_state<>'succeeded' OR j.dispatched_at IS NOT NULL)
 AND (p_result_path IS NULL OR p_result_path=j.worker_id||'/'||j.id::text||'/result.json');
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.wa_provider_heartbeat(text,text,text),public.wa_provider_claim(text,uuid,integer),public.wa_provider_dispatch(uuid,uuid),
 public.wa_provider_complete(uuid,uuid,text,jsonb,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_provider_heartbeat(text,text,text),public.wa_provider_claim(text,uuid,integer),public.wa_provider_dispatch(uuid,uuid),
 public.wa_provider_complete(uuid,uuid,text,jsonb,text,integer,text) TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('whatsapp-relay-private','whatsapp-relay-private',false,40000000,ARRAY['application/json'])
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='whatsapp-relay-private' AND public)
 THEN RAISE EXCEPTION 'RELAY_BUCKET_MUST_BE_PRIVATE'; END IF;
END $$;
CREATE POLICY wa_relay_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id<>'whatsapp-relay-private') WITH CHECK(bucket_id<>'whatsapp-relay-private');
NOTIFY pgrst,'reload schema';
