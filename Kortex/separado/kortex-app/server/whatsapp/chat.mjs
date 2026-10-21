import { HttpError, hash } from './core.mjs';
import { checked, ingest } from './service.mjs';
import { evolution } from './evolution.mjs';

export async function conversation(admin, c, id) {
  const row = await checked(admin.from('wa_conversations').select('*').eq('connection_id', c.id).eq('id', id).maybeSingle());
  if (!row) throw new HttpError(404, 'CONVERSATION_UNKNOWN', 'Conversa não encontrada neste setor.');
  return row;
}
export async function send(admin, c, body, userId) {
  if (c.state !== 'connected') throw new HttpError(409, 'NOT_CONNECTED', 'Reconecte o WhatsApp para enviar mensagens.');
  const cv = await conversation(admin, c, body.conversationId);
  if (cv.remote_jid.endsWith('@g.us') && process.env.WHATSAPP_ENABLE_GROUPS !== 'true') throw new HttpError(403, 'GROUP_DISABLED', 'Atendimento em grupos não habilitado.');
  if (!/^[\da-f-]{36}$/i.test(body.requestId ?? '') || String(body.text ?? '').length > 10000)
    throw new HttpError(400, 'INVALID_MESSAGE', 'Confira o conteúdo da mensagem.');
  let quoted;
  if (body.quotedId) {
    const m = await checked(admin.from('wa_messages').select('provider_key,body').eq('connection_id', c.id).eq('conversation_id', cv.id).eq('id', body.quotedId).single());
    quoted = { key: m.provider_key, message: { conversation: m.body } };
  }
  const contentHash = hash(JSON.stringify([cv.id, body.text, body.file, body.quotedId]));
  // Reserve under the same case lock used by claim/transfer/phase changes.
  // Once dispatched, a pending/uncertain outbox prevents a contradictory move.
  const result = c.reserveMessage ? (await c.reserveMessage(body.requestId, contentHash) ? { error: null } : { error: { code: '23505' } }) :
    await admin.from('wa_outbox').insert({ connection_id: c.id, request_id: body.requestId, conversation_id: cv.id, payload_hash: contentHash });
  if (result.error) {
    if (result.error.code !== '23505') await checked(Promise.resolve(result));
    const prior = await checked(admin.from('wa_outbox').select('*').eq('connection_id', c.id).eq('request_id', body.requestId).single());
    if (prior.payload_hash !== contentHash) throw new HttpError(409, 'REQUEST_REUSED', 'Esta tentativa pertence a outro conteúdo.');
    if (prior.provider_id && prior.state !== 'sent') {
      const found = await evolution('/chat/findMessages/' + c.instance_name, { where: { key: { id: prior.provider_id, remoteJid: cv.remote_jid } }, page: 1, offset: 5 });
      const records = found.messages?.records?.filter(m => m.key?.id === prior.provider_id && m.key?.remoteJid === cv.remote_jid);
      if (records?.length) {
        await ingest(admin, c, { event: 'import', data: records });
        await checked(admin.from('wa_outbox').update({ state: 'sent' }).eq('connection_id', c.id).eq('request_id', body.requestId));
        return { state: 'sent', providerId: prior.provider_id };
      }
    }
    return { state: prior.state, providerId: prior.provider_id, uncertain: prior.state !== 'sent' };
  }
  const setOutbox = patch => checked(admin.from('wa_outbox').update(patch).eq('connection_id', c.id).eq('request_id', body.requestId));
  let response, path, payload;
  try {
    if (body.file) {
      const f = body.file;
      if (!String(f.path).startsWith(`${c.id}/${userId}/`) || String(f.path).includes('..') || !['image', 'document', 'audio', 'video'].includes(f.kind))
        throw new HttpError(400, 'INVALID_FILE', 'O arquivo não pertence a esta conexão.');
      const folder = f.path.slice(0, f.path.lastIndexOf('/')), filename = f.path.slice(f.path.lastIndexOf('/') + 1);
      const files = await checked(admin.storage.from('whatsapp-private').list(folder, { search: filename, limit: 10 }));
      const stored = files.find(x => x.name === filename);
      if (!stored || stored.metadata?.size > 20971520) throw new HttpError(400, 'FILE_UNAVAILABLE', 'Arquivo indisponível ou maior que 20 MB.');
      const signed = await checked(admin.storage.from('whatsapp-private').createSignedUrl(f.path, 120));
      path = f.kind === 'audio' ? '/message/sendWhatsAppAudio/' : '/message/sendMedia/';
      payload = f.kind === 'audio' ? { number: cv.remote_jid, audio: signed.signedUrl } :
        { number: cv.remote_jid, mediatype: f.kind, media: signed.signedUrl, mimetype: stored.metadata?.mimetype, fileName: String(f.name).slice(0, 200), caption: body.text ?? '' };
    } else {
      if (!String(body.text ?? '').trim()) throw new HttpError(400, 'EMPTY_MESSAGE', 'Digite uma mensagem.');
      path = '/message/sendText/'; payload = { number: cv.remote_jid, text: body.text };
    }
    response = await evolution(path + c.instance_name, { ...payload, ...(quoted ? { quoted } : {}) });
    if (!response.key?.id) throw new HttpError(502, 'SEND_UNCERTAIN', 'O WhatsApp ainda não confirmou o envio.');
    await setOutbox({ provider_id: response.key.id, state: 'sent' });
    await ingest(admin, c, { event: 'send-message', data: response });
    if (body.file) await checked(admin.from('wa_messages').update({ storage_path: body.file.path, media_name: body.file.name }).eq('connection_id', c.id).eq('provider_id', response.key.id));
    return { state: 'sent', providerId: response.key.id };
  } catch (error) {
    // Once a provider call starts, an HTTP error/timeout can have an uncertain outcome.
    await setOutbox({ state: path ? 'uncertain' : 'failed' });
    if (path) throw new HttpError(409, 'SEND_UNCERTAIN', 'Envio sem confirmação. Confira a conversa antes de tentar enviar novamente.');
    throw error;
  }
}
export async function markRead(admin, c, body) {
  const cv = await conversation(admin, c, body.conversationId);
  const cutoff = body.before;
  if (!cutoff || Date.parse(cutoff) > Date.now()) throw new HttpError(400, 'INVALID_READ', 'Horário de leitura inválido.');
  const messages = await checked(admin.from('wa_messages').select('provider_key').eq('connection_id', c.id).eq('conversation_id', cv.id).eq('from_me', false).lte('sent_at', cutoff).gt('sent_at', cv.last_read_at ?? '1970-01-01').order('sent_at', { ascending: false }).limit(100));
  if (messages.length) await evolution('/chat/markMessageAsRead/' + c.instance_name, { readMessages: messages.map(m => m.provider_key) });
  await checked(admin.rpc('wa_mark_read', { p_connection: c.id, p_conversation: cv.id, p_before: cutoff }));
  return { read: true };
}
export async function media(admin, c, id) {
  const m = await checked(admin.from('wa_messages').select('*').eq('connection_id', c.id).eq('id', id).single());
  if (m.kind === 'text') throw new HttpError(404, 'NO_MEDIA', 'Esta mensagem não contém um arquivo.');
  if (!m.storage_path) {
    if (m.media_size > 20971520) throw new HttpError(413, 'FILE_TOO_LARGE', 'Este arquivo excede o limite de 20 MB.');
    const response = await evolution('/chat/getBase64FromMediaMessage/' + c.instance_name, { message: { key: m.provider_key }, convertToMp4: false });
    if (typeof response.base64 !== 'string' || response.base64.length > 28000000) throw new HttpError(413, 'FILE_UNAVAILABLE', 'Não foi possível recuperar este arquivo dentro do limite de 20 MB.');
    const bytes = Buffer.from(response.base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const path = `${c.id}/received/${m.id}`;
    await checked(admin.storage.from('whatsapp-private').upload(path, bytes, { contentType: m.media_mime || 'application/octet-stream', upsert: true }));
    await checked(admin.from('wa_messages').update({ storage_path: path }).eq('id', m.id).eq('connection_id', c.id));
    m.storage_path = path;
  }
  const signed = await checked(admin.storage.from('whatsapp-private').createSignedUrl(m.storage_path, 60, { download: m.media_name || 'arquivo' }));
  return { url: signed.signedUrl };
}
