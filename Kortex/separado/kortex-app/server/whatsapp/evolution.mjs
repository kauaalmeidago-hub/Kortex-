import { HttpError } from './core.mjs';
import { relayRequest } from './relay.mjs';

export function providerHttpConfig(env = process.env) {
  const url = env.EVOLUTION_API_URL || env.EVOLUTION_API_BASE_URL;
  if (!url || !env.EVOLUTION_API_KEY)
    throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', 'A conexão do WhatsApp aguarda a configuração do servidor de pareamento.');
  const base = new URL(url);
  const loopback = env.WHATSAPP_LOCAL_WORKER === 'true' && base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !loopback) || base.username || base.password || base.search || base.hash)
    throw new HttpError(503, 'PROVIDER_HTTPS_REQUIRED', 'O serviço de pareamento precisa de um endereço HTTPS.');
  const origin = env.EVOLUTION_REQUEST_ORIGIN;
  if (origin && new URL(origin).origin !== origin) throw new HttpError(503, 'PROVIDER_ORIGIN', 'Confira a origem autorizada no servidor de pareamento.');
  return { base: base.toString().replace(/\/$/, ''), key: env.EVOLUTION_API_KEY, origin };
}
// Contracts verified against the official 2.3.7 tag. Fail closed for other versions.
export function evolutionConfig(env = process.env) {
  if (!env.EVOLUTION_WEBHOOK_SECRET || !env.WHATSAPP_WEBHOOK_URL)
    throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', 'A conexão do WhatsApp aguarda a configuração do servidor de pareamento.');
  const webhook = new URL(env.WHATSAPP_WEBHOOK_URL);
  if (webhook.protocol !== 'https:' || webhook.username || webhook.password)
    throw new HttpError(503, 'PROVIDER_HTTPS_REQUIRED', 'O serviço de pareamento precisa de um endereço HTTPS.');
  const relay = env.WHATSAPP_EVOLUTION_TRANSPORT === 'relay';
  return { ...(relay ? {} : providerHttpConfig(env)), relay,
    secret: env.EVOLUTION_WEBHOOK_SECRET, webhook: webhook.toString() };
}
export async function evolution(path, body, method = body === undefined ? 'GET' : 'POST', env = process.env) {
  if (env.WHATSAPP_EVOLUTION_TRANSPORT === 'relay') return relayRequest(path, body, method, env);
  const c = providerHttpConfig(env);
  let response;
  try { response = await fetch(c.base + path, { method, headers: { apikey: c.key, 'Content-Type': 'application/json', ...(c.origin ? { Origin: c.origin } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'O servidor do WhatsApp não respondeu. Tente novamente em instantes.'); }
  if (!response.ok) throw new HttpError(response.status === 404 ? 404 : 502, 'PROVIDER_REJECTED', 'Não foi possível concluir a operação com o WhatsApp.');
  return response.json();
}
export async function verifyVersion() {
  const d = await evolution('/');
  if (String(d.version).replace(/^v/, '') !== '2.3.7')
    throw new HttpError(503, 'PROVIDER_VERSION', 'A versão do servidor de pareamento precisa ser validada pela administração.');
}
export function createInstanceBody(name, env = process.env) {
  const c = evolutionConfig(env);
  return { instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: env.WHATSAPP_ENABLE_GROUPS !== 'true',
    readMessages: false, readStatus: false, alwaysOnline: false, syncFullHistory: false,
    webhook: { enabled: true, url: c.webhook, byEvents: false, base64: false, headers: { 'x-kortex-webhook-secret': c.secret },
      events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_SET', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CHATS_UPSERT', 'CHATS_UPDATE', 'CHATS_SET', 'CONTACTS_UPSERT', 'CONTACTS_UPDATE', 'CONTACTS_SET'] } };
}
