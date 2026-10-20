import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeWebhook, webhookHash } from './edge-webhook.mjs';

const secret = 'a'.repeat(64), instance = 'koa-' + 'b'.repeat(32);
function query(result, inspect = () => {}) {
  return new Proxy({}, { get(_target,key) {
    if (key === 'then') { const p = Promise.resolve(result); return p.then.bind(p); }
    return (...args) => { inspect(key,args); return query(result,inspect); };
  } });
}
function admin({ authorized = true, state = 'qr', failIngest = false } = {}) {
  const calls = [];
  return { calls,
    from(table) { return query({ data: table === 'wa_provider_workers' ? authorized ? { id: 'evolution-local' } : null : { id: 'connection', state }, error: null },
      (key,args) => calls.push({ table,key,args })); },
    rpc(name,args) { calls.push({ name,args }); return Promise.resolve({ data: true, error: name === 'wa_ingest' && failIngest ? { message: 'private database detail' } : null }); },
  };
}
function request(payload, supplied = secret, headers = {}) {
  return new Request('https://webhook.invalid', { method: 'POST', headers: { 'content-type': 'application/json',
    'x-kortex-webhook-secret': supplied, ...headers }, body: JSON.stringify(payload) });
}
test('webhook rejects missing credentials without DB access and refuses a wrong digest', async () => {
  assert.equal((await edgeWebhook(request({}, ''), {})).status, 401);
  const db = admin({ authorized: false });
  assert.equal((await edgeWebhook(request({}), db)).status, 401);
  assert.equal(db.calls.some(c => c.name === 'wa_ingest'), false);
  assert.equal(db.calls.find(c => c.key === 'eq').args[1], await webhookHash(secret));
});
test('authenticated events cannot address legacy sessions or use an unsupported event', async () => {
  const db = admin();
  assert.equal((await edgeWebhook(request({ instance: 'legacy', event: 'CONNECTION_UPDATE' }), db)).status, 404);
  assert.equal((await edgeWebhook(request({ instance, event: 'DELETE_INSTANCE' }), db)).status, 400);
  assert.equal(db.calls.some(c => c.table === 'wa_connections'), false);
});
test('ingress normalizes messages and strips provider credentials before transactional ingestion', async () => {
  const db = admin();
  const event = { instance, event: 'MESSAGES_UPSERT', apikey: 'must-never-persist', data: {
    key: { id: 'message-fixture', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
    messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: 'fixture: create a task' },
  } };
  assert.equal((await edgeWebhook(request(event), db)).status, 200);
  const ingestion = db.calls.find(c => c.name === 'wa_ingest').args;
  assert.equal(ingestion.p_messages[0].body, 'fixture: create a task');
  assert.equal(JSON.stringify(db.calls).includes('must-never-persist'), false);
  assert.equal(JSON.stringify(db.calls).includes(secret), false);
});
test('a delayed QR cannot replace a connected state and a connection event cannot declare success', async () => {
  const db = admin({ state: 'connected' });
  assert.equal((await edgeWebhook(request({ instance, event: 'QRCODE_UPDATED', data: { qrcode: { base64: 'data:image/png;base64,YQ==' } } }), db)).status, 200);
  assert.equal((await edgeWebhook(request({ instance, event: 'CONNECTION_UPDATE', data: { state: 'open' } }), db)).status, 200);
  assert.equal(db.calls.some(c => c.key === 'update'), false);
});
test('ingress enforces the byte limit even without Content-Length and hides database errors', async () => {
  const db = admin();
  const oversized = request({ instance, event: 'MESSAGES_SET', data: 'x'.repeat(2000001) });
  assert.equal(oversized.headers.has('content-length'), false);
  assert.equal((await edgeWebhook(oversized, db)).status, 413);
  const failed = await edgeWebhook(request({ instance, event: 'CHATS_SET', data: [] }), admin({ failIngest: true }));
  assert.equal(failed.status, 503);
  assert.equal(await failed.text(), '{"code":"PERSISTENCE_UNAVAILABLE"}');
});
