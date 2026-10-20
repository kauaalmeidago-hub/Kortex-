export function qrImage(value) {
  return typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length < 300000 ? value : null;
}
export const statusRank = value => ({ PENDING: 0, SERVER_ACK: 1, DELIVERY_ACK: 2, READ: 3, PLAYED: 4 }[value] ?? (Number.isInteger(value) && value >= 0 && value <= 4 ? value : 0));
export function normalizeMessage(raw) {
  const key = raw?.key;
  if (!key?.id || !/^[^\s@]+@(s\.whatsapp\.net|g\.us|lid)$/.test(key.remoteJid ?? '')) return null;
  let m = raw.message ?? {};
  for (let i = 0; i < 3; i++) m = m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m.documentWithCaptionMessage?.message ?? m;
  const kind = m.imageMessage ? 'image' : m.documentMessage ? 'document' : m.audioMessage ? 'audio' : m.videoMessage ? 'video' : 'text';
  const media = m[`${kind}Message`];
  const timestamp = Number(raw.messageTimestamp?.low ?? raw.messageTimestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() / 1000 + 86400) return null;
  return {
    provider_id: String(key.id), remote_jid: key.remoteJid, participant: key.participant ?? null,
    from_me: Boolean(key.fromMe), name: key.remoteJid.endsWith('@g.us') ? null : raw.pushName,
    body: m.conversation ?? m.extendedTextMessage?.text ?? media?.caption ?? (kind === 'text' ? '[Tipo de mensagem não suportado]' : ''),
    kind, sent_at: new Date(timestamp * 1000).toISOString(), status_rank: statusRank(raw.status),
    quoted_id: (media?.contextInfo ?? m.extendedTextMessage?.contextInfo)?.stanzaId ?? null,
    media_name: media?.fileName ?? null, media_mime: media?.mimetype ?? null,
    media_size: Number(media?.fileLength?.low ?? media?.fileLength) || null,
    provider_key: { id: String(key.id), remoteJid: key.remoteJid, fromMe: Boolean(key.fromMe), ...(key.participant ? { participant: key.participant } : {}) },
  };
}
export function normalizeEvent(payload, allowGroups = false) {
  const type = String(payload.event ?? '').replace(/[._]/g, '-').toLowerCase();
  const data = Array.isArray(payload.data) ? payload.data : [payload.data];
  const messages = ['messages-upsert', 'messages-set', 'send-message', 'import'].includes(type)
    ? data.map(normalizeMessage).filter(m => m && (allowGroups || !m.remote_jid.endsWith('@g.us'))) : [];
  const receipts = type === 'messages-update' ? data.flatMap(r => {
    const id = r?.keyId ?? r?.key?.id ?? r?.id;
    return id ? [{ id: String(id), rank: statusRank(r.status ?? r.update?.status) }] : [];
  }) : [];
  const chats = ['chats-upsert', 'chats-update', 'chats-set', 'contacts-upsert', 'contacts-update', 'contacts-set'].includes(type) ? data.flatMap(c => {
    const jid = c?.remoteJid ?? c?.id;
    if (!/^[^\s@]+@(s\.whatsapp\.net|g\.us|lid)$/.test(jid ?? '') || (!allowGroups && jid.endsWith('@g.us'))) return [];
    return [{ remote_jid: jid, name: c.name ?? c.pushName ?? c.subject ?? null }];
  }) : [];
  return { type, messages, receipts, chats };
}
