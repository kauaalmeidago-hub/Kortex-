import test from 'node:test';
import assert from 'node:assert/strict';
import { providerRequest, managedRequest, relayRequest, processRelayJob, readRelayResult, workerId, RELAY_BUCKET } from './relay.mjs';
import { evolutionConfig, providerHttpConfig } from './evolution.mjs';

const instance = 'koa-' + 'a'.repeat(32);
function query(resolve, state = {}) {
  return new Proxy({}, { get(_target, key) {
    if (key === 'then') { const pending = Promise.resolve().then(() => resolve(state)); return pending.then.bind(pending); }
    return (...args) => { state[key] = args; return query(resolve, state); };
  } });
}
function bridgeAdmin({ online = true, jobs = 'succeeded', dispatch = true } = {}) {
  const calls = [], uploads = [];
  const admin = {
    calls, uploads,
    from(table) { return query(state => {
      calls.push({ table, ...state });
      if (table === 'wa_connections') return { data: { id: 'managed' }, error: null };
      if (table === 'wa_provider_workers') return { data: { state: online ? 'ready' : 'offline', last_seen_at: new Date(1000).toISOString() }, error: null };
      return { data: state.select ? { id: 'result', state: jobs, response: { version: '2.3.7' } } : null, error: null };
    }); },
    rpc(name, args) { calls.push({ rpc: name, args }); return Promise.resolve({ data: name === 'wa_provider_dispatch' ? dispatch : true, error: null }); },
    storage: { from(bucket) { return {
      upload(path, bytes, options) { uploads.push({ bucket, path, bytes, options }); return Promise.resolve({ data: {}, error: null }); },
      download() { throw new Error('unexpected download'); },
    }; } },
  };
  return admin;
}
test('bridge only accepts the required routes for managed names, never a URL or a broad instance listing', () => {
  assert.deepEqual(providerRequest('/instance/connectionState/' + instance, undefined, 'GET'), { instance, safeRetry: true });
  assert.equal(providerRequest('/message/sendText/' + instance, {}, 'POST').safeRetry, false);
  assert.equal(providerRequest('/instance/connect/' + instance, undefined, 'GET').safeRetry, false);
  for (const path of ['https://provider.invalid/', '//evil.invalid/', '/instance/fetchInstances', '/instance/logout/legacy-session', '/instance/connectionState/' + instance + '?other=x'])
    assert.throws(() => providerRequest(path, undefined, 'GET'), e => e.code === 'RELAY_ROUTE');
  assert.throws(() => providerRequest('/message/sendText/' + instance, {}, 'GET'), e => e.code === 'RELAY_ROUTE');
  assert.equal(providerRequest('/instance/fetchInstances?instanceName=' + instance, undefined, 'GET').instance, instance);
});
test('legacy sessions cannot be addressed even by a queued request', async () => {
  let called = false;
  const admin = bridgeAdmin();
  await processRelayJob(admin, { id: 'job', path: '/instance/logout/legacy-session', method: 'DELETE', safe_retry: false }, 'lease', async () => { called = true; });
  assert.equal(called, false);
  assert.equal(admin.calls.at(-1).args.p_state, 'failed');
});
test('a plausible instance name absent from the platform is rejected before provider access', async () => {
  const admin = { from: () => query(() => ({ data: null, error: null })) };
  await assert.rejects(managedRequest(admin, '/instance/connect/' + instance, undefined, 'GET'), e => e.code === 'RELAY_INSTANCE');
});
test('local HTTP is permitted only for the explicit local worker and only at loopback', () => {
  const base = { EVOLUTION_API_URL: 'http://127.0.0.1:8081', EVOLUTION_API_KEY: 'local-key' };
  assert.throws(() => providerHttpConfig(base), e => e.code === 'PROVIDER_HTTPS_REQUIRED');
  assert.equal(providerHttpConfig({ ...base, WHATSAPP_LOCAL_WORKER: 'true' }).base, 'http://127.0.0.1:8081');
  assert.throws(() => providerHttpConfig({ ...base, WHATSAPP_LOCAL_WORKER: 'true', EVOLUTION_API_URL: 'http://192.168.1.2:8081' }), e => e.code === 'PROVIDER_HTTPS_REQUIRED');
  assert.throws(() => providerHttpConfig({ ...base, EVOLUTION_API_URL: 'https://user:secret@provider.invalid' }), e => e.code === 'PROVIDER_HTTPS_REQUIRED');
});
test('cloud relay config has no Evolution URL or key and keeps an HTTPS authenticated webhook', () => {
  const c = evolutionConfig({ WHATSAPP_EVOLUTION_TRANSPORT: 'relay', EVOLUTION_WEBHOOK_SECRET: 'webhook-only', WHATSAPP_WEBHOOK_URL: 'https://app.invalid/api/whatsapp-webhook' });
  assert.equal(c.relay, true); assert.equal(c.key, undefined); assert.equal(c.base, undefined);
  assert.throws(() => evolutionConfig({ WHATSAPP_EVOLUTION_TRANSPORT: 'relay', EVOLUTION_WEBHOOK_SECRET: 'x', WHATSAPP_WEBHOOK_URL: 'http://app.invalid/api/whatsapp-webhook' }), e => e.code === 'PROVIDER_HTTPS_REQUIRED');
  assert.throws(() => workerId({ WHATSAPP_WORKER_ID: '../another' }), e => e.code === 'WORKER_CONFIG');
});
test('offline worker fails before placing a command in the queue', async () => {
  const admin = bridgeAdmin({ online: false });
  await assert.rejects(relayRequest('/', undefined, 'GET', {}, { admin, now: () => 1000 }), e => e.code === 'PROVIDER_WORKER_OFFLINE');
  assert.equal(admin.calls.some(c => c.insert), false);
});
test('relay can complete without making the Evolution key available to the cloud', async () => {
  const admin = bridgeAdmin();
  const result = await relayRequest('/', undefined, 'GET', {}, { admin, now: () => 1000 });
  assert.equal(result.version, '2.3.7');
  const request = admin.calls.find(c => c.insert)?.insert[0];
  assert.equal(request.path, '/'); assert.equal(request.safe_retry, true);
  assert.equal(JSON.stringify(request).includes('apikey'), false);
});
test('timeout cancels only work not yet started and treats a send as uncertain', async () => {
  const admin = bridgeAdmin({ jobs: 'processing' }); let clock = 1000;
  await assert.rejects(relayRequest('/message/sendText/' + instance, { text: 'test' }, 'POST', {},
    { admin, now: () => clock, timeoutMs: 10, sleep: async () => { clock += 20; } }), e => e.code === 'PROVIDER_RESULT_UNKNOWN');
  const cancel = admin.calls.find(c => c.update);
  assert.equal(cancel.update[0].state, 'canceled'); assert.deepEqual(cancel.eq, ['state', 'queued']);
});
test('a lost or already dispatched lease never calls the provider', async () => {
  const admin = bridgeAdmin({ dispatch: false }); let called = false;
  const result = await processRelayJob(admin, { id: 'job', path: '/', method: 'GET', safe_retry: true }, 'lease', async () => { called = true; });
  assert.equal(result, false); assert.equal(called, false);
});
test('uncertain provider mutations are not converted into a safe retry', async () => {
  const admin = bridgeAdmin();
  await processRelayJob(admin, { id: 'job', path: '/message/sendText/' + instance, method: 'POST', safe_retry: false }, 'lease', async () => { throw new Error('connection closed after sending'); });
  assert.equal(admin.calls.at(-1).args.p_state, 'uncertain');
});
test('large provider media results use a private object rather than a public URL or a large DB field', async () => {
  const admin = bridgeAdmin();
  await processRelayJob(admin, { id: 'job', worker_id: 'evolution-local', path: '/', method: 'GET', safe_retry: true }, 'lease', async () => ({ base64: 'a'.repeat(200001) }));
  assert.equal(admin.uploads[0].bucket, RELAY_BUCKET);
  assert.equal(admin.uploads[0].path, 'evolution-local/job/result.json');
  const result = admin.calls.at(-1).args;
  assert.equal(result.p_response, null); assert.equal(result.p_result_path, 'evolution-local/job/result.json');
});
test('a result cannot point at another job or storage path', async () => {
  await assert.rejects(readRelayResult({}, { state: 'succeeded', id: 'own', worker_id: 'evolution-local', result_path: 'evolution-local/other/result.json' }), e => e.code === 'RELAY_RESULT');
});
