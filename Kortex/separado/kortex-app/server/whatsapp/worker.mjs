// Run beside the existing Evolution service with private server env; not in the browser.
import { clients, checked, connectionState, importHistory, locked } from './service.mjs';
import { evolution } from './evolution.mjs';
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
do {
  try { await cycle(); } catch { console.error(JSON.stringify({ code: 'WA_WORKER_RETRY' })); if (once) process.exitCode = 1; }
  if (once || stopping) break;
  await new Promise(resolve => setTimeout(resolve, 15000));
} while (!stopping);
