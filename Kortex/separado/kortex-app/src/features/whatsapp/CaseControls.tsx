import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRightLeft, ChevronDown, X } from 'lucide-react';
import { waRequest, type WaConversation, type WaDestination, type WaPhase, type WaScope } from '@/features/whatsapp/api';

const phaseLabels: Record<WaPhase, string> = { triage: 'Triagem', active: 'Em atendimento', pending: 'Pendentes', resolved: 'Resolvidos' };
export type CaseCommand = 'claim' | 'pending' | 'resolve' | 'triage' | 'reopen' | 'new';
export function PhaseControl({ conversation, onMove, onNew }: { conversation: WaConversation; onMove: (phase: WaPhase) => void; onNew?: () => void }) {
  const [open, setOpen] = useState(false);
  return <div className="inbox-phase-control">
    <button className="inbox-phase-trigger" onClick={() => setOpen(value => !value)} aria-haspopup="menu" aria-expanded={open} aria-label={`Alterar fase: ${phaseLabels[conversation.status]}`}>
      {phaseLabels[conversation.status]} <ChevronDown size={12} />
    </button>
    {open && <><button className="inbox-menu-dismiss" aria-label="Fechar menu de fases" onClick={() => setOpen(false)} />
      <div className="inbox-phase-menu" role="menu" aria-label="Fases do atendimento">
        {(['triage', 'active', 'pending', 'resolved'] as const).map(phase => <button role="menuitem" key={phase}
          disabled={!conversation.case_id || phase === conversation.status || (phase === 'active' ? !conversation.can_claim || !['triage', 'pending'].includes(conversation.status) : !conversation.can_manage || phase === 'pending' && conversation.status !== 'active')}
          onClick={() => { setOpen(false); onMove(phase); }}>{phase === 'active' ? 'Assumir atendimento' : phaseLabels[phase]}</button>)}
        {conversation.status === 'resolved' && onNew && <button role="menuitem" disabled={!conversation.can_manage} onClick={() => { setOpen(false); onNew(); }}>Novo pedido nesta conversa</button>}
      </div></>}
  </div>;
}

