import { HttpError } from './core.mjs';
import { checked } from './service.mjs';

export async function caseRpc(auth, name, args) {
  const { data, error } = await auth.rpc(name, args);
  if (!error) return data;
  const errors = {
    CASE_CHANGED: 'Este atendimento mudou em outra sessão. Atualize antes de tentar novamente.',
    CASE_CLAIMED: 'Outro atendente já assumiu este atendimento.', ASSIGNEE_ONLY: 'Somente o destinatário ou a supervisão pode assumir ou encaminhar.',
    CLAIM_REQUIRED: 'Assuma o atendimento antes de enviar mensagens ou alterar esta fase.',
    CLAIM_UNAVAILABLE: 'Este atendimento não pode ser assumido neste momento.',
    REASON_REQUIRED: 'Informe o motivo ou a conclusão do atendimento.',
    TRANSFER_CONTEXT_REQUIRED: 'Informe o tipo de pedido, o resumo e o motivo do encaminhamento.',
    DESTINATION_FORBIDDEN: 'O destino não está autorizado para este canal e organização.',
    DESTINATION_OFFLINE: 'O canal de destino está desconectado. A conversa original foi preservada.',
    DESTINATION_HAS_CONVERSATION: 'Já existe uma conversa nesse canal. A supervisão precisa conferir o vínculo para evitar misturar pedidos.',
    SEND_UNCERTAIN: 'Há um envio sem confirmação. Confira o resultado antes de movimentar o atendimento.',
  };
  const code = Object.keys(errors).find(c => error.message?.includes(c));
  if (code) throw new HttpError(error.code === '42501' ? 403 : error.code === '22023' ? 400 : 409, code, errors[code]);
  if (error.code === '42501') throw new HttpError(403, 'SCOPE_FORBIDDEN', 'Este atendimento não está disponível para sua conta.');
  throw new HttpError(503, 'CASES_UNAVAILABLE', 'Não foi possível atualizar os atendimentos. Tente novamente.');
}
export async function caseConnection(req, admin, auth) {
  const messageId = req.query.messageId;
  let id = req.body?.conversationId || req.query.conversationId;
  if (messageId) {
    // User-scoped SELECT applies message RLS before deriving its channel.
    const { data, error } = await auth.from('wa_messages').select('conversation_id').eq('id', messageId).maybeSingle();
    if (error) throw new HttpError(403, 'SCOPE_FORBIDDEN', 'Arquivo não disponível para sua conta.');
    id = data?.conversation_id;
  }
  if (!id || !await caseRpc(auth, 'wa_can_read_conversation', { p_conversation: id }))
    throw new HttpError(403, 'SCOPE_FORBIDDEN', 'Conversa não disponível para sua conta.');
  const cv = await checked(admin.from('wa_conversations').select('connection_id').eq('id', id).single());
  const channel = await checked(admin.from('wa_connections').select('*').eq('id', cv.connection_id).single());
  return { ...channel, reserveMessage: (requestId, contentHash) => caseRpc(auth, 'wa_case_send_begin', { p_conversation: id, p_request: requestId, p_hash: contentHash }) };
}
export async function caseAction(req, auth) {
  const b = req.body || {};
  if (!/^[\da-f-]{36}$/i.test(b.caseId || '') || !Number.isSafeInteger(b.version) || b.version < 1)
    throw new HttpError(400, 'INVALID_CASE', 'Atualize o atendimento antes de continuar.');
  return caseRpc(auth, 'wa_case_change', {
    p_case: b.caseId, p_version: b.version, p_action: String(b.action || ''), p_reason: String(b.reason || ''),
    p_target: b.userId || null, p_channel: b.channelId || null, p_sector: b.sectorId || null,
    p_summary: String(b.summary || ''), p_type: String(b.requestType || ''),
  });
}
