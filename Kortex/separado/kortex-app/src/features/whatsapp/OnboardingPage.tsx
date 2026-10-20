import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBusinessAccess } from '@/features/access/BusinessAccess';
import ConnectionModal from './ConnectionModal';
import { waRequest } from './api';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

export default function OnboardingPage() {
  const { user, loading } = useAuth();
  const access = useBusinessAccess();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const [open, setOpen] = useState(true);
  const [connected, setConnected] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');
  const [finishAttempt, setFinishAttempt] = useState(0);
  const completing = useRef(false);
  const activating = useRef(false);
  const [choice, setChoice] = useState('');
  const sectors = access.contexts.filter((c, i, all) => all.findIndex(x => x.workspace_id === c.workspace_id && x.sector_id === c.sector_id) === i);
  const selected = sectors.find(c => c.sector_id === choice) ?? (sectors.length === 1 ? sectors[0] : null);
  const scope = selected ? { workspaceId: selected.workspace_id, sectorId: selected.sector_id } : undefined;
  const canOpen = !loading && (!user || Boolean(selected));
  useEffect(() => { if (canOpen) setOpen(true); }, [canOpen]);
  const handleConnected = async () => {
    setConnected(true);
    if (user || completing.current) return;
    completing.current = true;
    setFinishing(true); setError('');
    try {
      const result = await waRequest<{ session: { access_token: string; refresh_token: string } }>('complete', { temporary: true, body: {} });
      const restored = await supabase.auth.setSession(result.session);
      if (restored.error) throw new Error('Não foi possível abrir sua sessão. Entre com o e-mail e a senha do cadastro.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível abrir a plataforma. Tente novamente.');
      setFinishing(false);
    } finally { completing.current = false; }
  };
  // Activating uses the authenticated membership RPC, after the temporary
  // creation grant has been exchanged for this account's normal session.
  useEffect(() => {
    if (!connected || !user || loading || !selected || activating.current) return;
    activating.current = true; setFinishing(true); setError('');
    void waRequest('activate', { scope: { workspaceId: selected.workspace_id, sectorId: selected.sector_id }, body: {} }).then(() => {
      queries.removeQueries({ queryKey: ['wa-onboarding-gate', user.id] });
      navigate('/inbox', { replace: true });
    }).catch(e => {
      setError(e instanceof Error ? e.message : 'Não foi possível abrir a plataforma. Tente novamente.');
      setFinishing(false); activating.current = false;
    });
  }, [connected, user, loading, selected, queries, navigate, finishAttempt]);
  return <main className="grid min-h-[100dvh] place-items-center bg-background px-6 py-10 text-foreground">
    <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h1 className="text-xl font-semibold">{connected ? 'WhatsApp conectado' : 'Conecte seu WhatsApp'}</h1>
      <p className="my-4 text-sm leading-6 text-muted-foreground">{connected ? 'Preparando sua área de trabalho...' : 'Seu progresso fica salvo. Retome o pareamento para concluir o início da sua conta.'}</p>
      {user && !selected && <><p className="mb-3 text-sm">{access.loading ? 'Validando seus setores...' : access.error ?? 'Selecione o setor desta conexão.'}</p>
        {sectors.length > 0 && <select className="task-select w-full" value={choice} aria-label="Setor autorizado" onChange={e => setChoice(e.target.value)}><option value="">Selecione um setor</option>{sectors.map(c => <option key={`${c.workspace_id}:${c.sector_id}`} value={c.sector_id}>{c.workspace_name} · {c.sector_name}</option>)}</select>}
        {access.error && <button className="wa-secondary" onClick={access.retry}>Tentar novamente</button>}</>}
      <button className="wa-primary w-full" disabled={!canOpen || finishing} onClick={() => setOpen(true)}>Retomar conexão</button>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      <Link to="/auth/login" className="mt-5 block text-sm text-primary underline">Voltar para entrar</Link>
    </section>
    {canOpen && <ConnectionModal open={open} onOpenChange={setOpen} temporary={!user} scope={scope} onConnected={() => void handleConnected()} continuing={finishing} continueError={error} onContinue={() => {
      if (user) setFinishAttempt(n => n + 1);
      else void handleConnected();
    }} />}
  </main>;
}