function CaseDialog({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return <Dialog.Root open onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="inbox-case-overlay" />
    <Dialog.Content className="inbox-case-dialog">
      <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
      <Dialog.Description className="mb-5 mt-2 text-sm text-muted-foreground">{description}</Dialog.Description>
      <Dialog.Close className="inbox-case-close" aria-label="Fechar"><X size={18} /></Dialog.Close>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function CaseActionDialog({ conversation, action, scope, onClose, onChanged }: {
  conversation: WaConversation; action: CaseCommand; scope?: WaScope; onClose: () => void; onChanged: () => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sending = useRef(false);
  const titles: Record<CaseCommand, string> = { claim: 'Assumir atendimento', pending: 'Marcar como pendente', resolve: 'Resolver atendimento', triage: 'Devolver à triagem', reopen: 'Retomar o mesmo pedido', new: 'Novo pedido nesta conversa' };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try {
      await waRequest('case-action', { scope, body: { caseId: conversation.case_id, version: conversation.case_version, action, reason } });
      await onChanged(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível alterar o atendimento.'); await onChanged(); }
    finally { sending.current = false; setBusy(false); }
  };
  return <CaseDialog title={titles[action]} description={action === 'claim' ? 'Você será o responsável exclusivo por este atendimento.' : action === 'triage' ? 'O atendimento volta à fila de triagem. O KOA só atua quando estiver configurado e habilitado no canal.' : 'A alteração ficará registrada no histórico do atendimento.'} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <p className="mb-4 text-sm font-medium">{conversation.name}</p>
      {action !== 'claim' && <label className="inbox-case-field">{action === 'resolve' ? 'Conclusão e providências realizadas' : 'Motivo e próxima providência'}
        <textarea required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} rows={3} />
      </label>}
      {action === 'resolve' && <label className="my-4 flex gap-2 text-sm"><input type="checkbox" required />Confirmo que o pedido foi concluído e não há envio aguardando confirmação.</label>}
      {error && <p role="alert" className="my-3 text-sm text-destructive">{error}</p>}
      <div className="inbox-case-footer"><button type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="inbox-case-primary" disabled={busy || !conversation.case_id}>{busy ? 'Salvando...' : titles[action]}</button></div>
    </form>
  </CaseDialog>;
}

export function TransferDialog({ conversation, scope, onClose, onChanged }: { conversation: WaConversation; scope?: WaScope; onClose: () => void; onChanged: (conversationId?: string) => Promise<unknown> }) {
  const [destinations, setDestinations] = useState<WaDestination[]>([]), [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState(''), [requestType, setRequestType] = useState(conversation.request_type || '');
  const [summary, setSummary] = useState(conversation.summary || ''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const sending = useRef(false);
  const workspaceId = scope?.workspaceId, sectorId = scope?.sectorId;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    if (!conversation.case_id) { setLoading(false); setError('Este atendimento ainda não possui um caso persistido.'); return; }
    void waRequest<WaDestination[]>('case-destinations', { scope: workspaceId && sectorId ? { workspaceId, sectorId } : undefined, query: { caseId: conversation.case_id }, signal: controller.signal })
      .then(rows => { if (!controller.signal.aborted) setDestinations(rows.filter(row => row.userId !== conversation.claimed_by || row.channelId !== conversation.connection_id).sort((a,b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100))); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Não foi possível carregar os destinos.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [conversation.case_id, conversation.claimed_by, conversation.connection_id, workspaceId, sectorId, attempt]);
  const selected = choice === '' ? undefined : destinations[Number(choice)], crossChannel = Boolean(selected && selected.channelId !== conversation.connection_id);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (sending.current || !selected || choice === '') return;
    sending.current = true; setBusy(true); setError('');
    try {
      const result = await waRequest<{ conversationId?: string }>('case-action', { scope, body: { caseId: conversation.case_id, version: conversation.case_version, action: 'transfer',
        userId: selected.userId, channelId: selected.channelId, sectorId: selected.sectorId, requestType, summary, reason } });
      await onChanged(result.conversationId); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível encaminhar o atendimento.'); await onChanged(); }
    finally { sending.current = false; setBusy(false); }
  };
  return <CaseDialog title="Transferir conversa" description="Encaminhe o atendimento com contexto para um responsável autorizado." onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <p className="mb-4 text-sm font-medium">{conversation.name} · {phaseLabels[conversation.status]}</p>
      {loading ? <p role="status" className="text-sm">Carregando destinos autorizados...</p> : <>
        <label className="inbox-case-field">Setor, responsável e canal de continuidade
          <select required value={choice} onChange={event => setChoice(event.target.value)}><option value="">Selecione o destino</option>
            {destinations.map((row, index) => <option key={`${row.channelId}:${row.sectorId}:${row.userId}`} value={index} disabled={row.channelId !== conversation.connection_id && !row.connected}>{row.sector} · {row.name} · Canal {row.channelOwner}{!row.connected ? ' (desconectado)' : ''}</option>)}
          </select>
        </label>
        {!destinations.length && <p className="my-3 text-sm text-muted-foreground">Não há outro destino autorizado. Vincule as contas e os canais em Configurações/Atendimento.</p>}
        <label className="inbox-case-field">Tipo de pedido<input required minLength={2} maxLength={120} value={requestType} onChange={event => setRequestType(event.target.value)} /></label>
        <label className="inbox-case-field">Resumo e informações coletadas<textarea required minLength={3} maxLength={6000} rows={3} value={summary} onChange={event => setSummary(event.target.value)} /></label>
        <label className="inbox-case-field">Motivo e pendências<textarea required minLength={3} maxLength={1000} rows={2} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <p className="my-3 text-xs text-muted-foreground">{crossChannel ? 'A origem será preservada. O destino deverá assumir e enviar a mensagem de continuidade pelo próprio canal, explicando a mudança ao cliente. A continuidade ficará pendente até o envio ser confirmado.' : 'O destino receberá o resumo na Triagem. A fase Em atendimento só começa quando ele assumir.'}</p>
      </>}
      {error && <div role="alert" className="my-3 text-sm text-destructive">{error}<button type="button" className="ml-2 underline" onClick={() => setAttempt(value => value + 1)}>Atualizar destinos</button></div>}
      <div className="inbox-case-footer"><button type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="inbox-case-primary" disabled={busy || loading || choice === '' || !conversation.can_manage}><ArrowRightLeft size={15} />{busy ? 'Transferindo...' : 'Confirmar transferência'}</button></div>
    </form>
  </CaseDialog>;
}

export function CaseSummary({ conversation }: { conversation: WaConversation }) {
  const [history, setHistory] = useState<{ id: string; action: string; reason: string; created_at: string }[]>();
  const [historyError, setHistoryError] = useState('');
  const historyScope = useRef(conversation.case_id); historyScope.current = conversation.case_id;
  const loadHistory = async () => {
    if (!conversation.case_id) return;
    const id = conversation.case_id;
    try {
      const events = await waRequest<{ id: string; action: string; reason: string; created_at: string }[]>('case-history', { query: { caseId: id } });
      if (historyScope.current === id) { setHistory(events); setHistoryError(''); }
    } catch { if (historyScope.current === id) setHistoryError('Não foi possível carregar as movimentações.'); }
  };
  const state = { manual: 'Aguardando triagem humana', analyzing: 'Em análise', waiting_customer: 'Aguardando informação do cliente', ready: 'Pronto para atendimento humano' }[conversation.triage_state || 'manual'];
  return <details key={conversation.case_id} className="inbox-case-summary" onToggle={event => { if (event.currentTarget.open) void loadHistory(); }}><summary>{conversation.assignee_name ? `Responsável: ${conversation.assignee_name}` : 'Sem responsável'} · {conversation.status === 'triage' ? state : phaseLabels[conversation.status]}</summary>
    <p>Canal de continuidade: {conversation.channel_label || conversation.sector_name || 'Canal autorizado'}</p>
    {conversation.summary && <p>{conversation.summary}</p>}
    {conversation.pending_reason && <p>Pendência / providência: {conversation.pending_reason}</p>}
    {conversation.continuity_pending && <p>A continuidade pelo novo canal ainda aguarda envio confirmado. Informe a mudança ao cliente na primeira mensagem.</p>}
    {conversation.needs_review && <p>Há nova mensagem após a resolução. Confira se é continuação deste pedido antes de reabrir.</p>}
    {history?.map(item => <p key={item.id}>{new Date(item.created_at).toLocaleString('pt-BR')} · {({ claim: 'Assumiu o atendimento', pending: 'Marcou pendência', resolve: 'Resolveu', triage: 'Devolveu à triagem', transfer: 'Encaminhou', reopen: 'Retomou o pedido', new: 'Registrou novo pedido' }[item.action] || 'Movimentação')} · {item.reason}</p>)}
    {historyError && <p role="alert">{historyError}</p>}
  </details>;
}
