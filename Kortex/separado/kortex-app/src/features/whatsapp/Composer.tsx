import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, LoaderCircle, Mic, Paperclip, Square, Trash2, X } from 'lucide-react';
import './composer.css';

export interface ComposerQuote {
  id: string;
  author: string;
  preview: string;
}

export interface WhatsAppComposerHandle {
  focus: () => void;
}

interface WhatsAppComposerProps {
  onSend: (text: string, file?: File) => Promise<void>;
  disabled: boolean;
  quoted?: ComposerQuote;
  onClearQuote: () => void;
  unavailableReason?: string;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const WhatsAppComposer = forwardRef<WhatsAppComposerHandle, WhatsAppComposerProps>(function WhatsAppComposer(
  { onSend, disabled, quoted, onClearQuote, unavailableReason },
  ref,
) {
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [requestingMicrophone, setRequestingMicrophone] = useState(false);
  const busyRef = useRef(false);
  const microphonePending = useRef(false);
  const composing = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const recorder = useRef<MediaRecorder>();
  const stream = useRef<MediaStream>();
  const stopped = useRef(false);
  const mounted = useRef(true);
  const currentQuote = useRef(quoted);

  useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }), []);

  useEffect(() => { currentQuote.current = quoted; }, [quoted]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopped.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  useEffect(() => {
    const url = file && /^(audio|image)\//.test(file.type) ? URL.createObjectURL(file) : '';
    setPreview(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [file]);

  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.max(38, Math.min(field.scrollHeight, 112))}px`;
  }, [input]);

  const send = async () => {
    if (busyRef.current || disabled || recording || microphonePending.current || (!input.trim() && !file)) return;
    const sentQuoteId = quoted?.id;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onSend(input.trim(), file);
      if (!mounted.current) return;
      setInput('');
      setFile(undefined);
      if (currentQuote.current?.id === sentQuoteId) onClearQuote();
    } catch {
      if (mounted.current) setError('Não foi possível confirmar o envio. Seu rascunho foi mantido. Tente novamente.');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const record = async () => {
    if (busyRef.current || disabled || microphonePending.current) return;
    if (recorder.current?.state === 'recording') {
      recorder.current.stop();
      return;
    }
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Gravação não disponível neste navegador. Você pode anexar um áudio.');
      return;
    }
    stopped.current = false;
    microphonePending.current = true;
    setRequestingMicrophone(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || stopped.current) {
        media.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = media;
      const mime = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const nextRecorder = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      recorder.current = nextRecorder;
      const chunks: Blob[] = [];
      let size = 0;
      nextRecorder.ondataavailable = event => {
        chunks.push(event.data);
        size += event.data.size;
        if (size > MAX_FILE_SIZE && nextRecorder.state === 'recording') nextRecorder.stop();
      };
      nextRecorder.onstop = () => {
        media.getTracks().forEach(track => track.stop());
        if (!mounted.current) return;
        setRecording(false);
        if (stopped.current) return;
        if (size > MAX_FILE_SIZE) {
          setError('O áudio excedeu 20 MB. Grave um trecho menor.');
          return;
        }
        if (!size) {
          setError('Nenhum áudio foi capturado. Tente gravar novamente.');
          return;
        }
        const type = nextRecorder.mimeType;
        const extension = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        setFile(new File(chunks, `audio-${Date.now()}.${extension}`, { type }));
      };
      nextRecorder.start(1000);
      setRecording(true);
    } catch {
      stream.current?.getTracks().forEach(track => track.stop());
      if (mounted.current) setError('Não foi possível gravar. Permita o microfone e tente novamente.');
    } finally {
      microphonePending.current = false;
      if (mounted.current) setRequestingMicrophone(false);
    }
  };

  const editingDisabled = disabled || busy || recording || requestingMicrophone;

  return <footer className="wa-inbox-composer">
    <div className="wa-inbox-composer-card">
      {quoted && <div className="wa-inbox-reply" role="region" aria-label="Mensagem selecionada para resposta">
        <div className="wa-inbox-reply-copy">
          <p className="wa-inbox-reply-heading">Respondendo para <strong>{quoted.author}</strong></p>
          <p className="wa-inbox-reply-preview">{quoted.preview}</p>
        </div>
        <button type="button" className="wa-inbox-composer-action wa-inbox-reply-cancel" aria-label="Cancelar resposta" onClick={onClearQuote}><X size={18} /></button>
      </div>}
      {file && <div className="wa-inbox-attachment">
        <span className="wa-inbox-attachment-name">{file.name} · {(file.size / 1024).toFixed(0)} KB</span>
        {file.type.startsWith('audio/') && <audio controls src={preview} className="wa-inbox-audio-preview" />}
        {file.type.startsWith('image/') && <img src={preview} alt="Prévia do anexo" className="wa-inbox-image-preview" />}
        <button type="button" className="wa-inbox-composer-action" aria-label="Remover anexo" disabled={busy || recording} onClick={() => setFile(undefined)}><Trash2 size={17} /></button>
      </div>}
      {error && <p role="alert" className="wa-inbox-composer-error">{error}</p>}
      {disabled && unavailableReason && <p role="status" className="wa-inbox-composer-hint">{unavailableReason}</p>}
      {recording && <div className="wa-inbox-recording" role="status">
        <span>Gravando áudio...</span>
        <button type="button" onClick={() => { stopped.current = true; recorder.current?.stop(); }}>Cancelar gravação</button>
      </div>}
      <div className="wa-inbox-composer-row">
        <input ref={picker} type="file" className="sr-only" tabIndex={-1} aria-label="Selecionar arquivo" disabled={editingDisabled} onChange={event => {
          const selected = event.target.files?.[0];
          event.target.value = '';
          if (!selected) return;
          if (selected.size > MAX_FILE_SIZE) setError('Escolha um arquivo de até 20 MB.');
          else { setFile(selected); setError(''); }
        }} />
        <button type="button" className="wa-inbox-composer-action" disabled={editingDisabled} aria-label="Anexar arquivo de até 20 MB" onClick={() => picker.current?.click()}><Paperclip size={20} /></button>
        <textarea ref={textarea} aria-label="Mensagem" disabled={editingDisabled} value={input} onChange={event => setInput(event.target.value)} maxLength={10000} rows={1} placeholder="Digite uma mensagem..." className="wa-inbox-composer-input" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && !composing.current) {
            event.preventDefault();
            void send();
          }
        }} />
        <button type="button" className="wa-inbox-composer-action" disabled={disabled || busy || requestingMicrophone} aria-label={recording ? 'Parar gravação e ouvir prévia' : 'Gravar áudio'} aria-pressed={recording} onClick={() => void record()}>{recording ? <Square size={18} className="wa-inbox-recording-icon" /> : <Mic size={20} />}</button>
        <button type="button" className="wa-inbox-send" disabled={editingDisabled || (!input.trim() && !file)} aria-label="Enviar mensagem" aria-busy={busy} onClick={() => void send()}>
          {busy ? <span className="wa-inbox-send-progress"><LoaderCircle size={20} /><span className="sr-only">Enviando mensagem</span></span> : <ArrowUp size={23} strokeWidth={2.8} />}
        </button>
      </div>
    </div>
  </footer>;
});

export default WhatsAppComposer;
