// Run beside the existing Evolution service with private server env; not in the browser.
import { clients, checked, connectionState, importHistory, locked } from './service.mjs';
import { evolution } from './evolution.mjs';
import { db, relayBatch, workerId, RELAY_BUCKET } from './relay.mjs';
const relay = process.argv.includes('--relay');
const check = process.argv.includes('--check');
if (relay) {
  // Only this local process may use HTTP to its own loopback address. The
  // platform never receives the Evolution key or connects to a private URL.
  process.env.WHATSAPP_EVOLUTION_TRANSPORT = 'direct';
  process.env.WHATSAPP_LOCAL_WORKER = 'true';
}
const once = process.argv.includes('--once');
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
async function cycle() {
  const { admin } = clients();
  const connections = await checked(admin.from('wa_connections').select('*').not('activated_at', 'is', null).order('updated_at').limit(100));
  for (const c of connections) {
    if (stopping) break;
    try {
      const current = await connectionState(admin, c);
      if (current.state === 'connected') await importHistory(admin, current);
    } catch { console.error(JSON.stringify({ code: 'WA_RECOVERY_RETRY', connectionId: c.id })); }
  }
  // Only abandoned, never activated instances; retain a seven-day recovery window.
  const old = await checked(admin.from('wa_connections').select('*').is('activated_at', null).lt('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).limit(20));
  for (const c of old) {
    await locked(admin, c, async () => {
      const pending = await checked(admin.from('wa_connections').select('id').eq('id', c.id).is('activated_at', null).maybeSingle());
      if (!pending) return c;
      try { await evolution('/instance/delete/' + c.instance_name, undefined, 'DELETE'); }
      catch (e) { if (e.status !== 404) return c; }
      await checked(admin.from('wa_connections').delete().eq('id', c.id).is('activated_at', null));
      await checked(admin.from('wa_onboarding').delete().eq('user_id', c.owner_id));
      return c;
    });
  }
  await checked(admin.from('wa_rate_limits').delete().lt('window_at', new Date(Date.now() - 86400000).toISOString()));
  await checked(admin.from('wa_signup_reservations').delete().lt('expires_at', new Date().toISOString()));
  await checked(admin.from('wa_onboarding').delete().lt('expires_at', new Date(Date.now() - 7 * 86400000).toISOString()));
}
let admin, version, lastRecovery = 0, lastHeartbeat = 0, recovering;
async function heartbeat(state = 'ready') {
  if (state === 'ready') {
    const provider = await evolution('/');
    if (String(provider.version).replace(/^v/, '') !== '2.3.7') throw Object.assign(new Error('Unsupported version'), { code: 'PROVIDER_VERSION' });
  }
  await db(admin.rpc('wa_provider_heartbeat', { p_worker: workerId(), p_state: state, p_version: version }));
  lastHeartbeat = Date.now();
}
async function cleanRelay() {
  const old = await db(admin.from('wa_provider_jobs').select('id,worker_id').eq('worker_id', workerId())
    .in('state', ['succeeded', 'failed', 'uncertain', 'canceled']).lt('created_at', new Date(Date.now() - 600000).toISOString()).limit(30));
  if (old.length) {
    await db(admin.storage.from(RELAY_BUCKET).remove(old.map(j => `${j.worker_id}/${j.id}/result.json`)));
    await db(admin.from('wa_provider_jobs').delete().in('id', old.map(j => j.id)).eq('worker_id', workerId()));
  }
}
async function main() {
  try {
    if (relay || check) {
      admin = clients().admin;
      const provider = await evolution('/');
      version = String(provider.version).replace(/^v/, '');
      if (version !== '2.3.7') throw Object.assign(new Error('Unsupported version'), { code: 'PROVIDER_VERSION' });
      // Validate the queue migration before claiming readiness.
      await db(admin.from('wa_provider_jobs').select('id').limit(0));
      if (check) await db(admin.from('wa_provider_workers').select('id').eq('id', workerId()).maybeSingle());
      else await heartbeat();
      console.log(JSON.stringify({ code: check ? 'WA_WORKER_CHECK_OK' : 'WA_WORKER_READY', worker: workerId(), version }));
      if (check) return;
    }
    do {
      try {
        if (relay) {
          if (Date.now() - lastHeartbeat > 10000) await heartbeat();
          await relayBatch(admin, evolution);
        }
        if (!relay) await cycle();
        else if (!recovering && Date.now() - lastRecovery > 15000) {
          lastRecovery = Date.now();
          // History recovery must not block new pairing requests behind a
          // long import or a slow provider media operation.
          recovering = cycle().then(cleanRelay).catch(error => {
            console.error(JSON.stringify({ code: 'WA_RECOVERY_RETRY', reason: error.code || 'UNAVAILABLE' }));
          }).finally(() => { recovering = null; });
        }
      } catch (error) {
        console.error(JSON.stringify({ code: 'WA_WORKER_RETRY', reason: error.code || 'UNAVAILABLE' }));
        if (relay) await heartbeat('offline').catch(() => {});
        if (once) process.exitCode = 1;
        if (!once && !stopping) await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (once || stopping) break;
      await new Promise(resolve => setTimeout(resolve, relay ? 250 : 15000));
    } while (!stopping);
  } catch (error) {
    console.error(JSON.stringify({ code: 'WA_WORKER_START_FAILED', reason: error.code || 'CONFIGURATION' }));
    process.exitCode = 1;
  } finally {
    if (recovering) await recovering;
    if (relay && admin && !check) await heartbeat('offline').catch(() => {});
  }
}
await main();
