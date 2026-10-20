import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { qrImage } from './normalize.mjs';
export { qrImage, statusRank, normalizeMessage, normalizeEvent } from './normalize.mjs';

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const hash = value => createHash('sha256').update(value).digest('hex');
export const opaqueToken = () => randomBytes(32).toString('base64url');
export function constantEqual(a, b) {
  return typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
export function publicConnection(c, emailPending = false) {
  const qr = c.state === 'qr' && Date.parse(c.qr_expires_at) > Date.now() ? qrImage(c.qr_data) : null;
  const state = c.state === 'qr' && !qr ? 'expired' : c.state;
  return { id: c.id, state, qr, qrExpiresAt: qr ? c.qr_expires_at : null, emailPending,
    syncState: c.sync_state, phone: c.phone_jid?.split('@')[0] ?? null };
}
