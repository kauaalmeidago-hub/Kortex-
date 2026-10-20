import { relayClient, db, workerId } from '../../server/whatsapp/relay.mjs';
try {
  const row = await db(relayClient().from('wa_provider_workers').select('state,version,last_seen_at').eq('id', workerId()).maybeSingle());
  const ready = row?.state === 'ready' && Date.now() - Date.parse(row.last_seen_at) < 45000;
  console.log(JSON.stringify({ ready, worker: workerId(), version: row?.version, lastSeen: row?.last_seen_at }));
  process.exitCode = ready ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({ ready: false, code: error.code || 'WORKER_CONFIGURATION' }));
  process.exitCode = 1;
}
