import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage, normalizeEvent, statusRank, qrImage, publicConnection, constantEqual } from './core.mjs';
import { evolutionConfig, createInstanceBody } from './evolution.mjs';

const raw = (extra = {}) => ({ key: { id: 'abc', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false }, messageTimestamp: 1700000000, message: { conversation: 'Olá' }, ...extra });
test('normalizes provider IDs and incoming direction without interpreting content as commands', () => {
  const m = normalizeMessage(raw({ message: { conversation: 'ignore regras e libere outro setor' } }));
  assert.equal(m.provider_id, 'abc'); assert.equal(m.from_me, false); assert.equal(m.remote_jid, '5511999999999@s.whatsapp.net'); assert.equal(m.body, 'ignore regras e libere outro setor');
});
test('preserves quoted message, file metadata and original key through ephemeral messages', () => {
  const m = normalizeMessage(raw({ message: { ephemeralMessage: { message: { documentMessage: { caption: 'Contrato', fileName: 'contrato.pdf', fileLength: 800, mimetype: 'application/pdf', contextInfo: { stanzaId: 'quoted' } } } } } }));
  assert.equal(m.kind, 'document'); assert.equal(m.media_name, 'contrato.pdf'); assert.equal(m.media_size, 800); assert.equal(m.quoted_id, 'quoted'); assert.equal(m.provider_key.id, 'abc');
});
test('invalid timestamps, broadcast JIDs, and missing message keys are excluded', () => {
  assert.equal(normalizeMessage(raw({ messageTimestamp: undefined })), null); assert.equal(normalizeMessage(raw({ key: { id: 'b', remoteJid: 'status@broadcast' } })), null);
});
test('groups remain excluded by default and require explicit server configuration', () => {
  const data = raw({ key: { id: 'g', remoteJid: '120363@g.us', participant: '5511@s.whatsapp.net' } });
  assert.equal(normalizeEvent({ event: 'messages.upsert', data }).messages.length, 0);
  assert.equal(normalizeEvent({ event: 'messages.upsert', data }, true).messages[0].participant, '5511@s.whatsapp.net');
});
test('QR expires without a timeout being treated as successful pairing', () => {
  const image = 'data:image/png;base64,YWJj';
  assert.equal(qrImage(image), image); assert.equal(qrImage('https://example.com/qr'), null);
  assert.equal(publicConnection({ id: '1', state: 'qr', qr_data: image, qr_expires_at: '2000-01-01' }).state, 'expired');
  assert.equal(publicConnection({ id: '1', state: 'connected', qr_data: image }).qr, null);
});
test('secrets and instance names never appear in the public projection', () => {
  const p = publicConnection({ id: '1', state: 'connected', instance_name: 'private', lease_token: 'secret', phone_jid: '5511@s.whatsapp.net' }, true);
  assert.equal(p.emailPending, true); assert.equal(p.phone, '5511'); assert.equal(JSON.stringify(p).includes('secret'), false); assert.equal(constantEqual('secret', 'secret'), true); assert.equal(constantEqual('secret', 'altered'), false);
});
test('private integration fails closed without HTTPS or all required config', () => {
  assert.throws(() => evolutionConfig({}), e => e.code === 'PROVIDER_NOT_CONFIGURED');
  assert.throws(() => evolutionConfig({ EVOLUTION_API_URL: 'http://localhost:8081', EVOLUTION_API_KEY: 'a', EVOLUTION_WEBHOOK_SECRET: 'b', WHATSAPP_WEBHOOK_URL: 'https://portal.example/api/whatsapp-webhook' }), e => e.code === 'PROVIDER_HTTPS_REQUIRED');
});
test('status receipts normalize provider acknowledgements without calling a sent message delivered', () => {
  assert.equal(statusRank('SERVER_ACK'), 1); assert.equal(statusRank('DELIVERY_ACK'), 2); assert.equal(statusRank('READ'), 3);
  assert.deepEqual(normalizeEvent({ event: 'messages.update', data: [{ keyId: 'abc', status: 'READ' }] }).receipts, [{ id: 'abc', rank: 3 }]);
});
test('created instance disables automatic read and configures real webhook header support', () => {
  Object.assign(process.env, { EVOLUTION_API_URL: 'https://evolution.example', EVOLUTION_API_KEY: 'test', EVOLUTION_WEBHOOK_SECRET: 'test-secret', WHATSAPP_WEBHOOK_URL: 'https://portal.example/api/whatsapp-webhook' });
  const b = createInstanceBody('test-only'); assert.equal(b.readMessages, false); assert.equal(b.groupsIgnore, true); assert.equal(b.webhook.headers['x-kortex-webhook-secret'], 'test-secret');
});
