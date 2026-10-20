import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { HttpError } from './core.mjs';

export const RELAY_BUCKET = 'whatsapp-relay-private';
export function workerId(env = process.env) {
  const id = env.WHATSAPP_WORKER_ID || 'evolution-local';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new HttpError(503, 'WORKER_CONFIG', 'Confira a configuração do serviço de conexão.');
  return id;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function relayClient(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'BACKEND_NOT_CONFIGURED', 'A conexão do WhatsApp aguarda configuração.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function db(query) {
  const { data, error } = await query;
  if (error) throw new HttpError(503, 'RELAY_UNAVAILABLE', 'A conexão do WhatsApp está temporariamente indisponível.');
  return data;
}

// This is a private provider bridge, never an arbitrary HTTP proxy. Only routes
// already used by the WhatsApp service are accepted, for a managed instance.
export function providerRequest(path, body, method) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//'))
    throw new HttpError(400, 'RELAY_ROUTE', 'Operação do WhatsApp inválida.');
  const url = new URL(path, 'https://provider.invalid');
  if (url.origin !== 'https://provider.invalid' || url.hash || !['GET', 'POST', 'DELETE'].includes(method))
    throw new HttpError(400, 'RELAY_ROUTE', 'Operação do WhatsApp inválida.');
  if (path === '/' && method === 'GET') return { instance: null, safeRetry: true };
  if (url.pathname === '/instance/create' && method === 'POST' && !url.search && /^koa-[a-f0-9]{32}$/.test(body?.instanceName ?? ''))
    return { instance: body.instanceName, safeRetry: false };
  if (url.pathname === '/instance/fetchInstances' && method === 'GET' && [...url.searchParams.keys()].every(k => k === 'instanceName') &&
      url.searchParams.getAll('instanceName').length === 1 && /^koa-[a-f0-9]{32}$/.test(url.searchParams.get('instanceName') ?? ''))
    return { instance: url.searchParams.get('instanceName'), safeRetry: true };
  const match = url.pathname.match(/^\/(instance\/(?:connectionState|connect|logout|delete)|chat\/(?:findMessages|markMessageAsRead|getBase64FromMediaMessage)|message\/(?:sendText|sendMedia|sendWhatsAppAudio))\/(koa-[a-f0-9]{32})$/);
  if (!match || url.search) throw new HttpError(400, 'RELAY_ROUTE', 'Operação do WhatsApp inválida.');
  const allowed = match[1].startsWith('chat/') || match[1].startsWith('message/') ? 'POST' :
    /\/(logout|delete)$/.test(match[1]) ? 'DELETE' : 'GET';
  if (method !== allowed) throw new HttpError(400, 'RELAY_ROUTE', 'Operação do WhatsApp inválida.');
  return { instance: match[2], safeRetry: ['instance/connectionState', 'chat/findMessages', 'chat/getBase64FromMediaMessage'].includes(match[1]) };
}

export async function managedRequest(admin, path, body, method) {
  const operation = providerRequest(path, body, method);
  if (operation.instance) {
    const managed = await db(admin.from('wa_connections').select('id').eq('instance_name', operation.instance).maybeSingle());
    if (!managed) throw new HttpError(403, 'RELAY_INSTANCE', 'Esta instância não pertence à integração da plataforma.');
  }
  return operation;
}

export async function readRelayResult(admin, job) {
  if (job.state === 'failed') throw new HttpError(job.error_status === 404 ? 404 : 502, job.error_code || 'PROVIDER_REJECTED', 'Não foi possível concluir a operação com o WhatsApp.');
  if (job.state === 'uncertain') throw new HttpError(503, 'PROVIDER_RESULT_UNKNOWN', 'A operação não foi confirmada. Aguarde a atualização da conexão.');
  if (!job.result_path) return job.response;
  const expected = `${job.worker_id}/${job.id}/result.json`;
  if (job.result_path !== expected) throw new HttpError(502, 'RELAY_RESULT', 'Resposta inválida do serviço de conexão.');
  const blob = await db(admin.storage.from(RELAY_BUCKET).download(expected));
  if (blob.size > 40000000) throw new HttpError(413, 'RELAY_RESULT_SIZE', 'O arquivo excede o limite desta integração.');
  return JSON.parse(await blob.text());
}

