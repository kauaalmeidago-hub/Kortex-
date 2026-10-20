import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isolatedDatabase } from '../isolation/bootstrap.mjs';

// Isolated PostgreSQL/PGlite; no remote data or phone is used by this suite.
const db = await isolatedDatabase();
const q = (sql, params = []) => db.query(sql, params);
const one = async (sql, params = []) => (await q(sql, params)).rows[0];
async function as(user, work, role = 'authenticated') {
  await db.exec(`BEGIN;SET LOCAL ROLE ${role}`);
  try { await q("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [user ?? '', role]); const result = await work(); await db.exec('COMMIT'); return result; }
  catch (e) { await db.exec('ROLLBACK'); throw e; }
}
try {
  await db.exec('ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz');
  for (const file of ['20261020210000_whatsapp_chat.sql', '20261020211000_whatsapp_read.sql', '20261020212000_whatsapp_onboarding.sql','20261020213000_whatsapp_signup_proof.sql','20261020214000_whatsapp_cleanup_guard.sql'])
    await db.exec(await readFile(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8'));
  const a = randomUUID(), b = randomUUID();
  for (const [id, sector] of [[a, 'comercial'], [b, 'financeiro']]) await q('INSERT INTO auth.users(id,email,raw_user_meta_data,email_confirmed_at) VALUES($1,$2,$3,now())', [id, id + '@test.invalid', JSON.stringify({ full_name: 'QA', sector })]);
  const ws = (await one('SELECT id FROM public.workspaces WHERE owner_id=$1', [a])).id;
  const sector = (await one('SELECT id FROM public.task_sectors WHERE workspace_id=$1 LIMIT 1', [ws])).id;
  await q('SELECT public.wa_prepare_onboarding($1,$2)', [a, 'hash-only-test']);
  let pending = await one('SELECT * FROM public.wa_connections WHERE owner_id=$1', [a]);
  assert.equal(await as(a, async () => (await one('SELECT public.wa_onboarding_required() required')).required), true);
  assert.equal(await as(a, async () => (await one('SELECT public.wa_can_access($1) allowed', [pending.id])).allowed), false);
  for (const table of ['wa_connections', 'wa_onboarding', 'wa_events', 'wa_outbox']) {
    await assert.rejects(as(a, () => q(`SELECT * FROM public.${table}`)), e => e.code === '42501');
    await assert.rejects(as('', () => q(`SELECT * FROM public.${table}`), 'anon'), e => e.code === '42501');
  }
  console.log('PASS temporary onboarding has no direct access to QR tables, chat, tokens or outbox');
  const newUser = randomUUID(), nonce = 'a'.repeat(64);
  await q('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [newUser, newUser+'@test.invalid', JSON.stringify({full_name:'New account',sector:'comercial',wa_signup_nonce:nonce})]);
  assert.equal((await one('SELECT nonce_hash FROM public.wa_signup_proofs WHERE user_id=$1',[newUser])).nonce_hash,nonce);
  await q('UPDATE auth.users SET raw_user_meta_data=$1 WHERE id=$2',[JSON.stringify({wa_signup_nonce:'b'.repeat(64)}),newUser]);
  assert.equal((await one('SELECT nonce_hash FROM public.wa_signup_proofs WHERE user_id=$1',[newUser])).nonce_hash,nonce);
  assert.equal((await one('SELECT public.wa_signup_begin($1,$2) allowed',[newUser+'@test.invalid','existing-email-hash'])).allowed,false);
  assert.equal((await one('SELECT public.wa_signup_begin($1,$2) allowed',['new-reservation@test.invalid','new-email-hash'])).allowed,true);
  assert.equal((await one('SELECT public.wa_signup_begin($1,$2) allowed',['new-reservation@test.invalid','new-email-hash'])).allowed,false);
  console.log('PASS only auth insertion proves signup; metadata updates cannot forge proof; duplicate emails and concurrent reservations refused');
  await q('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1',[newUser]);
  const newContext=await one('SELECT workspace_id,sector_id FROM public.task_sector_members WHERE user_id=$1 LIMIT 1',[newUser]);
  const newConnection=await one('SELECT id FROM public.wa_connections WHERE owner_id=$1',[newUser]);
  await q('SELECT public.wa_claim($1,$2)',[newConnection.id,randomUUID()]);
  await assert.rejects(q('SELECT public.wa_activate($1,$2,$3)',[newUser,newContext.workspace_id,newContext.sector_id]),e=>e.code==='PT409');
  console.log('PASS activation cannot race an abandonment cleanup lease');
  const id = (await one('SELECT public.wa_activate($1,$2,$3) id', [a, ws, sector])).id;
  assert.equal(id, pending.id);
  assert.equal((await one('SELECT public.wa_activate($1,$2,$3) id', [a, ws, sector])).id, id);
  assert.equal(await as(a, async () => (await one('SELECT public.wa_onboarding_required() required')).required), true);
  assert.ok((await one('SELECT revoked_at FROM public.wa_onboarding WHERE user_id=$1', [a])).revoked_at);
  await assert.rejects(q('SELECT public.wa_activate($1,$2,$3)', [b, ws, sector]), e => e.code === '42501');
  console.log('PASS activation recovers the same instance, revokes onboarding token, rejects another sector and keeps unpaired new accounts gated');
  const m = { provider_id: 'provider-1', remote_jid: '5511@s.whatsapp.net', from_me: false, body: 'Olá', kind: 'text', sent_at: new Date().toISOString(), status_rank: 0, provider_key: { id: 'provider-1' } };
  await q('SELECT public.wa_ingest($1,$2,$3,$4,$5)', [id, 'receipt-first', 'messages-update', '[]', JSON.stringify([{ id: m.provider_id, rank: 3 }])]);
  for (const h of ['first', 'first', 'reimport']) await q('SELECT public.wa_ingest($1,$2,$3,$4,$5)', [id, h, 'messages-upsert', JSON.stringify([m]), '[]']);
  assert.equal((await one('SELECT count(*)::int n FROM public.wa_messages')).n, 1);
  assert.equal((await one('SELECT status_rank FROM public.wa_messages')).status_rank, 3);
  assert.equal((await one('SELECT unread_count FROM public.wa_conversations')).unread_count, 1);
  await q('SELECT public.wa_ingest($1,$2,$3,$4,$5)', [id, 'old-status', 'messages-update', '[]', JSON.stringify([{ id: m.provider_id, rank: 1 }])]);
  assert.equal((await one('SELECT status_rank FROM public.wa_messages')).status_rank, 3);
  console.log('PASS webhook replay and reimport deduplicate messages; receipts arriving first or late never regress read status');
  assert.equal((await as(a, () => q('SELECT * FROM public.wa_messages'))).rows.length, 1);
  assert.equal((await as(b, () => q('SELECT * FROM public.wa_messages'))).rows.length, 0);
  await assert.rejects(as(a, () => q("INSERT INTO public.wa_messages(connection_id) VALUES($1)", [id])), e => e.code === '42501');
  assert.equal((await one('SELECT public.wa_claim($1,$2) allowed', [id, randomUUID()])).allowed, true);
  assert.equal((await one('SELECT public.wa_claim($1,$2) allowed', [id, randomUUID()])).allowed, false);
  console.log('PASS RLS hides another account messages; direct writes and concurrent provider operations are refused');
  const cv = (await one('SELECT id FROM public.wa_conversations')).id;
  await q('SELECT public.wa_mark_read($1,$2,$3)', [id, cv, m.sent_at]);
  assert.equal((await one('SELECT unread_count FROM public.wa_conversations')).unread_count, 0);
  await q('SELECT public.wa_ingest($1,$2,$3,$4,$5)', [id, 'replay-after-read', 'import', JSON.stringify([m]), '[]']);
  assert.equal((await one('SELECT unread_count FROM public.wa_conversations')).unread_count, 0);
  await q('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)', ['whatsapp-private', `${id}/${a}/test-file`]);
  assert.equal((await as(a, () => q("SELECT * FROM storage.objects WHERE bucket_id='whatsapp-private'"))).rows.length, 1);
  assert.equal((await as(b, () => q("SELECT * FROM storage.objects WHERE bucket_id='whatsapp-private'"))).rows.length, 0);
  await assert.rejects(as(b, () => q('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)', ['whatsapp-private', `${id}/${b}/forged`])), e => e.code === '42501');
  await q('UPDATE public.task_sector_members SET active=false WHERE user_id=$1', [a]);
  assert.equal((await as(a, () => q('SELECT * FROM public.wa_messages'))).rows.length, 0);
  console.log('PASS read watermark survives replay; private files and membership revocation enforce the same account/sector boundary');
} finally { await db.close(); }
