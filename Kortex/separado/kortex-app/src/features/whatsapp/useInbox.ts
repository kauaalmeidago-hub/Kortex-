import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useBusinessAccess } from '@/features/access/BusinessAccess';
import { environmentKey } from '@/features/access/environment';
import { supabase } from '@/integrations/supabase/client';
import { WaConnection, WaConversation, WaCounts, WaError, WaMessage, WaScope, waRequest } from './api';
import { resolveWhatsAppContext, whatsappContextId } from './scope';

const preferenceEvent = 'kortex:whatsapp-context';
const memoryPreferences = new Map<string, string>();
function readPreference(key: string) {
  try { return localStorage.getItem(key) ?? memoryPreferences.get(key) ?? ''; }
  catch { return memoryPreferences.get(key) ?? ''; }
}
function subscribePreference(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener(preferenceEvent, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(preferenceEvent, notify);
  };
}

export function useWhatsAppScope() {
  const auth = useAuth();
  const access = useBusinessAccess();
  const preferenceKey = `kortex:whatsapp-context:${environmentKey}:${auth.user?.id ?? ''}:${auth.workspace?.id ?? ''}`;
  const preferred = useSyncExternalStore(subscribePreference, () => readPreference(preferenceKey), () => '');
  const loading = auth.loading || access.loading;
  const error = auth.contextError || access.error;
  const { options, current: resolved } = resolveWhatsAppContext(
    access.contexts, auth.workspace?.id, preferred, [access.selected('tasks'), access.selected('pipeline')],
  );
  const current = auth.user && !loading && !error ? resolved : null;
  const select = (id: string) => {
    if (!auth.user || loading || error || !options.some(option => whatsappContextId(option) === id)) return;
    memoryPreferences.set(preferenceKey, id);
    try { localStorage.setItem(preferenceKey, id); } catch { /* Optional preference, never an access grant. */ }
    window.dispatchEvent(new Event(preferenceEvent));
  };
  const retry = () => {
    if (auth.contextError) auth.retryContext();
    return access.retry();
  };
  return { options, current, select, loading, error, retry,
    needsSelection: !loading && !error && Boolean(auth.user) && options.length > 1 && !current,
    scope: current ? { workspaceId: current.workspace_id, sectorId: current.sector_id } : undefined };
}

export const whatsappQueryKey = (userId?: string, scope?: WaScope) =>
  ['wa', environmentKey, userId, scope?.workspaceId, scope?.sectorId] as const;
const deniesAccess = (error: unknown) => error instanceof WaError &&
  ['AUTH_REQUIRED', 'SCOPE_FORBIDDEN', 'ONBOARDING_ONLY', 'ONBOARDING_EXPIRED'].includes(error.code);

