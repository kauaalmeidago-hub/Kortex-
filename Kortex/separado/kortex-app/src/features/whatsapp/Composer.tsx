import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, Paperclip, Square, Trash2, X } from 'lucide-react';

export default function WhatsAppComposer({ onSend, disabled, quoted, onClearQuote }: {
  onSend: (text: string, file?: File) => Promise<void>; disabled: boolean; quoted?: string; onClearQuote: () => void;
}) {
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder>();
  const stream = useRef<MediaStream>();
  const stopped = useRef(false);
  const mounted = useRef(true);
  const [recording, setRecording] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopped.current = true; if (recorder.current?.state === 'recording') recorder.current.stop(); stream.current?.getTracks().forEach(t => t.stop()); }; }, []);
  useEffect(() => { const url = file ? URL.createObjectURL(file) : ''; setPreview(url); return () => { if (url) URL.revokeObjectURL(url); }; }, [file]);
  const send = async () => {
    if (busyRef.current || disabled || (!input.trim() && !file)) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await onSend(input.trim(), file); if (mounted.current) { setInput(''); setFile(undefined); onClearQuote(); } }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Não foi possível enviar.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const record = async () => {
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return; }
    setError(''); stopped.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Gravação não disponível neste navegador.');
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || stopped.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const mime = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(media, mime ? { mimeType: mime } : undefined); recorder.current = r;
      const chunks: Blob[] = []; let size = 0;
      r.ondataavailable = e => { chunks.push(e.data); size += e.data.size; if (size > 20971520 && r.state === 'recording') r.stop(); };
      r.onstop = () => {
        media.getTracks().forEach(t => t.stop());
        if (!mounted.current) return;
        setRecording(false);
        if (stopped.current) return;
        if (size > 20971520) { setError('O áudio excedeu 20 MB. Grave um trecho menor.'); return; }
        const type = r.mimeType, extension = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        setFile(new File(chunks, `audio-${Date.now()}.${extension}`, { type }));
      };
      r.start(1000); setRecording(true);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Permita o microfone para gravar.'); }
  };
  return <footer className="shrink-0 bg-background p-4 sm:px-6">
    {quoted && <div className="mb-2 flex items-center justify-between rounded-xl border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs"><span className="truncate">Respondendo: {quoted}</span><button aria-label="Cancelar resposta" onClick={onClearQuote}><X size={16} /></button></div>}
    {file && <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl bg-muted p-3 text-xs"><span className="max-w-[220px] truncate">{file.name} · {(file.size / 1024).toFixed(0)} KB</span>{file.type.startsWith('audio/') && <audio controls src={preview} className="h-9 max-w-full" />}{file.type.startsWith('image/') && <img src={preview} alt="Prévia do anexo" className="h-16 w-16 rounded object-contain" />}<button aria-label="Remover anexo" disabled={busy} onClick={() => setFile(undefined)}><Trash2 size={17} /></button></div>}
    {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
    <div className="flex min-h-[96px] flex-col rounded-[28px] border border-border bg-card px-4 py-3 shadow-[0_14px_36px_rgba(36,121,219,0.12)]">
      <textarea aria-label="Mensagem" disabled={disabled || busy || recording} value={input} onChange={e => setInput(e.target.value)} maxLength={10000} rows={1} placeholder={disabled ? 'Reconecte o WhatsApp para enviar' : 'Digite uma mensagem...'} className="min-h-9 w-full resize-none bg-transparent text-sm outline-none" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <div className="flex items-center justify-between">
        <input ref={picker} type="file" className="sr-only" tabIndex={-1} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f && f.size > 20971520) setError('Escolha um arquivo de até 20 MB.'); else { setFile(f); setError(''); } }} />
        <button type="button" className="rounded-xl p-2 text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary" disabled={disabled || busy || recording} aria-label="Anexar arquivo de até 20 MB" onClick={() => picker.current?.click()}><Paperclip size={20} /></button>
        <div className="flex items-center gap-3">
          {recording && <button className="text-xs text-destructive" onClick={() => { stopped.current = true; recorder.current?.stop(); }}>Cancelar gravação</button>}
          <button type="button" className="rounded-xl p-2 text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary" disabled={disabled || busy} aria-label={recording ? 'Parar gravação e ouvir prévia' : 'Gravar áudio'} onClick={() => void record()}>{recording ? <Square size={19} className="text-destructive" /> : <Mic size={20} />}</button>
          <button type="button" className="grid h-9 w-[52px] place-items-center rounded-full bg-gradient-to-r from-primary to-sky-400 text-white disabled:opacity-40" disabled={disabled || busy || recording || (!input.trim() && !file)} aria-label="Enviar mensagem" onClick={() => void send()}>{busy ? <span className="text-xs">...</span> : <ArrowUp size={20} />}</button>
        </div>
      </div>
    </div>
  </footer>;
}
