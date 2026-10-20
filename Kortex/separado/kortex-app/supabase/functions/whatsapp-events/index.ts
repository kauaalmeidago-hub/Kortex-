import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { edgeWebhook } from '../../../server/whatsapp/edge-webhook.mjs';

// Runtime-owned secrets stay inside Supabase. They are not read by tooling or
// exposed to the provider. New API keys are preferred, legacy is a fallback.
const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const key = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const url = Deno.env.get('SUPABASE_URL');
if (!url || !key) throw new Error('BACKEND_NOT_CONFIGURED');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(req => edgeWebhook(req, admin));