export function useInbox(scope?: WaScope, filter?: { phase: string; search: string }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const key = whatsappQueryKey(user?.id, scope);
  const signature = JSON.stringify(key);
  const boundary = useRef({ signature, epoch: 0 });
  if (boundary.current.signature !== signature)
    boundary.current = { signature, epoch: boundary.current.epoch + 1 };
  const scopeKey = JSON.stringify([signature, boundary.current.epoch]);
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const [selection, setSelection] = useState({ scope: '', id: '' });
  const [denial, setDenial] = useState<{ scope: string; error: Error; validatedAt: number } | null>(null);
  const selectedId = selection.scope === scopeKey ? selection.id : '';
  const enabled = Boolean(user && scope);
  const connection = useQuery({ queryKey: [...key, 'connection'], enabled,
    queryFn: ({ signal }) => waRequest<WaConnection>('status', { scope, signal }), retry: false, refetchInterval: 5000 });
  const conversations = useQuery<{ items: WaConversation[]; counts?: WaCounts; selected?: WaConversation }>({ queryKey: [...key, 'conversations', ...(filter ? [filter.phase, filter.search, selectedId] : [])], enabled: enabled && !deniesAccess(connection.error),
    // A filter change keeps the same selected conversation and draft visible.
    // Never carry placeholder data across an account/workspace boundary.
    placeholderData: (previous, previousQuery) => JSON.stringify(previousQuery?.queryKey.slice(0, key.length)) === signature ? previous : undefined,
    queryFn: async ({ signal }) => {
      const result = await waRequest<WaConversation[] | { items: WaConversation[]; counts: WaCounts; selected?: WaConversation }>('conversations', { scope, signal,
        ...(filter ? { query: { phase: filter.phase, search: filter.search, ...(selectedId ? { selectedId } : {}) } } : {}) });
      return Array.isArray(result) ? { items: result, counts: undefined } : result;
    }, retry: false, refetchInterval: 4000 });
  const messages = useInfiniteQuery({ queryKey: [...key, 'messages', selectedId],
    enabled: enabled && Boolean(selectedId) && !deniesAccess(connection.error) && !deniesAccess(conversations.error), initialPageParam: '',
    queryFn: ({ signal, pageParam }) => waRequest<WaMessage[]>('messages', { scope, signal, query: { conversationId: selectedId, ...(pageParam ? { cursor: pageParam } : {}) } }),
    getNextPageParam: page => page.length === 50 ? `${page[49].sent_at}|${page[49].id}` : undefined, retry: false, refetchInterval: 4000 });
  const deniedError = [connection.error, conversations.error, messages.error].find(deniesAccess);
  const heldDenial = denial?.scope === scopeKey && connection.dataUpdatedAt <= denial.validatedAt ? denial.error : null;
  const accessDenied = Boolean(deniedError || heldDenial);
  const activeId = enabled && !accessDenied ? selectedId : '';
  const rows = [...new Map((!enabled || accessDenied ? [] : messages.data?.pages.flat() ?? []).map(message => [message.id, message])).values()]
    .sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id));
  const incoming = rows.filter(message => !message.from_me);
  const lastIncoming = incoming[incoming.length - 1]?.sent_at;
  const selectedConversation = conversations.data?.items.find(row => row.id === selectedId) || conversations.data?.selected;
  const canSend = enabled && !accessDenied && !conversations.isError && (selectedConversation?.case_id ? selectedConversation.can_send === true && selectedConversation.channel_state === 'connected' : !connection.isError && connection.data?.state === 'connected');
  const active = useRef({ scopeKey, id: activeId }); active.current = { scopeKey, id: activeId };
  const previousKey = useRef(key);
  useLayoutEffect(() => {
    const previous = previousKey.current;
    previousKey.current = key;
    if (JSON.stringify(previous) === signature) return;
    // Late results cannot restore a cache from another account/context.
    void client.cancelQueries({ queryKey: previous });
    client.removeQueries({ queryKey: previous });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, client]);
  useEffect(() => {
    if (!deniedError) return;
    setDenial({ scope: scopeKey, error: deniedError, validatedAt: connection.dataUpdatedAt });
    setSelection({ scope: '', id: '' });
    void client.cancelQueries({ queryKey: [...key, 'messages'] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deniedError, scopeKey, client]);
  useEffect(() => {
    if (!scope || !activeId || !lastIncoming || !canSend) return;
    const controller = new AbortController();
    const mark = () => {
      if (document.visibilityState !== 'visible') return;
      void waRequest('read', { scope, body: { conversationId: activeId, before: lastIncoming }, signal: controller.signal }).then(() => {
        if (!controller.signal.aborted && currentScope.current === scopeKey)
          void client.invalidateQueries({ queryKey: [...key, 'conversations'] });
      }).catch(() => { /* A read failure leaves server unread state unchanged. */ });
    };
    mark(); window.addEventListener('focus', mark);
    return () => { controller.abort(); window.removeEventListener('focus', mark); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, activeId, lastIncoming, canSend]);
  const sending = useRef(false);
  const fileIdentities = useRef(new WeakMap<File, string>());
  const attempts = useRef(new Map<string, { id: string; upload?: { path: string; name: string; kind: string } }>());
  useEffect(() => { attempts.current.clear(); }, [scopeKey]);
  const send = async (id: string, text: string, file?: File, quotedId?: string, requestId: string = crypto.randomUUID()) => {
    if (sending.current) throw new Error('Aguarde a confirmação do envio anterior.');
    const isCurrent = () => currentScope.current === scopeKey && active.current.scopeKey === scopeKey && active.current.id === id;
    if (!scope || !user || !isCurrent()) throw new Error('O contexto mudou. Selecione a conversa novamente.');
    const channelId = selectedConversation?.connection_id || connection.data?.id;
    if (!canSend || !channelId) throw new Error('Assuma o atendimento e verifique o canal antes de enviar.');
    if (selectedConversation?.id !== id) throw new Error('Selecione uma conversa disponível.');
    if (quotedId && !rows.some(message => message.id === quotedId)) throw new Error('Selecione novamente a mensagem que deseja responder.');
    if (!text.trim() && !file) throw new Error('Digite uma mensagem ou escolha um arquivo.');
    if (text.length > 10000) throw new Error('A mensagem deve ter até 10.000 caracteres.');
    // The same File survives a failed send in the composer. A replacement file
    // must not inherit its upload/request merely because its metadata matches.
    let fileIdentity = file ? fileIdentities.current.get(file) : undefined;
    if (file && !fileIdentity) {
      fileIdentity = crypto.randomUUID();
      fileIdentities.current.set(file, fileIdentity);
    }
    const attemptKey = JSON.stringify([scopeKey, id, text, quotedId, fileIdentity]);
    let attempt = attempts.current.get(attemptKey);
    if (!attempt) { attempt = { id: requestId }; attempts.current.set(attemptKey, attempt); }
    sending.current = true;
    try {
      let upload = attempt.upload;
      if (file && !upload) {
        if (file.size > 20971520) throw new Error('Escolha um arquivo de até 20 MB.');
        if (!file.size) throw new Error('O arquivo está vazio.');
        const path = `${channelId}/${user.id}/${crypto.randomUUID()}`;
        const { error } = await supabase.storage.from('whatsapp-private').upload(path, file, { contentType: file.type || 'application/octet-stream' });
        if (error) throw new Error('Não foi possível preparar o arquivo. Tente novamente.');
        upload = { path, name: file.name, kind: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'document' };
        attempt.upload = upload;
      }
      if (!isCurrent()) throw new Error('O contexto mudou. Selecione a conversa novamente.');
      const result = await waRequest<{ state: string; providerId?: string; uncertain?: boolean }>('send', {
        scope, body: { requestId: attempt.id, conversationId: id, text, ...(upload ? { file: upload } : {}), ...(quotedId ? { quotedId } : {}) },
      });
      if (result.state !== 'sent' || !result.providerId || result.uncertain)
        throw new Error('Envio sem confirmação. Confira a conversa antes de repetir.');
      // Only confirmation releases the idempotency key. A manual retry of an
      // uncertain request reuses its key; no effect or timer repeats a send.
      attempts.current.delete(attemptKey);
      if (currentScope.current === scopeKey) void client.invalidateQueries({ queryKey: key });
    } finally { sending.current = false; }
  };
  const listed = conversations.data?.items;
  const visibleConversations = { ...conversations, data: enabled && !accessDenied ? selectedConversation && !listed?.some(row => row.id === selectedConversation.id) ? [...(listed || []), selectedConversation] : listed : undefined };
  return { connection, conversations: visibleConversations, messages, rows, activeId,
    select: (id: string) => setSelection({ scope: scopeKey, id }), send, canSend,
    counts: enabled && !accessDenied ? conversations.data?.counts : undefined,
    dataError: connection.error || conversations.error || messages.error || heldDenial,
    refresh: () => client.invalidateQueries({ queryKey: key }), scopeKey };
}
