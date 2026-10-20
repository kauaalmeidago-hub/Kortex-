import { normalizeEvent, qrImage } from './normalize.mjs';

const events = new Set(['qrcode-updated', 'connection-update', 'messages-upsert', 'messages-set', 'messages-update', 'send-message',
  'chats-upsert', 'chats-update', 'chats-set', 'contacts-upsert', 'contacts-update', 'contacts-set']);
const limit = 2000000;
const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
export const webhookHash = async value => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const response = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function checked(query) {
  const result = await query;
  if (result.error) throw new Error('PERSISTENCE_UNAVAILABLE');
  return result.data;
}
async function readBody(req) {
  if (Number(req.headers.get('content-length')) > limit) throw Object.assign(new Error(), { status: 413 });
  const reader = req.body?.getReader();
  if (!reader) throw Object.assign(new Error(), { status: 400 });
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw Object.assign(new Error(), { status: 413 }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error(), { status: 400 }); }
}

// The public ingress has its own authentication. It does not change or bypass
// Vercel protection and never accepts a browser session as provider authority.
export async function edgeWebhook(req, admin, allowGroups = false) {
  if (req.method !== 'POST') return response(405, { code: 'METHOD' });
  const secret = req.headers.get('x-kortex-webhook-secret');
  if (!/^[a-f0-9]{64}$/.test(secret ?? '')) return response(401, { code: 'WEBHOOK_UNAUTHORIZED' });
  try {
    const worker = await checked(admin.from('wa_provider_workers').select('id').eq('webhook_token_hash', await webhookHash(secret)).maybeSingle());
    if (!worker) return response(401, { code: 'WEBHOOK_UNAUTHORIZED' });
    if (!req.headers.get('content-type')?.startsWith('application/json')) return response(415, { code: 'CONTENT_TYPE' });
    if (!await checked(admin.rpc('wa_rate_limit', { p_key: await webhookHash('webhook:' + worker.id), p_max: 1000, p_seconds: 60 })))
      return response(429, { code: 'RATE_LIMITED' });
    const payload = await readBody(req);
    if (!/^koa-[a-f0-9]{32}$/.test(payload?.instance ?? '')) return response(404, { code: 'INSTANCE_UNKNOWN' });
    const type = String(payload.event ?? '').replace(/[._]/g, '-').toLowerCase();
    if (!events.has(type)) return response(400, { code: 'EVENT_INVALID' });
    if (Array.isArray(payload.data) && payload.data.length > 1000) return response(413, { code: 'EVENT_TOO_LARGE' });
    const c = await checked(admin.from('wa_connections').select('id,state').eq('instance_name', payload.instance).maybeSingle());
    if (!c) return response(404, { code: 'INSTANCE_UNKNOWN' });
    // Drop top-level provider credentials. Persist only normalized fields; no
    // AI invocation or administrative action is triggered by message content.
    const safe = { event: type, data: payload.data };
    const normalized = normalizeEvent(safe, allowGroups);
    await checked(admin.rpc('wa_ingest', { p_connection: c.id, p_hash: await webhookHash(JSON.stringify({ type, data: safe.data })),
      p_type: type, p_messages: normalized.messages, p_receipts: normalized.receipts, p_chats: normalized.chats }));
    if (type === 'qrcode-updated' && c.state !== 'connected') {
      const qr = qrImage(payload.data?.qrcode?.base64);
      if (qr) await checked(admin.from('wa_connections').update({ state: 'qr', qr_data: qr, qr_expires_at: new Date(Date.now() + 40000).toISOString() }).eq('id', c.id).neq('state', 'connected'));
    }
    // Connection-update is only an event hint. Portal/worker confirm state and
    // phone identity with Evolution, rather than trusting delivery order.
    return response(200, { received: true });
  } catch (error) {
    return response(error.status || 503, { code: error.status ? 'INVALID_PAYLOAD' : 'PERSISTENCE_UNAVAILABLE' });
  }
}
