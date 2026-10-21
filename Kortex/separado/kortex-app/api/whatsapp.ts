import { HttpError } from '../server/whatsapp/core.mjs';
import { clients, checked, signup, identity, resolveConnection, whatsappContexts, connectionState, completeOnboarding, publicConnection, setOnboardingCookie, rateLimit } from '../server/whatsapp/service.mjs';
import { conversation, send, markRead, media } from '../server/whatsapp/chat.mjs';
import { evolution } from '../server/whatsapp/evolution.mjs';
import { caseRpc, caseConnection, caseAction } from '../server/whatsapp/cases.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const action = String(req.query.action || 'status');
    if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, 'METHOD', 'Método não permitido.');
    if (req.method === 'GET' && !['status', 'contexts', 'conversations', 'messages', 'media', 'case-destinations', 'case-history', 'channel-settings'].includes(action)) throw new HttpError(405, 'METHOD', 'Use POST para esta operação.');
    // Same-origin HttpOnly onboarding cookie + explicit origin validation against configured deployment hosts.
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      const allowed = [process.env.APP_ORIGIN, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`, ...(process.env.WHATSAPP_ALLOWED_ORIGINS || '').split(',')].filter(Boolean);
      if (!origin || !allowed.includes(origin)) throw new HttpError(403, 'ORIGIN', 'Origem não autorizada.');
      if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'CONTENT_TYPE', 'Formato inválido.');
    }
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const { admin, auth } = clients(token);
    if (action === 'signup') return res.status(200).json(await signup(req, res, admin, auth));
    const who = await identity(req, admin, auth);
    await rateLimit(admin, 'connection:' + who.user.id, 300, 300);
    const caseRoutes = ['contexts', 'conversations', 'messages', 'media', 'send', 'read', 'case-action', 'case-destinations', 'case-history', 'channel-settings', 'channel-access', 'sdr-mode'];
    if (caseRoutes.includes(action) && who.temporary) throw new HttpError(403, 'ONBOARDING_ONLY', 'Conclua a conexão para abrir os atendimentos.');
    if (action === 'contexts') return res.status(200).json(await whatsappContexts(auth, admin, who.user.id));
    if (action === 'conversations') return res.status(200).json(await caseRpc(auth, 'wa_case_inbox', { p_workspace: req.query.workspaceId || null, p_phase: req.query.phase || null, p_query: String(req.query.search || '').slice(0, 200), p_selected: req.query.selectedId || null }));
    if (action === 'case-action') return res.status(200).json(await caseAction(req, auth));
    if (action === 'channel-settings') return res.status(200).json(await caseRpc(auth, 'wa_channel_settings', {}));
    if (action === 'sdr-mode') { await caseRpc(auth, 'wa_sdr_mode', { p_channel: req.body?.channelId, p_enabled: req.body?.enabled === true }); return res.status(200).json({ saved: true }); }
    if (action === 'channel-access') {
      const b = req.body || {};
      await caseRpc(auth, 'wa_channel_config', { p_channel: b.channelId, p_user: b.userId, p_manage: b.canManage === true, p_remove: b.remove === true });
      return res.status(200).json({ saved: true });
    }
    if (['case-destinations', 'case-history'].includes(action)) return res.status(200).json(await caseRpc(auth, action === 'case-history' ? 'wa_case_history' : 'wa_case_destinations', { p_case: req.query.caseId }));
    if (['prepare', 'renew', 'activate', 'complete'].includes(action)) await rateLimit(admin, 'pairing:' + who.user.id, 12, 60);
    const c = ['messages', 'media', 'send', 'read'].includes(action) ? await caseConnection(req, admin, auth) :
      await resolveConnection(req, admin, auth, who, ['prepare', 'renew', 'activate'].includes(action));
    if (action === 'complete') return res.status(200).json(await completeOnboarding(req, res, admin, auth, c));
    if (['status', 'prepare', 'renew', 'activate'].includes(action)) {
      const updated = c ? await connectionState(admin, c, action !== 'status', action === 'renew') : null;
      if (!who.temporary && updated?.state === 'connected') await checked(admin.from('wa_connections').update({ onboarding_required: false }).eq('id', updated.id));
      if (!who.temporary && c) setOnboardingCookie(res, null);
      return res.status(200).json(updated ? publicConnection(updated, who.temporary) : { id: null, state: 'disconnected' });
    }
    if (who.temporary || !c?.activated_at) throw new HttpError(403, 'AUTH_REQUIRED', 'Conecte seu WhatsApp e entre para acessar o Chat.');
    await rateLimit(admin, 'chat:' + who.user.id, 240, 60);
    const b = req.body ?? {};
    if (action === 'messages') {
      const cv = await conversation(admin, c, req.query.conversationId);
      let query = admin.from('wa_messages').select('*').eq('connection_id', c.id).eq('conversation_id', cv.id).order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(50);
      if (req.query.cursor) {
        const [date, id] = String(req.query.cursor).split('|');
        if (!Number.isFinite(Date.parse(date)) || !/^[\da-f-]{36}$/i.test(id ?? '')) throw new HttpError(400, 'CURSOR', 'Página inválida.');
        query = query.or(`sent_at.lt.${date},and(sent_at.eq.${date},id.lt.${id})`);
      }
      return res.status(200).json(await checked(query));
    }
    if (action === 'send') return res.status(200).json(await send(admin, c, b, who.user.id));
    if (action === 'read') return res.status(200).json(await markRead(admin, c, b));
    if (action === 'media') return res.status(200).json(await media(admin, c, req.query.messageId));
    if (action === 'conversation-status') {
      throw new HttpError(409, 'CASE_VERSION_REQUIRED', 'Atualize a página e use as ações do atendimento.');
    }
    if (action === 'disconnect') {
      if (b.confirm !== true) throw new HttpError(400, 'CONFIRM_REQUIRED', 'Confirme a desconexão do WhatsApp.');
      await evolution('/instance/logout/' + c.instance_name, undefined, 'DELETE');
      await checked(admin.from('wa_connections').update({ state: 'disconnected', qr_data: null, qr_expires_at: null }).eq('id', c.id));
      return res.status(200).json({ disconnected: true });
    }
    throw new HttpError(404, 'ACTION', 'Operação não encontrada.');
  } catch (error) {
    res.status(error instanceof HttpError ? error.status : 500).json({ code: error.code || 'UNAVAILABLE', error: error instanceof HttpError ? error.message : 'Não foi possível concluir a operação. Tente novamente.' });
  }
}
