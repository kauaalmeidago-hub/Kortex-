-- Temporary encrypted self-service requests. No company or portal access is registered.
CREATE TABLE public.koa_whatsapp_card_workers (
 id text PRIMARY KEY,ready boolean NOT NULL DEFAULT false,version text NOT NULL,
 public_key jsonb NOT NULL,key_id text NOT NULL,last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.koa_whatsapp_card_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),channel_id uuid NOT NULL REFERENCES public.koa_whatsapp_channels(id),
 source_event text NOT NULL,peer_jid text NOT NULL CHECK(peer_jid ~ '^[0-9]+@(s\.whatsapp\.net|lid)$'),instance text NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),worker_id text NOT NULL REFERENCES public.koa_whatsapp_card_workers(id),key_id text NOT NULL,
 state text NOT NULL DEFAULT 'awaiting_access' CHECK(state IN ('awaiting_access','queued','processing','sending','sent','failed','uncertain','cancelled','expired')),
 sealed_payload jsonb,sealed_hash text,identity_verified boolean NOT NULL DEFAULT false,lease_expires_at timestamptz,
 provider_message_id text,error_code text,expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(channel_id,source_event)
);
CREATE INDEX koa_card_queue ON public.koa_whatsapp_card_requests(worker_id,state,created_at);
CREATE INDEX koa_card_peer ON public.koa_whatsapp_card_requests(channel_id,peer_jid,created_at);
ALTER TABLE public.koa_whatsapp_card_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.koa_whatsapp_card_workers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.koa_whatsapp_card_requests,public.koa_whatsapp_card_workers FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.koa_whatsapp_card_requests,public.koa_whatsapp_card_workers TO service_role;
NOTIFY pgrst,'reload schema';
