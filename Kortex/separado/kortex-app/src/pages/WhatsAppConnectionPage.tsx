import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useWhatsAppScope, whatsappQueryKey } from '@/features/whatsapp/useInbox';
import ConnectionModal, { connectionLabels } from '@/features/whatsapp/ConnectionModal';
import { WaConnection, waRequest } from '@/features/whatsapp/api';
import ChannelAccess from '@/features/whatsapp/ChannelAccess';

export default function WhatsAppConnectionPage() {
  const { user, workspace, workspaces, setWorkspace } = useAuth();
  const sectors = useWhatsAppScope();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const connection = useQuery({ queryKey: [...whatsappQueryKey(user?.id, sectors.scope), 'connection'], enabled: Boolean(sectors.scope), queryFn: ({ signal }) => waRequest<WaConnection>('status', { scope: sectors.scope, signal }), retry: false });
  return <div className="h-full overflow-auto p-6">
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/inbox" className="text-sm text-primary underline">Voltar para o Chat</Link>
      <h1 className="text-xl font-semibold">Conexão do WhatsApp</h1>
      <p className="text-sm text-muted-foreground">Conecte sua conta para atender as conversas do setor autorizado.</p>
      {workspaces.length > 1 && <label className="block text-sm">Organização<select className="task-select ml-3 max-w-full" aria-label="Organização do atendimento" value={workspace?.id || ''} onChange={event => { const next = workspaces.find(row => row.id === event.target.value); if (next) setWorkspace(next); }}><option value="">Selecione uma organização</option>{workspaces.map(row => <option key={row.id} value={row.id}>{row.name} · {row.owner_id === user?.id ? 'Pessoal' : 'Equipe'}</option>)}</select></label>}
      <label className="block text-sm">Setor<select className="task-select ml-3 max-w-full" aria-label="Setor do WhatsApp" value={sectors.current ? `${sectors.current.workspace_id}:${sectors.current.sector_id}` : ''} onChange={e => sectors.select(e.target.value)}><option value="">Selecione um setor</option>{sectors.options.map(c => <option key={`${c.workspace_id}:${c.sector_id}`} value={`${c.workspace_id}:${c.sector_id}`}>{c.workspace_name} · {c.sector_name}</option>)}</select></label>
      <section className="rounded-2xl border border-border bg-card p-5">
        <p role="status" className="text-sm">{connection.isFetching ? 'Consultando conexão...' : connection.data ? connectionLabels[connection.data.state] : 'Selecione um setor para continuar.'}</p>
        {connection.data?.phone && <p className="mt-2 text-sm text-muted-foreground">Número: {connection.data.phone}</p>}
        {(error || connection.error || sectors.error) && <p role="alert" className="mt-3 text-sm text-destructive">{error || connection.error?.message || sectors.error}</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="wa-primary !mt-0" disabled={!sectors.scope} onClick={() => setOpen(true)}>Conectar WhatsApp</button>
          <button className="wa-secondary" disabled={!sectors.scope} onClick={() => void connection.refetch()}>Atualizar status</button>
          <button className="wa-secondary text-destructive" disabled={connection.data?.state !== 'connected' || disconnecting} onClick={async () => {
            if (!window.confirm('Desconectar este WhatsApp? Você precisará parear novamente para atender por este número.')) return;
            setDisconnecting(true); setError('');
            try { await waRequest('disconnect', { scope: sectors.scope, body: { confirm: true } }); await connection.refetch(); }
            catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível desconectar.'); }
            finally { setDisconnecting(false); }
          }}>Desconectar WhatsApp</button>
        </div>
      </section>
      <p className="text-sm text-muted-foreground">Sair da Kortex preserva a sessão do WhatsApp. Tarefas e Pipeline podem ser utilizados sem esta conexão.</p>
      <ChannelAccess />
      <ConnectionModal key={`${sectors.scope?.workspaceId}:${sectors.scope?.sectorId}`} open={open} onOpenChange={setOpen} scope={sectors.scope} onContinue={() => { setOpen(false); void connection.refetch(); }} />
    </div>
  </div>;
}
