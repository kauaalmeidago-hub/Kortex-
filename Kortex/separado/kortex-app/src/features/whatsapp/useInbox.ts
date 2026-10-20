import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useBusinessAccess } from '@/features/access/BusinessAccess';
import { supabase } from '@/integrations/supabase/client';
import { WaConnection, WaConversation, WaMessage, WaScope, waRequest } from './api';

export function useWhatsAppScope() {
  const access = useBusinessAccess();
  const [selected, setSelected] = useState('');
  const options = access.contexts.filter((c, i, all) => all.findIndex(x => x.workspace_id === c.workspace_id && x.sector_id === c.sector_id) === i);
  const current = options.find(c => `${c.workspace_id}:${c.sector_id}` === selected) ?? (options.length === 1 ? options[0] : null);
  return { options, current, select: setSelected, loading: access.loading, error: access.error, retry: access.retry,
    scope: current ? { workspaceId: current.workspace_id, sectorId: current.sector_id } : undefined };
}
export function useInbox(scope?: WaScope) {
  const { user } = useAuth();
  const client = useQueryClient();
  const key = ['wa', user?.id, scope?.workspaceId, scope?.sectorId];
  const signature = JSON.stringify(key);
  const currentScope = useRef(signature); currentScope.current = signature;
  const [selection, setSelection] = useState({ scope: '', id: '' });
  const activeId = selection.scope === signature ? selection.id : '';
  const enabled = Boolean(user && scope);
  const connection = useQuery({ queryKey: [...key, 'connection'], enabled, queryFn: ({ signal }) => waRequest<WaConnection>('status', { scope, signal }), retry: false, refetchInterval: 5000 });
  const conversations = useQuery({ queryKey: [...key, 'conversations'], enabled: enabled && Boolean(connection.data?.id), queryFn: ({ signal }) => waRequest<WaConversation[]>('conversations', { scope, signal }), retry: false, refetchInterval: 4000 });
  const messages = useInfiniteQuery({ queryKey: [...key, 'messages', activeId], enabled: enabled && Boolean(activeId && connection.data?.id), initialPageParam: '',
    queryFn: ({ signal, pageParam }) => waRequest<WaMessage[]>('messages', { scope, signal, query: { conversationId: activeId, ...(pageParam ? { cursor: pageParam } : {}) } }),
    getNextPageParam: page => page.length === 50 ? `${page[49].sent_at}|${page[49].id}` : undefined, retry: false, refetchInterval: 4000 });
  const rows = [...new Map((messages.isError || connection.isError || !enabled ? [] : messages.data?.pages.flat() ?? []).map(m => [m.id, m])).values()].sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id));
  const incoming = rows.filter(m => !m.from_me);
  const lastIncoming = incoming[incoming.length - 1]?.sent_at;
  useEffect(() => {
    if (!scope || !activeId || !lastIncoming || connection.data?.state !== 'connected') return;
    const controller = new AbortController();
    const mark = () => {
      if (document.visibilityState !== 'visible') return;
      void waRequest('read', { scope, body: { conversationId: activeId, before: lastIncoming }, signal: controller.signal }).then(() => {
        if (!controller.signal.aborted) void client.invalidateQueries({ queryKey: [...key, 'conversations'] });
      }).catch(() => { /* Read receipt failure leaves server unread state unchanged. */ });
    };
    mark(); window.addEventListener('focus', mark);
    return () => { controller.abort(); window.removeEventListener('focus', mark); };
    // A new incoming message or a selection change is the read boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, activeId, lastIncoming, connection.data?.state]);
  const sending = useRef(false);
  const attempts = useRef(new Map<string, { id: string; upload?: { path: string; name: string; kind: string } }>());
  useEffect(() => { attempts.current.clear(); }, [signature]);
  const send = async (id: string, text: string, file?: File, quotedId?: string, requestId = crypto.randomUUID()) => {
    if (sending.current) throw new Error('Aguarde a confirmação do envio anterior.');
    if (!scope || !user || currentScope.current !== signature) throw new Error('Selecione seu setor novamente.');
    const attemptKey = JSON.stringify([signature, id, text, quotedId, file && [file.name, file.size, file.lastModified]]);
    let attempt = attempts.current.get(attemptKey);
    if (!attempt) { attempt = { id: requestId }; attempts.current.set(attemptKey, attempt); }
    sending.current = true;
    try {
      let upload = attempt.upload;
      if (file && !upload) {
        if (file.size > 20971520) throw new Error('Escolha um arquivo de até 20 MB.');
        if (!file.size) throw new Error('O arquivo está vazio.');
        const path = `${connection.data!.id}/${user.id}/${crypto.randomUUID()}`;
        const { error } = await supabase.storage.from('whatsapp-private').upload(path, file, { contentType: file.type || 'application/octet-stream' });
        if (error) throw new Error('Não foi possível enviar o arquivo para o armazenamento privado.');
        upload = { path, name: file.name, kind: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'document' };
        attempt.upload = upload;
      }
      if (currentScope.current !== signature) throw new Error('O setor mudou. Selecione a conversa novamente.');
      const result = await waRequest<{ state: string }>('send', { scope, body: { requestId: attempt.id, conversationId: id, text, ...(upload ? { file: upload } : {}), ...(quotedId ? { quotedId } : {}) } });
      if (result.state !== 'sent') throw new Error('Envio sem confirmação. Confira a conversa antes de repetir.');
      if (currentScope.current === signature) await client.invalidateQueries({ queryKey: key });
    } finally { sending.current = false; }
  };
  return { connection, conversations, messages, rows, activeId, select: (id: string) => setSelection({ scope: signature, id }), send,
    refresh: () => client.invalidateQueries({ queryKey: key }), scopeKey: signature };
}
