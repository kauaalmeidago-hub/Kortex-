import { clients, webhook } from '../server/whatsapp/service.mjs';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  try { await webhook(req, clients().admin); res.status(200).json({ received: true }); }
  catch (error) { res.status(error.status || 503).json({ code: error.code || 'PERSISTENCE_UNAVAILABLE' }); }
}
