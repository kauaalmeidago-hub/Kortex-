import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { isolatedDatabase } from './bootstrap.mjs';

// A fresh isolated PostgreSQL database: never real users, channels or messages.
const db = await isolatedDatabase(), evidence = [];
const q = (sql, params = []) => db.query(sql, params);
const one = async (sql, params = []) => (await q(sql, params)).rows[0];
async function as(user, fn) {
  await db.exec('BEGIN;SET LOCAL ROLE authenticated;');
  await q("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]);
  try { const result = await fn(); await db.exec('COMMIT'); return result; }
  catch (e) { await db.exec('ROLLBACK'); throw e; }
}
async function denied(user, sql, params, code) {
  await assert.rejects(as(user, () => q(sql, params)), error => code ? error.message.includes(code) : ['42501', 'PT409', '22023'].includes(error.code));
}
async function check(name, fn) { await fn(); evidence.push(name); console.log('PASS', name); }
try {
  await db.exec('ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz;');
  for (const file of ['20261020210000_whatsapp_chat.sql', '20261020211000_whatsapp_read.sql', '20261020212000_whatsapp_onboarding.sql', '20261020213000_whatsapp_signup_proof.sql', '20261020214000_whatsapp_cleanup_guard.sql', '20261021201659_whatsapp_case_phases_transfer.sql', '20261021201821_whatsapp_case_security_review.sql']) {
    await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  }
  const users = {};
  for (const name of ['Luisa', 'Fernando', 'Outsider', 'Other']) {
    users[name] = randomUUID();
    await q('INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,$2,now(),$3)', [users[name], `${name}@example.invalid`, JSON.stringify({ full_name: name, sector: 'relacionamento' })]);
  }
  const ws = (await one('SELECT id FROM public.workspaces WHERE owner_id=$1', [users.Luisa])).id;
  const sector = (await one('SELECT id FROM public.task_sectors WHERE workspace_id=$1 LIMIT 1', [ws])).id;
  for (const name of ['Fernando', 'Other']) {
    await q("INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')", [ws, users[name]]);
    await q('INSERT INTO public.task_sector_members(workspace_id,sector_id,user_id) VALUES($1,$2,$3)', [ws, sector, users[name]]);
  }
  const channels = {};
  for (const name of ['Luisa', 'Fernando']) channels[name] = (await one("INSERT INTO public.wa_connections(owner_id,workspace_id,sector_id,instance_name,activated_at,state) VALUES($1,$2,$3,$4,now(),'connected') RETURNING id", [users[name], ws, sector, 'koa-' + randomUUID().replaceAll('-', '')])).id;
  const conv = (await one("INSERT INTO public.wa_conversations(connection_id,remote_jid,name) VALUES($1,'5511000000000@s.whatsapp.net','Cliente de teste') RETURNING id", [channels.Luisa])).id;
  const getCase = async () => one('SELECT * FROM public.wa_cases WHERE conversation_id=$1 AND is_current', [conv]);
  let k = await getCase();
  const actionSql = 'SELECT public.wa_case_change($1,$2,$3,$4,$5,$6,$7,$8,$9) result';
  const change = (user, action, extra = {}) => as(user, () => one(actionSql, [extra.caseId || k.id, extra.version || k.version, action, extra.reason || 'Providência de teste', extra.target || null, extra.channel || null, extra.sector || null, extra.summary || '', extra.type || '']));
  await check('new/imported conversations start in manual triage without invented human ownership', async () => {
    assert.equal(k.phase, 'triage'); assert.equal(k.claimed_by, null); assert.equal(k.triage_state, 'manual');
  });
  await check('another organization and a non-granted operator cannot see history, counts or assume the case', async () => {
    for (const user of [users.Outsider, users.Fernando]) {
      assert.equal((await as(user, () => one('SELECT public.wa_case_inbox($1) inbox', [ws]))).inbox.counts.all, 0);
      assert.equal((await as(user, () => q('SELECT * FROM public.wa_conversations WHERE id=$1', [conv]))).rows.length, 0);
      await denied(user, actionSql, [k.id, k.version, 'claim', '', null, null, null, '', ''], 'SCOPE_FORBIDDEN');
    }
  });
  await check('channel owner explicitly grants Fernando access; he can then operate both configured channels', async () => {
    await as(users.Luisa, () => q('SELECT public.wa_channel_config($1,$2,false,false)', [channels.Luisa, users.Fernando]));
    for (const c of Object.values(channels)) assert.equal((await as(users.Fernando, () => one('SELECT public.wa_can_access($1) allowed', [c]))).allowed, true);
    await denied(users.Fernando, 'SELECT public.wa_channel_config($1,$2,true,false)', [channels.Luisa, users.Other]);
  });
  await check('atomic claim/version fence admits only one of two competing operators', async () => {
    const oldVersion = k.version;
    await change(users.Luisa, 'claim'); k = await getCase();
    await denied(users.Fernando, actionSql, [k.id, oldVersion, 'claim', '', null, null, null, '', ''], 'CASE_CHANGED');
    await denied(users.Fernando, actionSql, [k.id, k.version, 'claim', '', null, null, null, '', ''], 'CASE_CLAIMED');
    assert.equal(k.claimed_by, users.Luisa);
  });
  await check('pending reason and exclusive send ownership are enforced inside PostgreSQL', async () => {
    await denied(users.Luisa, actionSql, [k.id, k.version, 'pending', '', null, null, null, '', ''], 'REASON_REQUIRED');
    await denied(users.Fernando, 'SELECT public.wa_case_send_begin($1,$2,$3)', [conv, randomUUID(), 'hash'], 'CLAIM_REQUIRED');
    await change(users.Luisa, 'pending'); k = await getCase(); assert.equal(k.phase, 'pending');
    await denied(users.Luisa, 'SELECT public.wa_case_send_begin($1,$2,$3)', [conv, randomUUID(), 'hash'], 'CLAIM_REQUIRED');
    await change(users.Luisa, 'claim'); k = await getCase();
  });
  await check('a reserved or uncertain send blocks a conflicting phase/transfer; retries do not reserve twice', async () => {
    const request = randomUUID();
    assert.equal((await as(users.Luisa, () => one('SELECT public.wa_case_send_begin($1,$2,$3) created', [conv, request, 'hash']))).created, true);
    assert.equal((await as(users.Luisa, () => one('SELECT public.wa_case_send_begin($1,$2,$3) created', [conv, request, 'hash']))).created, false);
    await denied(users.Luisa, actionSql, [k.id, k.version, 'resolve', 'Concluído', null, null, null, '', ''], 'SEND_UNCERTAIN');
    await q("UPDATE public.wa_outbox SET state='sent',provider_id='provider-test' WHERE request_id=$1", [request]);
  });
  await check('same-channel assignment returns to Triagem and only the recipient/supervision can assume', async () => {
    await change(users.Luisa, 'transfer', { target: users.Fernando, channel: channels.Luisa, sector, summary: 'Cotação preparada', type: 'Comercial' });
    k = await getCase(); assert.equal(k.phase, 'triage'); assert.equal(k.claimed_by, null); assert.equal(k.assigned_to, users.Fernando);
    await change(users.Fernando, 'claim'); k = await getCase(); assert.equal(k.claimed_by, users.Fernando);
  });
  await check('unconfigured, wrong-workspace and offline destinations are rejected without changing the case', async () => {
    for (const [target, channel, expected] of [[users.Outsider, channels.Luisa, 'DESTINATION_FORBIDDEN'], [users.Other, channels.Luisa, 'DESTINATION_FORBIDDEN']]) {
      await denied(users.Fernando, actionSql, [k.id, k.version, 'transfer', 'Encaminhar', target, channel, sector, 'Contexto autorizado', 'Pedido'], expected);
    }
    await q("UPDATE public.wa_connections SET state='disconnected' WHERE id=$1", [channels.Fernando]);
    await denied(users.Fernando, actionSql, [k.id, k.version, 'transfer', 'Encaminhar', users.Fernando, channels.Fernando, sector, 'Contexto autorizado', 'Pedido'], 'DESTINATION_OFFLINE');
    assert.equal((await getCase()).version, k.version);
    await q("UPDATE public.wa_connections SET state='connected' WHERE id=$1", [channels.Fernando]);
  });
  await check('cross-channel continuity preserves the original messages and grants Luisa no general access to Fernando channel', async () => {
    // A request originated in Fernando's channel. Fernando is explicitly
    // authorized in Luisa's channel, not the other way around.
    const original = (await one("INSERT INTO public.wa_conversations(connection_id,remote_jid,name) VALUES($1,'5511000000001@s.whatsapp.net','Outro cliente') RETURNING id", [channels.Fernando])).id;
    let second = await one('SELECT * FROM public.wa_cases WHERE conversation_id=$1', [original]);
    await change(users.Fernando, 'transfer', { caseId: second.id, version: second.version, target: users.Luisa, channel: channels.Luisa, sector, summary: 'Pedido de inclusão', type: 'Relacionamento' });
    second = await one('SELECT * FROM public.wa_cases WHERE id=$1', [second.id]);
    assert.equal(second.origin_conversation_id, original); assert.notEqual(second.conversation_id, original); assert.equal(second.continuity_pending, true);
    assert.equal((await as(users.Luisa, () => one('SELECT public.wa_can_read_conversation($1) allowed', [original]))).allowed, false);
    assert.equal((await as(users.Luisa, () => one('SELECT public.wa_can_read_conversation($1) allowed', [second.conversation_id]))).allowed, true);
    const counts = (await as(users.Fernando, () => one('SELECT public.wa_case_inbox($1) inbox', [ws]))).inbox.counts;
    assert.equal(counts.all, 2, 'two linked conversations count as one transferred case');
    assert.equal((await one('SELECT count(*)::int n FROM public.wa_case_events WHERE case_id=$1', [second.id])).n, 1);
    await change(users.Luisa, 'claim', { caseId: second.id, version: second.version });
    const request = randomUUID();
    await as(users.Luisa, () => q('SELECT public.wa_case_send_begin($1,$2,$3)', [second.conversation_id, request, 'continuity-hash']));
    assert.equal((await one('SELECT continuity_pending FROM public.wa_cases WHERE id=$1', [second.id])).continuity_pending, true);
    await q("UPDATE public.wa_outbox SET state='sent',provider_id='isolated-provider-proof' WHERE request_id=$1", [request]);
    assert.equal((await one('SELECT continuity_pending FROM public.wa_cases WHERE id=$1', [second.id])).continuity_pending, false);
  });
  await check('resolution, reopening and a different request preserve case history and do not create a case per message', async () => {
    await change(users.Fernando, 'resolve'); k = await getCase(); assert.equal(k.phase, 'resolved');
    await change(users.Fernando, 'reopen'); k = await getCase(); assert.equal(k.phase, 'triage');
    await change(users.Fernando, 'claim'); k = await getCase(); await change(users.Fernando, 'resolve'); k = await getCase();
    const oldCase = k.id; await change(users.Fernando, 'new'); k = await getCase();
    assert.notEqual(k.id, oldCase); assert.equal(k.phase, 'triage');
    assert.equal((await one('SELECT count(*)::int n FROM public.wa_cases WHERE conversation_id=$1', [conv])).n, 2);
    assert.equal((await one('SELECT is_current FROM public.wa_cases WHERE id=$1', [oldCase])).is_current, false);
  });
  await check('new tables reject anonymous reads and authenticated direct writes', async () => {
    for (const table of ['wa_cases', 'wa_channel_grants', 'wa_case_events']) {
      await assert.rejects(db.exec(`SET ROLE anon;SELECT * FROM public.${table}`), e => e.code === '42501'); await db.exec('RESET ROLE');
      await denied(users.Luisa, `DELETE FROM public.${table}`, []);
    }
  });
  await check('server phase filtering/counts span more than 250 cases and preserve the selected case outside its filter', async () => {
    await q("INSERT INTO public.wa_conversations(connection_id,remote_jid,name) SELECT $1,'5511555'||s||'@s.whatsapp.net','Cliente '||s FROM generate_series(1,260) s", [channels.Luisa]);
    const visible = (await as(users.Luisa, () => one('SELECT public.wa_case_inbox($1,$2,$3,$4) inbox', [ws, 'triage', '', conv]))).inbox;
    assert.equal(visible.items.length, 250); assert.ok(visible.counts.triage > 250);
    const filtered = (await as(users.Luisa, () => one('SELECT public.wa_case_inbox($1,$2,$3,$4) inbox', [ws, 'resolved', '', conv]))).inbox;
    assert.equal(filtered.items.length, 0); assert.equal(filtered.selected.id, conv); assert.equal(filtered.counts.all, visible.counts.all);
  });
  await mkdir('outputs/whatsapp-cases', { recursive: true });
  await writeFile('outputs/whatsapp-cases/database-verification.json', JSON.stringify({ isolated: true, checks: evidence }, null, 2));
  console.log(`${evidence.length} isolated database checks passed. No real WhatsApp requests made.`);
} finally { await db.close(); }