export async function relayRequest(path, body, method, env = process.env, dependencies = {}) {
  const admin = dependencies.admin || relayClient(env);
  const now = dependencies.now || Date.now;
  const pause = dependencies.sleep || sleep;
  const operation = await managedRequest(admin, path, body, method);
  const id = workerId(env);
  const worker = await db(admin.from('wa_provider_workers').select('last_seen_at,state').eq('id', id).maybeSingle());
  if (!worker || worker.state !== 'ready' || now() - Date.parse(worker.last_seen_at) > 45000)
    throw new HttpError(503, 'PROVIDER_WORKER_OFFLINE', 'O serviço de conexão do WhatsApp está offline. A administração precisa ativá-lo para exibir o QR Code.');
  const requestId = randomUUID();
  const deadline = now() + (dependencies.timeoutMs || 25000);
  if (Buffer.byteLength(JSON.stringify(body ?? null)) > 1000000)
    throw new HttpError(413, 'RELAY_REQUEST_SIZE', 'Esta operação excede o limite da conexão.');
  await db(admin.from('wa_provider_jobs').insert({ id: requestId, worker_id: id, path, method, body: body ?? null,
    safe_retry: operation.safeRetry, expires_at: new Date(deadline).toISOString() }));
  try {
    while (now() < deadline) {
      const job = await db(admin.from('wa_provider_jobs').select('*').eq('id', requestId).single());
      if (['succeeded', 'failed', 'uncertain'].includes(job.state)) return await readRelayResult(admin, job);
      await pause(250);
    }
    throw new HttpError(503, operation.safeRetry ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_RESULT_UNKNOWN', 'O WhatsApp ainda não confirmou a operação. Tente consultar a conexão novamente em instantes.');
  } finally {
    // Cancel work not yet started; never restart a possibly completed send.
    await admin.from('wa_provider_jobs').update({ state: 'canceled' }).eq('id', requestId).eq('state', 'queued');
  }
}

export async function completeJob(admin, job, lease, patch) {
  return db(admin.rpc('wa_provider_complete', { p_id: job.id, p_token: lease, p_state: patch.state,
    p_response: patch.response ?? null, p_result_path: patch.result_path ?? null,
    p_error_status: patch.error_status ?? null, p_error_code: patch.error_code ?? null }));
}

export async function processRelayJob(admin, job, lease, transport) {
  try {
    await managedRequest(admin, job.path, job.body, job.method);
    if (!await db(admin.rpc('wa_provider_dispatch', { p_id: job.id, p_token: lease }))) return false;
    const response = await transport(job.path, job.body ?? undefined, job.method);
    const json = JSON.stringify(response);
    if (Buffer.byteLength(json) > 40000000) throw new HttpError(413, 'RELAY_RESULT_SIZE', 'Resposta muito grande.');
    const patch = { state: 'succeeded', response };
    if (Buffer.byteLength(json) > 200000) {
      const path = `${job.worker_id}/${job.id}/result.json`;
      await db(admin.storage.from(RELAY_BUCKET).upload(path, Buffer.from(json), { contentType: 'application/json', upsert: true }));
      patch.response = null; patch.result_path = path;
    }
    return await completeJob(admin, job, lease, patch);
  } catch (error) {
    // A rejected read is retryable by its caller; uncertain mutations are not replayed.
    const uncertain = !job.safe_retry && !['RELAY_ROUTE', 'RELAY_INSTANCE'].includes(error.code) && error.status !== 404;
    return completeJob(admin, job, lease, { state: uncertain ? 'uncertain' : 'failed',
      error_status: error.status || 502, error_code: error.code || 'PROVIDER_UNAVAILABLE' });
  }
}

export async function relayBatch(admin, transport, env = process.env) {
  const lease = randomUUID();
  const jobs = await db(admin.rpc('wa_provider_claim', { p_worker: workerId(env), p_token: lease, p_limit: 4 }));
  await Promise.all(jobs.map(job => processRelayJob(admin, job, lease, transport)));
  return jobs.length;
}
