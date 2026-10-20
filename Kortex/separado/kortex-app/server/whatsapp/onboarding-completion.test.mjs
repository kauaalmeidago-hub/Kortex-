import test from 'node:test';
import assert from 'node:assert/strict';
import { completeOnboarding } from './service.mjs';

function query(result) {
  return new Proxy({}, { get(_target, key) {
    if (key === 'then') return Promise.resolve(result).then.bind(Promise.resolve(result));
    return () => query(result);
  } });
}
function fixture() {
  const calls = [], headers = {};
  let revoked = false, provider = 'open', grantOwner = 'new', lease = true, sessionOwner = 'new';
  const req = { headers: { cookie: '__Host-kortex-wa-onboarding=' + 'a'.repeat(43) }, body: { userId: 'victim', email: 'victim@example.test', connected: true } };
  const c = { id: 'connection', owner_id: 'new', state: 'connected', phone_jid: 'test-phone', activated_at: null };
  const admin = {
    rpc: () => query({ data: lease, error: null }),
    from: table => {
      if (table === 'wa_connections') return query({ data: { id: c.id }, error: null });
      return new Proxy({}, { get(_target, key) {
        if (key === 'update') return () => { revoked = true; calls.push('revoke'); return query({ data: null, error: null }); };
        return () => query({ data: revoked ? null : { user_id: grantOwner }, error: null });
      } });
    },
    auth: { admin: {
      getUserById: async id => { calls.push(['account', id]); return { data: { user: { id, email: 'new@example.test', app_metadata: { role: 'user' } } } }; },
      updateUserById: async (id, patch) => { calls.push(['confirm', id, patch]); return { data: { user: { id } } }; },
      generateLink: async args => { calls.push(['link', args]); return { data: { user: { id: 'new' }, properties: { hashed_token: 'private-token' } } }; },
    } },
  };
  const auth = { auth: { verifyOtp: async args => { calls.push(['exchange', args]); return { data: { session: { user: { id: sessionOwner }, access_token: 'access', refresh_token: 'refresh' } } }; } } };
  const readProvider = async () => { calls.push('provider'); return { instance: { state: provider } }; };
  const run = () => completeOnboarding(req, { setHeader: (key, value) => { headers[key] = value; } }, admin, auth, c, readProvider);
  return { calls, headers, c, run, revoke: () => { revoked = true; }, provider: value => { provider = value; }, owner: value => { grantOwner = value; }, lease: value => { lease = value; }, sessionOwner: value => { sessionOwner = value; } };
}
test('confirmed provider pairing exchanges the creation grant for its own session without an email step', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { session: { access_token: 'access', refresh_token: 'refresh' } });
  assert.deepEqual(f.calls.find(x => x[0] === 'account'), ['account', 'new']);
  assert.deepEqual(f.calls.find(x => x[0] === 'link'), ['link', { type: 'magiclink', email: 'new@example.test' }]);
  assert.equal(f.calls.find(x => x[0] === 'confirm')[2].app_metadata.role, 'user');
  assert.equal(f.calls.find(x => x[0] === 'confirm')[2].email_confirm, true);
  assert.match(f.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Lax; Max-Age=0/);
  assert.ok(f.calls.indexOf('provider') < f.calls.findIndex(x => x[0] === 'confirm'));
  assert.equal(JSON.stringify(await Promise.resolve(f.headers)).includes('private-token'), false);
  await assert.rejects(f.run(), e => e.code === 'ONBOARDING_EXPIRED');
  assert.equal(f.calls.filter(x => x[0] === 'exchange').length, 1);
});
test('a browser connected flag cannot replace pending or freshly disconnected provider state', async () => {
  for (const state of ['qr', 'disconnected']) {
    const f = fixture();
    if (state === 'qr') f.c.state = state; else f.provider('close');
    await assert.rejects(f.run(), e => e.code === 'PAIRING_REQUIRED');
    assert.equal(f.calls.some(x => Array.isArray(x)), false);
  }
});
test('expired or different-account creation grants cannot issue sessions', async () => {
  for (const invalid of ['expired', 'other']) {
    const f = fixture();
    if (invalid === 'expired') f.revoke(); else f.owner('other');
    await assert.rejects(f.run(), e => ['ONBOARDING_EXPIRED', 'ONBOARDING_ONLY'].includes(e.code));
    assert.equal(f.calls.length, 0);
  }
});
test('a concurrent completion without the lease does not perform authentication work', async () => {
  const f = fixture(); f.lease(false);
  await assert.rejects(f.run(), e => e.code === 'CONNECTION_BUSY');
  assert.equal(f.calls.length, 0);
});
test('a mismatched session is never returned and does not consume the grant', async () => {
  const f = fixture(); f.sessionOwner('other');
  await assert.rejects(f.run(), e => e.code === 'ONBOARDING_RETRY');
  assert.equal(f.calls.includes('revoke'), false);
  assert.equal(f.headers['Set-Cookie'], undefined);
});
