import { HttpError } from '../server/whatsapp/core.mjs';
import { clients, checked, signup, identity, resolveConnection, connectionState, publicConnection, setOnboardingCookie, rateLimit } from '../server/whatsapp/service.mjs';
import { conversation, send, markRead, media } from '../server/whatsapp/chat.mjs';
import { evolution } from '../server/whatsapp/evolution.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const action = String(req.query.action || 'status');
    if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, 'METHOD', 'Método não permitido.');
    if (req.method === 'GET' && !['status', 'conversations', 'messages', 'media'].includes(action)) throw new HttpError(405, 'METHOD', 'Use POST para esta operação.');
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
    if (['prepare', 'renew', 'activate'].includes(action)) await rateLimit(admin, 'pairing:' + who.user.id, 12, 60);
    const c = await resolveConnection(req, admin, auth, who, ['prepare', 'renew', 'activate'].includes(action));
    if (['status', 'prepare', 'renew', 'activate'].includes(action)) {
      const updated = c ? await connectionState(admin, c, action !== 'status', action === 'renew') : null;
      if (!who.temporary && updated?.state === 'connected') await checked(admin.from('wa_connections').update({ onboarding_required: false }).eq('id', updated.id));
      if (!who.temporary && c) setOnboardingCookie(res, null);
      return res.status(200).json(updated ? publicConnection(updated, who.temporary) : { id: null, state: 'disconnected' });
    }
    if (who.temporary || !c?.activated_at) throw new HttpError(403, 'AUTH_REQUIRED', 'Confirme o e-mail e entre para acessar o Chat.');
    await rateLimit(admin, 'chat:' + who.user.id, 240, 60);
    const b = req.body ?? {};
    if (action === 'conversations') return res.status(200).json(await checked(admin.from('wa_conversations').select('*').eq('connection_id', c.id).order('last_message_at', { ascending: false, nullsFirst: false }).limit(250)));
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
      const cv = await conversation(admin, c, b.conversationId);
      if (!['active', 'pending', 'resolved'].includes(b.status)) throw new HttpError(400, 'STATUS', 'Situação inválida.');
      await checked(admin.from('wa_conversations').update({ status: b.status }).eq('id', cv.id).eq('connection_id', c.id));
      return res.status(200).json({ saved: true });
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
