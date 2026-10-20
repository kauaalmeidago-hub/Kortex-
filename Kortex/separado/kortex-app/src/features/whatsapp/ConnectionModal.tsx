import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, CheckCircle2, Loader2, QrCode, RefreshCw, X } from 'lucide-react';
import { WaConnection, WaScope, waRequest } from './api';
import './whatsapp.css';

const steps = [
  ['Abra o WhatsApp', 'No seu celular, toque em Dispositivos conectados.'],
  ['Toque em Conectar dispositivo', 'Selecione essa opção para escanear o QR Code.'],
  ['Escaneie o QR Code', 'Aponte a câmera do seu celular para o código ao lado.'],
  ['Pronto!', 'A conexão será confirmada automaticamente.'],
];
// eslint-disable-next-line react-refresh/only-export-components
export const connectionLabels: Record<WaConnection['state'], string> = {
  preparing: 'Preparando conexão', qr: 'Aguardando leitura do QR Code', connecting: 'Conectando ao WhatsApp', connected: 'WhatsApp conectado',
  expired: 'QR Code expirado', disconnected: 'WhatsApp desconectado', error: 'Não foi possível conectar',
};
export default function ConnectionModal({ open, onOpenChange, scope, temporary = false, onContinue, onConnected, continuing = false, continueError = '' }: {
  open: boolean; onOpenChange: (open: boolean) => void; scope?: WaScope; temporary?: boolean;
  onContinue: () => void; onConnected?: (c: WaConnection) => void; continuing?: boolean; continueError?: string;
}) {
  const [connection, setConnection] = useState<WaConnection>({ id: null, state: 'preparing' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const callbacks = useRef({ onConnected }); callbacks.current = { onConnected };
  const requestAction = useRef<'prepare' | 'renew'>('prepare');
  const workspaceId = scope?.workspaceId, sectorId = scope?.sectorId;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let expiry: ReturnType<typeof setTimeout>;
    let active = true;
    setConnection({ id: null, state: 'preparing' }); setError('');
    const poll = async (first: boolean) => {
      setBusy(first);
      try {
        const next = await waRequest<WaConnection>(first ? requestAction.current : 'status', { scope: workspaceId && sectorId ? { workspaceId, sectorId } : undefined, temporary, signal: controller.signal, ...(first ? { body: {} } : {}) });
        if (!active) return;
        setConnection(next); setError('');
        clearTimeout(expiry);
        if (next.qrExpiresAt) expiry = setTimeout(() => {
          if (active) setConnection(c => c.state === 'qr' ? { ...c, state: 'expired', qr: undefined } : c);
        }, Math.max(0, Date.parse(next.qrExpiresAt) - Date.now()));
        if (next.state === 'connected') callbacks.current.onConnected?.(next);
        else timer = setTimeout(() => void poll(false), 3000);
      } catch (e) {
        if (active && !controller.signal.aborted) { setError(e instanceof Error ? e.message : 'Não foi possível recuperar a conexão.'); setConnection(c => ({ ...c, state: 'error', qr: undefined })); }
      } finally { if (active) setBusy(false); }
    };
    void poll(true);
    return () => { active = false; controller.abort(); clearTimeout(timer); clearTimeout(expiry); };
  }, [open, workspaceId, sectorId, temporary, attempt]);
  const connected = connection.state === 'connected';
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="wa-overlay" />
      <Dialog.Content className="wa-modal" aria-describedby="wa-description">
        <Dialog.Close className="wa-close" aria-label="Fechar e retomar depois"><X size={21} /></Dialog.Close>
        <div className="wa-modal-scroll">
          <section className="wa-qr-column">
            <Dialog.Title className="wa-title">Conecte seu WhatsApp</Dialog.Title>
            <Dialog.Description id="wa-description" className="wa-description">Leia o QR Code com o seu WhatsApp para conectar e começar a utilizar o chat da plataforma.</Dialog.Description>
            <div className="wa-qr-panel">
              <div className="wa-qr-frame">
                {connection.state === 'qr' && connection.qr ? <img src={connection.qr} className="wa-qr-image" alt="QR Code de pareamento do WhatsApp. Escaneie em Dispositivos conectados no celular." /> :
                  <div className="wa-qr-state">{connected ? <CheckCircle2 size={52} /> : busy || connection.state === 'connecting' ? <Loader2 className="wa-spinner" size={40} /> : <QrCode size={48} />}
                    <span>{connectionLabels[connection.state]}</span></div>}
              </div>
              <div className="wa-status" role="status" aria-live="polite">{continuing ? 'Abrindo sua área de trabalho...' : connectionLabels[connection.state]}</div>
              <p className="wa-hint">{connected ? 'Seu pareamento será preservado ao sair desta tela.' : 'Abra o WhatsApp no seu celular e faça a leitura do QR Code para conectar.'}</p>
              {error && <p className="wa-error" role="alert">{error}</p>}
              {continueError && <p className="wa-error" role="alert">{continueError}</p>}
              {['error', 'expired', 'disconnected'].includes(connection.state) && <button type="button" className="wa-secondary" disabled={busy} onClick={() => { requestAction.current = 'renew'; setAttempt(n => n + 1); }}><RefreshCw size={15} />{connection.state === 'expired' ? 'Gerar novo QR Code' : 'Tentar novamente'}</button>}
            </div>
          </section>
          <section className="wa-instructions" aria-labelledby="wa-how">
            <h2 id="wa-how">Como conectar?</h2>
            <ol>{steps.map(([title, description], i) => <li key={title}><span className="wa-step">{i + 1}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol>
            <button type="button" className="wa-primary" disabled={!connected || continuing} onClick={onContinue}>{continuing ? 'Abrindo plataforma...' : 'Prosseguir para a plataforma'} <ArrowRight size={17} /></button>
          </section>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
