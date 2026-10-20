import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, resolveConnection, signup, onboardingCookie } from './service.mjs';

function query(result, inspect = () => {}) {
  return new Proxy({}, { get(_target, key) { if (key === 'then') return Promise.resolve(result).then.bind(Promise.resolve(result)); return (...args) => { inspect(key, args); return query(result, inspect); }; } });
}
test('tampered or expired cookie is refused even if browser supplies a valid-looking user ID', async () => {
  const req = { headers: { cookie: '__Host-kortex-wa-onboarding=altered' }, body: { userId: 'victim' } };
  assert.equal(onboardingCookie(req), null);
  await assert.rejects(identity(req, {}, {}), e => e.status === 401);
  const validShape = { headers: { cookie: '__Host-kortex-wa-onboarding=' + 'x'.repeat(43) } };
  const admin = { from: () => query({ data: null, error: null }) };
  await assert.rejects(identity(validShape, admin, {}), e => e.code === 'ONBOARDING_EXPIRED');
});
test('an unconfirmed bearer session does not grant authenticated chat access', async () => {
  await assert.rejects(identity({ headers: { authorization: 'Bearer supplied' } }, {}, { auth: { getUser: async () => ({ data: { user: { id: '1' } } }) } }), e => e.status === 401);
});
test('temporary onboarding rejects messages, file access, sending and activation before any DB lookup', async () => {
  for (const action of ['conversations', 'messages', 'media', 'send', 'activate', 'disconnect']) {
    await assert.rejects(resolveConnection({ query: { action }, body: { userId: 'other', workspaceId: 'other' } }, {}, {}, { temporary: true, user: { id: 'own' } }), e => e.code === 'ONBOARDING_ONLY');
  }
});
test('workspace and sector parameters cannot override the authenticated membership RPC', async () => {
  const auth = { rpc: () => query({ data: [{ workspace_id: 'allowed', sector_id: 'comercial' }], error: null }) };
  await assert.rejects(resolveConnection({ query: {}, body: { workspaceId: 'allowed', sectorId: 'financeiro' } }, {}, auth, { temporary: false, user: { id: 'own' } }, true), e => e.code === 'SCOPE_FORBIDDEN');
});
test('an obfuscated duplicate signup never receives a cookie or accesses the existing instance', async () => {
  let wroteCookie = false, wroteDb = false;
  const admin = { rpc: () => query({ data: true, error: null }), from: () => { wroteDb = true; throw new Error('must not write'); }, auth: { admin: { getUserById: async () => ({ data: { user: { id: 'victim', email: 'existing@example.invalid', user_metadata: { wa_signup_nonce: 'old' }, created_at: new Date().toISOString() } } }) } } };
  const auth = { auth: { signUp: async () => ({ data: { user: { id: 'victim' }, session: null }, error: null }) } };
  const result = await signup({ headers: { origin: 'https://test.example' }, body: { email: 'existing@example.invalid', password: 'testing123', name: 'Tester', sector: 'comercial' } }, { setHeader: (_name, value) => { wroteCookie = !value.includes('Max-Age=0'); } }, admin, auth);
  assert.equal(result.created, false); assert.equal(wroteCookie, false); assert.equal(wroteDb, false);
});
test('only the server-generated creation nonce grants a scoped HttpOnly token', async () => {
  let metadata, cookie, prepared;
  const admin = { from: () => query({data:{user_id:'new'},error:null}), rpc: (name, args) => { if (name === 'wa_prepare_onboarding') prepared = args; return query({ data: true, error: null }); }, auth: { admin: { getUserById: async () => ({ data: { user: { id: 'new', email: 'new@example.invalid', user_metadata: metadata, created_at: new Date().toISOString() } } }) } } };
  const auth = { auth: { signUp: async b => { metadata = b.options.data; return { data: { user: { id: 'new' }, session: null }, error: null }; } } };
  const result = await signup({ headers: { origin: 'https://test.example' }, body: { email: 'new@example.invalid', password: 'testing123', name: 'Tester', sector: 'comercial' } }, { setHeader: (_name, value) => { cookie = value; } }, admin, auth);
  assert.equal(result.created, true); assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/); assert.equal(prepared.p_user, 'new');
  assert.equal(prepared.p_hash.length, 64); assert.equal(cookie.includes(prepared.p_hash), false); assert.equal(JSON.stringify(result).includes(prepared.p_hash), false);
});

test('metadata changed on an existing unconfirmed account cannot forge an auth INSERT proof', async () => {
  let metadata, cookie;
  const admin={rpc:()=>query({data:true,error:null}),from:()=>query({data:null,error:null}),auth:{admin:{getUserById:async()=>({data:{user:{id:'existing',email:'new@example.invalid',user_metadata:metadata,created_at:new Date().toISOString()}}})}}};
  const auth={auth:{signUp:async b=>{metadata=b.options.data;return {data:{user:{id:'existing'},session:null},error:null};}}};
  const result=await signup({headers:{origin:'https://test.example'},body:{email:'new@example.invalid',password:'testing123',name:'Tester',sector:'comercial'}},{setHeader:(_name,value)=>{cookie=value;}},admin,auth);
  assert.equal(result.created,false);assert.match(cookie,/Max-Age=0/);
});
