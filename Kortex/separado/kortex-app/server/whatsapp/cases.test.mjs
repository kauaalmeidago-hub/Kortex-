import test from 'node:test';
import assert from 'node:assert/strict';
import { caseAction, caseRpc, caseConnection } from './cases.mjs';

test('case action uses the authenticated RPC and never accepts a browser-supplied actor', async () => {
  let called;
  const auth = { rpc: async (name, params) => { called = { name, params }; return { data: { saved: true } }; } };
  await caseAction({ body: { caseId: '11111111-1111-4111-8111-111111111111', version: 3, action: 'transfer', userId: 'target', actorId: 'victim', channelId: 'channel', sectorId: 'sector', summary: 'Pedido', reason: 'Encaminhar', requestType: 'Comercial' } }, auth);
  assert.equal(called.name, 'wa_case_change'); assert.equal(called.params.p_target, 'target');
  assert.equal(called.params.p_version, 3); assert.equal(JSON.stringify(called).includes('victim'), false);
});
test('stale versions, concurrent claims and blocked destinations have contextual errors', async () => {
  for (const code of ['CASE_CHANGED', 'CASE_CLAIMED', 'DESTINATION_OFFLINE', 'SEND_UNCERTAIN']) {
    await assert.rejects(caseRpc({ rpc: async () => ({ error: { code: 'PT409', message: code } }) }, 'op', {}), e => e.code === code && e.status === 409);
  }
});
test('case actions require a version and a real case identifier before touching the DB', async () => {
  for (const body of [{}, { caseId: 'invalid', version: 1 }, { caseId: '11111111-1111-4111-8111-111111111111', version: -1 }])
    await assert.rejects(caseAction({ body }, {}), e => e.code === 'INVALID_CASE');
});
test('a transfer returns only the authorized persisted continuation, never a browser supplied conversation', async () => {
  const kase='11111111-1111-4111-8111-111111111111';
  const q={select:()=>q,eq:(_field,id)=>{assert.equal(id,kase);return q;},maybeSingle:async()=>({data:{conversation_id:'authorized-continuation'}})};
  const auth={rpc:async()=>({data:{saved:true,caseId:kase}}),from:table=>{assert.equal(table,'wa_cases');return q;}};
  const result=await caseAction({body:{caseId:kase,version:1,action:'transfer',conversationId:'browser-forged'}},auth);
  assert.equal(result.conversationId,'authorized-continuation');
});
test('a supplied connection ID cannot bypass conversation authorization', async () => {
  await assert.rejects(caseConnection({ query: { conversationId: 'foreign', connectionId: 'allowed' }, body: {} }, { from: () => { throw Error('must not access privileged data'); } }, { rpc: async () => ({ data: false }) }), e => e.code === 'SCOPE_FORBIDDEN');
});
test('message RLS is consulted before deriving a media channel', async () => {
  const query = new Proxy({}, { get: (_target, key) => key === 'then' ? Promise.resolve({ data: null }).then.bind(Promise.resolve({ data: null })) : () => query });
  await assert.rejects(caseConnection({ query: { messageId: 'foreign-file' } }, {}, { from: () => query }), e => e.code === 'SCOPE_FORBIDDEN');
});
