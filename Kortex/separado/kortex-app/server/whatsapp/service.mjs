import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { HttpError, hash, opaqueToken, publicConnection, qrImage, normalizeEvent, constantEqual } from './core.mjs';
import { evolution, evolutionConfig, createInstanceBody, verifyVersion } from './evolution.mjs';

export function clients(token) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pub = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !pub) throw new HttpError(503, 'BACKEND_NOT_CONFIGURED', 'O Chat aguarda a configuração privada deste ambiente.');
  const options = { auth: { persistSession: false, autoRefreshToken: false }, ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}) };
  return { admin: createClient(url, key, { auth: options.auth }), auth: createClient(url, pub, options) };
}
export async function checked(query) {
  const { data, error } = await query;
  if (error) throw new HttpError(500, 'DATA_UNAVAILABLE', 'Não foi possível salvar ou recuperar os dados do Chat.');
  return data;
}
export async function rateLimit(admin, key, max, seconds) {
  if (!await checked(admin.rpc('wa_rate_limit', { p_key: hash(key), p_max: max, p_seconds: seconds })))
    throw new HttpError(429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.');
}
const cookieName = '__Host-kortex-wa-onboarding';
export function onboardingCookie(req) {
  const value = String(req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  return /^[\w-]{43}$/.test(value ?? '') ? value : null;
}
export function setOnboardingCookie(res, value) {
  res.setHeader('Set-Cookie', `${cookieName}=${value || ''}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value ? 86400 : 0}`);
}
export async function identity(req, admin, auth) {
  if (req.headers.authorization) {
    const { data, error } = await auth.auth.getUser();
    if (error || !data.user?.email_confirmed_at) throw new HttpError(401, 'AUTH_REQUIRED', 'Entre novamente para abrir o Chat.');
    return { user: data.user, temporary: false };
  }
  const token = onboardingCookie(req);
  const grant = token && await checked(admin.from('wa_onboarding').select('user_id').eq('token_hash', hash(token)).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle());
  if (!grant) throw new HttpError(401, 'ONBOARDING_EXPIRED', 'Sua autorização de pareamento expirou. Confirme seu e-mail e entre para retomar.');
  return { user: { id: grant.user_id }, temporary: true };
}
export async function signup(req, res, admin, auth) {
  const b = req.body ?? {};
  const email = String(b.email ?? '').trim().toLowerCase();
  await rateLimit(admin, 'signup:ip:' + req.headers['x-vercel-forwarded-for'], 8, 3600);
  await rateLimit(admin, 'signup:email:' + email, 3, 3600);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || String(b.password ?? '').length < 6 || String(b.password).length > 128 ||
      !['financeiro', 'relacionamento', 'comercial'].includes(b.sector) || String(b.name ?? '').trim().length < 2 || String(b.name).length > 120)
    throw new HttpError(400, 'INVALID_SIGNUP', 'Confira nome, setor, e-mail e senha.');
  if (!await checked(admin.rpc('wa_signup_begin', { p_email: email, p_email_hash: hash(email) }))) {
    setOnboardingCookie(res, null);
    return { created: false, confirmationPending: true };
  }
  // Backend-generated proof distinguishes a genuine creation from GoTrue's obfuscated duplicate response.
  const nonce = opaqueToken();
  const origin = req.headers.origin;
  const result = await auth.auth.signUp({ email, password: b.password, options: { emailRedirectTo: `${origin}/auth/callback?next=%2Finbox`, data: { full_name: b.name.trim(), sector: b.sector, wa_signup_nonce: hash(nonce) } } });
  if (result.error) throw new HttpError(result.error.status === 429 ? 429 : 400, 'SIGNUP_FAILED', 'Não foi possível criar sua conta. Confira os dados ou tente entrar.');
  const id = result.data.user?.id;
  const verified = id ? await admin.auth.admin.getUserById(id) : null;
  if (!verified?.data?.user || verified.data.user.user_metadata?.wa_signup_nonce !== hash(nonce) ||
      verified.data.user.email?.toLowerCase() !== email || Date.parse(verified.data.user.created_at) < Date.now() - 120000) {
    setOnboardingCookie(res, null);
    return { created: false, confirmationPending: true };
  }
  const proof = await checked(admin.from('wa_signup_proofs').select('user_id').eq('user_id', id).eq('nonce_hash', hash(nonce)).maybeSingle());
  if (!proof) { setOnboardingCookie(res, null); return { created: false, confirmationPending: true }; }
  const token = opaqueToken();
  await checked(admin.rpc('wa_prepare_onboarding', { p_user: id, p_hash: hash(token) }));
  setOnboardingCookie(res, token);
  return { created: true, confirmationPending: !result.data.session, session: result.data.session };
}
export async function whatsappContexts(auth) {
  // Membership RLS supplies chat sectors even when no Tasks/Pipeline board is shared.
  const [sectors, workspaces] = await Promise.all([
    checked(auth.from('task_sectors').select('id,workspace_id,name').eq('active', true)),
    checked(auth.from('workspaces').select('id,name')),
  ]);
  return sectors.filter(s => workspaces.some(w => w.id === s.workspace_id)).map(s => ({
    workspace_id: s.workspace_id, sector_id: s.id, sector_name: s.name,
    workspace_name: workspaces.find(w => w.id === s.workspace_id).name,
  }));
}
export async function resolveConnection(req, admin, auth, who, create = false) {
  if (who.temporary) {
    if (!['status', 'prepare', 'renew', 'complete'].includes(req.query.action)) throw new HttpError(403, 'ONBOARDING_ONLY', 'Conecte seu WhatsApp para acessar o Chat.');
    const c = await checked(admin.from('wa_connections').select('*').eq('owner_id', who.user.id).is('activated_at', null).maybeSingle());
    if (!c) throw new HttpError(401, 'ONBOARDING_EXPIRED', 'Entre na sua conta para recuperar a conexão.');
    await rateLimit(admin, 'onboarding:' + who.user.id, 120, 300);
    return c;
  }
  const workspace = String(req.body?.workspaceId ?? req.query.workspaceId ?? '');
  const sector = String(req.body?.sectorId ?? req.query.sectorId ?? '');
  // The user-scoped RPC validates real memberships, never the editable profile sector.
  const contexts = await whatsappContexts(auth);
  if (!contexts.some(c => c.workspace_id === workspace && c.sector_id === sector))
    throw new HttpError(403, 'SCOPE_FORBIDDEN', 'Selecione um setor ao qual sua conta tem acesso.');
  let c = await checked(admin.from('wa_connections').select('*').eq('owner_id', who.user.id).eq('workspace_id', workspace).eq('sector_id', sector).not('activated_at', 'is', null).maybeSingle());
  if (!c && create) {
    const id = await checked(admin.rpc('wa_activate', { p_user: who.user.id, p_workspace: workspace, p_sector: sector }));
    c = await checked(admin.from('wa_connections').select('*').eq('id', id).single());
  }
  if (!c) return null;
  if (!await checked(auth.rpc('wa_can_access', { p_connection: c.id }))) throw new HttpError(403, 'SCOPE_FORBIDDEN', 'Esta conexão não está disponível para sua conta.');
  return c;
}
export async function locked(admin, c, work) {
  const lease = randomUUID();
  if (!await checked(admin.rpc('wa_claim', { p_id: c.id, p_token: lease }))) return c;
  // Pairing may involve several queued requests. Fence all writes and allow a
  // bounded recovery window, without holding a database transaction open.
  const previous = c.lease_token;
  c.lease_token = lease;
  try {
    const extended = await checked(admin.from('wa_connections').update({ lease_until: new Date(Date.now() + 180000).toISOString() }).eq('id', c.id).eq('lease_token', lease).select('id').maybeSingle());
    if (!extended) throw new HttpError(409, 'CONNECTION_BUSY', 'A conexão está sendo atualizada. Aguarde alguns instantes.');
    return await work();
  }
  finally { await checked(admin.from('wa_connections').update({ lease_until: null, lease_token: null }).eq('id', c.id).eq('lease_token', lease)); c.lease_token = previous; }
}
async function saveConnection(admin, c, patch) {
  return checked(admin.from('wa_connections').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', c.id).eq('lease_token', c.lease_token).select('*').single());
}
async function providerState(c) {
  return evolution('/instance/connectionState/' + encodeURIComponent(c.instance_name));
}
export async function completeOnboarding(req, res, admin, auth, c, readProvider = providerState) {
  if (!c) throw new HttpError(401, 'ONBOARDING_EXPIRED', 'Retome o cadastro desta conta.');
  const result = await locked(admin, c, async () => {
    // Recheck the single-use creation grant inside the connection lease. No
    // browser-supplied user ID, email, sector or connected flag is authority.
    const who = await identity(req, admin, auth);
    if (!who.temporary || c.owner_id !== who.user.id || c.activated_at)
      throw new HttpError(403, 'ONBOARDING_ONLY', 'Retome o cadastro desta conta.');
    if (c.state !== 'connected' || !c.phone_jid || (await readProvider(c)).instance?.state !== 'open')
      throw new HttpError(409, 'PAIRING_REQUIRED', 'Conecte seu WhatsApp antes de abrir a plataforma.');
    const account = await admin.auth.admin.getUserById(who.user.id);
    const user = account.data?.user;
    if (account.error || !user?.email || user.id !== who.user.id)
      throw new HttpError(401, 'ONBOARDING_EXPIRED', 'Entre na sua conta para continuar.');
    // WhatsApp pairing replaces the email step only for this proven new
    // account; the project's other authentication flows remain unchanged.
    const confirmed = await admin.auth.admin.updateUserById(user.id, {
      email_confirm: true, app_metadata: { ...user.app_metadata, kortex_onboarding: 'whatsapp' },
    });
    if (confirmed.error) throw new HttpError(503, 'ONBOARDING_RETRY', 'Não foi possível liberar sua conta. Tente novamente.');
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
    if (link.error || link.data?.user?.id !== user.id || !link.data?.properties?.hashed_token)
      throw new HttpError(503, 'ONBOARDING_RETRY', 'Não foi possível iniciar sua sessão. Tente novamente.');
    // Exchange the server-generated one-time token here, without emailing it
    // or placing credentials in URLs, browser history or navigation state.
    const verified = await auth.auth.verifyOtp({ type: 'email', token_hash: link.data.properties.hashed_token });
    const session = verified.data?.session;
    if (verified.error || session?.user?.id !== user.id || !session.access_token || !session.refresh_token)
      throw new HttpError(503, 'ONBOARDING_RETRY', 'Não foi possível iniciar sua sessão. Tente novamente.');
    await checked(admin.from('wa_onboarding').update({ revoked_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('token_hash', hash(onboardingCookie(req))).is('revoked_at', null));
    return { session: { access_token: session.access_token, refresh_token: session.refresh_token } };
  });
  if (!result.session) throw new HttpError(409, 'CONNECTION_BUSY', 'A conexão está sendo atualizada. Tente novamente em instantes.');
  setOnboardingCookie(res, null);
  return result;
}
export async function connectionState(admin, c, prepare = false, renew = false) {
  if (!c) return { state: 'disconnected', id: null, emailPending: false };
  return locked(admin, c, async () => {
    let current;
    try { current = await providerState(c); }
    catch (e) {
      if (e.status !== 404 || !prepare) throw e;
      await verifyVersion();
      await evolution('/instance/create', createInstanceBody(c.instance_name));
      current = await providerState(c);
    }
    if (current.instance?.state === 'open') {
      // Resolve the provider's owner JID for collision protection; never expose instance tokens.
      const instances = await evolution('/instance/fetchInstances?instanceName=' + encodeURIComponent(c.instance_name));
      const instance = instances.find?.(i => (i.name ?? i.instance?.instanceName) === c.instance_name);
      const phone = instance?.ownerJid ?? instance?.instance?.ownerJid;
      if (!phone) throw new HttpError(502, 'PROVIDER_IDENTITY_MISSING', 'Aguardando a identificação do número pelo WhatsApp.');
      const conflict = await checked(admin.from('wa_connections').select('id').eq('phone_jid', phone).neq('id', c.id).eq('state', 'connected').maybeSingle());
      if (conflict) throw new HttpError(409, 'NUMBER_ALREADY_BOUND', 'Este número já está vinculado a outra conta. Solicite o compartilhamento autorizado.');
      return saveConnection(admin, c, { state: 'connected', phone_jid: phone, qr_data: null, qr_expires_at: null });
    }
    if (!prepare) return saveConnection(admin, c, { state: current.instance?.state === 'connecting' && c.state !== 'qr' ? 'connecting' : c.state === 'connected' ? 'disconnected' : c.state });
    if (!renew && c.state === 'qr' && Date.parse(c.qr_expires_at) > Date.now()) return c;
    const qr = await evolution('/instance/connect/' + encodeURIComponent(c.instance_name));
    const image = qrImage(qr.base64);
    return saveConnection(admin, c, { state: image ? 'qr' : 'connecting', qr_data: image, qr_expires_at: image ? new Date(Date.now() + 40000).toISOString() : null });
  });
}
export async function ingest(admin, c, payload) {
  const { type, messages, receipts, chats } = normalizeEvent(payload, process.env.WHATSAPP_ENABLE_GROUPS === 'true');
  // Persist and process in one DB transaction. A failure returns non-2xx for provider retry.
  await checked(admin.rpc('wa_ingest', { p_connection: c.id, p_hash: hash(JSON.stringify({ type, data: payload.data })), p_type: type, p_messages: messages, p_receipts: receipts, p_chats: chats }));
}
export async function webhook(req, admin) {
  const config = evolutionConfig();
  if (!constantEqual(req.headers['x-kortex-webhook-secret'], config.secret)) throw new HttpError(401, 'WEBHOOK_UNAUTHORIZED', 'Evento não autorizado.');
  const payload = req.body ?? {};
  const c = await checked(admin.from('wa_connections').select('*').eq('instance_name', String(payload.instance ?? '')).maybeSingle());
  if (!c) throw new HttpError(404, 'INSTANCE_UNKNOWN', 'Instância desconhecida.');
  const type = String(payload.event).replace(/[._]/g, '-').toLowerCase();
  // Strip the provider API key before all persistence and hashing.
  const safe = { event: type, data: payload.data };
  if (type === 'connection-update') {
    // Confirm current provider state instead of trusting the arrival order of events.
    await connectionState(admin, c);
  } else if (type === 'qrcode-updated' && c.state !== 'connected') {
    const qr = qrImage(payload.data?.qrcode?.base64);
    if (qr) await checked(admin.from('wa_connections').update({ state: 'qr', qr_data: qr, qr_expires_at: new Date(Date.now() + 40000).toISOString() }).eq('id', c.id).neq('state', 'connected'));
  }
  await ingest(admin, c, safe);
}
export async function importHistory(admin, c) {
  return locked(admin, c, async () => {
    if (c.state !== 'connected') return c;
    const page = c.sync_state === 'complete' ? 1 : c.sync_page;
    const result = await evolution('/chat/findMessages/' + c.instance_name, { where: {}, page, offset: 100 });
    const records = result.messages?.records;
    if (!Array.isArray(records)) throw new HttpError(502, 'HISTORY_UNAVAILABLE', 'O servidor não retornou o histórico no formato esperado.');
    await ingest(admin, c, { event: 'import', data: records });
    return saveConnection(admin, c, { sync_page: records.length === 100 ? page + 1 : 1, sync_state: records.length === 100 ? 'syncing' : 'complete' });
  });
}
export { publicConnection };
