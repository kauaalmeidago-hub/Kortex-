import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { waRequest } from './api';

type Channel = { id: string; label: string; state: string; role?: string; sortOrder?: number; sdrEnabled?: boolean; members: { id: string; name: string; email: string; granted: boolean; canManage: boolean }[] };
export default function ChannelAccess() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const query = useQuery({ queryKey: ['wa-channel-settings', user?.id], enabled: Boolean(user), retry: false,
    queryFn: ({ signal }) => waRequest<Channel[]>('channel-settings', { signal }) });
  const change = async (channelId: string, userId: string, granted: boolean, canManage: boolean) => {
    setBusy(`${channelId}:${userId}`); setError('');
    try { await waRequest('channel-access', { body: { channelId, userId, canManage, remove: !granted } }); await query.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível atualizar o acesso.'); }
    finally { setBusy(''); }
  };
  return <section className="rounded-2xl border border-border bg-card p-5">
    <h2 className="text-base font-semibold">Atendimento · Canais e responsáveis</h2>
    <p className="my-3 text-sm text-muted-foreground">O proprietário autoriza quem pode operar cada canal. O KOA atua somente no canal SDR habilitado e para quando um humano assume o atendimento.</p>
    {query.isLoading && <p role="status" className="text-sm">Carregando canais...</p>}
    {!query.isLoading && !query.error && !query.data?.length && <p className="text-sm text-muted-foreground">Nenhum canal próprio disponível para configurar.</p>}
    {query.data?.slice().sort((a,b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100)).map(channel => <div key={channel.id} className="mt-4 border-t border-border pt-3">
      <h3 className="text-sm font-medium">{channel.label}</h3>
      {channel.role === 'sdr' && <div className="my-3 flex flex-wrap items-center justify-between gap-3 text-sm"><span>Qualificação pelo KOA: {channel.sdrEnabled ? channel.state === 'connected' ? 'ativa' : 'habilitada, aguardando conexão do WhatsApp' : 'pausada'}</span><button className="underline text-primary" disabled={Boolean(busy)} onClick={async () => { setBusy(channel.id); setError(''); try { await waRequest('sdr-mode', { body: { channelId: channel.id, enabled: !channel.sdrEnabled } }); await query.refetch(); } catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível alterar o SDR.'); } finally { setBusy(''); } }}>{channel.sdrEnabled ? 'Pausar KOA' : 'Ativar KOA'}</button></div>}
      {!channel.members.length && <p className="mt-2 text-sm text-muted-foreground">Nenhuma outra conta confirmada nesta organização. Vincule as contas à equipe antes de conceder acesso ao canal.</p>}
      {channel.members.map(member => <div key={member.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>{member.name}<span className="block text-xs text-muted-foreground">{member.email}</span></span>
        <select aria-label={`Acesso de ${member.email} ao canal ${channel.label}`} className="task-select" disabled={Boolean(busy)} value={!member.granted ? 'none' : member.canManage ? 'manage' : 'operate'}
          onChange={e => void change(channel.id, member.id, e.target.value !== 'none', e.target.value === 'manage')}>
          <option value="none">Sem acesso</option><option value="operate">Atender pelo canal</option><option value="manage">Supervisionar o canal</option>
        </select>
      </div>)}
    </div>)}
    {(error || query.error) && <p role="alert" className="mt-3 text-sm text-destructive">{error || query.error?.message}</p>}
  </section>;
}
