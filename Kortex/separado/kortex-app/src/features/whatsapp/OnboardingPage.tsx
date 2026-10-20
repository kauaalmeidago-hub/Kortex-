import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBusinessAccess } from '@/features/access/BusinessAccess';
import ConnectionModal from './ConnectionModal';
import { WaConnection } from './api';
import { useQueryClient } from '@tanstack/react-query';

export default function OnboardingPage() {
  const { user, loading } = useAuth();
  const access = useBusinessAccess();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const [open, setOpen] = useState(true);
  const [connected, setConnected] = useState(false);
  const [emailStep, setEmailStep] = useState(false);
  const [choice, setChoice] = useState('');
  const sectors = access.contexts.filter((c, i, all) => all.findIndex(x => x.workspace_id === c.workspace_id && x.sector_id === c.sector_id) === i);
  const selected = sectors.find(c => c.sector_id === choice) ?? (sectors.length === 1 ? sectors[0] : null);
  const scope = selected ? { workspaceId: selected.workspace_id, sectorId: selected.sector_id } : undefined;
  const canOpen = !loading && (!user || Boolean(selected));
  useEffect(() => { if (canOpen && !emailStep) setOpen(true); }, [canOpen, emailStep]);
  const handleConnected = (_connection: WaConnection) => setConnected(true);
  return <main className="grid min-h-[100dvh] place-items-center bg-background px-6 py-10 text-foreground">
    <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h1 className="text-xl font-semibold">{emailStep ? 'Confira seu e-mail' : 'Conecte seu WhatsApp'}</h1>
      <p className="my-4 text-sm leading-6 text-muted-foreground">{emailStep && connected ? 'WhatsApp conectado. Confirme seu e-mail para continuar.' : 'Seu progresso fica salvo. Retome o pareamento para concluir o início da sua conta.'}</p>
      {user && !selected && <><p className="mb-3 text-sm">{access.loading ? 'Validando seus setores...' : access.error ?? 'Selecione o setor desta conexão.'}</p>
        {sectors.length > 0 && <select className="task-select w-full" value={choice} aria-label="Setor autorizado" onChange={e => setChoice(e.target.value)}><option value="">Selecione um setor</option>{sectors.map(c => <option key={`${c.workspace_id}:${c.sector_id}`} value={c.sector_id}>{c.workspace_name} · {c.sector_name}</option>)}</select>}
        {access.error && <button className="wa-secondary" onClick={access.retry}>Tentar novamente</button>}</>}
      {!emailStep && <button className="wa-primary w-full" disabled={!canOpen} onClick={() => setOpen(true)}>Retomar conexão</button>}
      {emailStep && <p className="mt-3 text-sm text-muted-foreground">Use o link de confirmação recebido no cadastro. Depois, entre na sua conta; o servidor recuperará o pareamento existente.</p>}
      <Link to="/auth/login" className="mt-5 block text-sm text-primary underline">Voltar para entrar</Link>
    </section>
    {canOpen && <ConnectionModal open={open} onOpenChange={setOpen} temporary={!user} scope={scope} onConnected={handleConnected} onContinue={() => {
      setOpen(false);
      if (user) { queries.removeQueries({ queryKey: ['wa-onboarding-gate', user.id] }); navigate('/inbox', { replace: true }); }
      else setEmailStep(true);
    }} />}
  </main>;
}
