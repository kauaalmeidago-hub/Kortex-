import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessContext } from '@/integrations/supabase/businessTypes';
import { WaError, type WaScope } from './api';
import { useInbox, useWhatsAppScope, whatsappQueryKey } from './useInbox';

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'operator' }, workspace: { id: 'org' }, loading: false, contextError: null as string | null },
  access: { contexts: [] as BusinessContext[], loading: false, error: null as string | null, selected: vi.fn(), retry: vi.fn() },
  request: vi.fn(), upload: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/features/access/BusinessAccess', () => ({ useBusinessAccess: () => mocks.access }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { storage: { from: () => ({ upload: mocks.upload }) } } }));
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), waRequest: mocks.request }));

const scope = { workspaceId: 'org', sectorId: 'sales' };
const originalMessage = { id: 'database-message-id', provider_id: 'provider-id', body: 'Pedido', kind: 'text', sent_at: '2026-10-21T12:00:00Z', from_me: false, status_rank: 1 };
const conversation = { id: 'customer', name: 'Cliente', status: 'active', connection_id: 'connection', remote_jid: 'test@s.whatsapp.net', last_message_at: originalMessage.sent_at, unread_count: 0, preview: 'Pedido' };
let client: QueryClient;
const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.auth = { user: { id: 'operator' }, workspace: { id: 'org' }, loading: false, contextError: null };
  mocks.access = { contexts: [], loading: false, error: null, selected: vi.fn(() => null), retry: vi.fn() };
  mocks.upload.mockResolvedValue({ error: null });
  mocks.request.mockImplementation(async action => {
    if (action === 'status') return { id: 'connection', state: 'connected' };
    if (action === 'conversations') return [conversation];
    if (action === 'messages') return [originalMessage];
    if (action === 'send') return { state: 'sent', providerId: 'confirmed-provider-id' };
    return { read: true };
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); });

async function openInbox() {
  const hook = renderHook(({ current }: { current?: WaScope }) => useInbox(current), { wrapper, initialProps: { current: scope } });
  await waitFor(() => expect(hook.result.current.conversations.data).toHaveLength(1));
  act(() => hook.result.current.select('customer'));
  await waitFor(() => expect(hook.result.current.rows).toHaveLength(1));
  return hook;
}

describe('authorized inbox cache and send boundaries', () => {
  it('keeps the selected chat while server filters change, without carrying another account cache', async () => {
    const hook = renderHook(({ phase }: { phase: string }) => useInbox(scope, { phase, search: '' }), { wrapper, initialProps: { phase: 'all' } });
    await waitFor(() => expect(hook.result.current.conversations.data).toHaveLength(1));
    act(() => hook.result.current.select('customer'));
    await waitFor(() => expect(hook.result.current.rows).toHaveLength(1));
    const base = mocks.request.getMockImplementation()!;
    let finishFilter!: (value: { items: typeof conversation[]; selected: typeof conversation; counts: { all: number; triage: number; active: number; pending: number; resolved: number } }) => void;
    mocks.request.mockImplementation((action, options) => action === 'conversations' && options?.query?.phase === 'pending' ? new Promise(resolve => { finishFilter = resolve; }) : base(action, options));
    hook.rerender({ phase: 'pending' });
    expect(hook.result.current.activeId).toBe('customer');
    expect(hook.result.current.conversations.data?.[0].id).toBe('customer');
    expect(hook.result.current.rows).toEqual([originalMessage]);
    await waitFor(() => expect(finishFilter).toBeTypeOf('function'));
    await act(async () => { finishFilter({ items: [], selected: conversation, counts: { all: 350, triage: 349, active: 1, pending: 0, resolved: 0 } }); });
    expect(hook.result.current.activeId).toBe('customer');
    expect(hook.result.current.conversations.data?.[0].id).toBe('customer');
    await waitFor(() => expect(hook.result.current.counts?.all).toBe(350));
    mocks.auth = { ...mocks.auth, user: { id: 'different' } };
    hook.rerender({ phase: 'pending' });
    expect(hook.result.current.conversations.data).toBeUndefined();
    expect(hook.result.current.activeId).toBe('');
  });
  it('preserves loaded messages and conversations during temporary status and history failures', async () => {
    const hook = await openInbox();
    mocks.request.mockRejectedValue(new Error('Temporariamente indisponível'));
    await act(async () => { await hook.result.current.refresh(); });
    await waitFor(() => expect(hook.result.current.connection.isError).toBe(true));
    expect(hook.result.current.conversations.data).toHaveLength(1);
    expect(hook.result.current.rows).toEqual([originalMessage]);
    expect(hook.result.current.dataError).toBeTruthy();
    expect(hook.result.current.canSend).toBe(false);
  });
  it('hides cached history after access denial', async () => {
    const hook = await openInbox();
    mocks.request.mockRejectedValue(new WaError('SCOPE_FORBIDDEN', 'Acesso removido'));
    await act(async () => { await hook.result.current.refresh(); });
    await waitFor(() => expect(hook.result.current.dataError).toBeTruthy());
    expect(hook.result.current.conversations.data).toBeUndefined();
    expect(hook.result.current.rows).toEqual([]);
    expect(hook.result.current.activeId).toBe('');
    expect(hook.result.current.canSend).toBe(false);
  });
  it('clears selection and old caches on a scope change, even when returning to the previous scope', async () => {
    const hook = await openInbox(); const before = hook.result.current.scopeKey;
    hook.rerender({ current: { workspaceId: 'org', sectorId: 'support' } });
    expect(hook.result.current.activeId).toBe(''); expect(hook.result.current.rows).toEqual([]);
    expect(client.getQueryData([...whatsappQueryKey('operator', scope), 'conversations'])).toBeUndefined();
    hook.rerender({ current: scope });
    expect(hook.result.current.activeId).toBe('');
    expect(hook.result.current.scopeKey).not.toBe(before);
  });
  it('does not expose or reuse account data after a user switch', async () => {
    const hook = await openInbox(); const before = hook.result.current.scopeKey;
    mocks.auth = { ...mocks.auth, user: { id: 'another-operator' } };
    hook.rerender({ current: scope });
    expect(hook.result.current.scopeKey).not.toBe(before);
    expect(hook.result.current.activeId).toBe(''); expect(hook.result.current.rows).toEqual([]);
    expect(hook.result.current.conversations.data).toBeUndefined();
  });
  it('never posts a pending attachment after a scope changes away and back', async () => {
    const hook = await openInbox();
    let finishUpload!: (value: { error: null }) => void;
    mocks.upload.mockImplementation(() => new Promise(resolve => { finishUpload = resolve; }));
    const pending = hook.result.current.send('customer', 'Arquivo', new File(['anexo'], 'teste.txt'));
    const rejected = expect(pending).rejects.toThrow('contexto mudou');
    hook.rerender({ current: { workspaceId: 'org', sectorId: 'support' } });
    hook.rerender({ current: scope });
    await act(async () => { finishUpload({ error: null }); await rejected; });
    expect(mocks.request.mock.calls.filter(([action]) => action === 'send')).toHaveLength(0);
  });
  it('passes the database quotedId unchanged, and allows a later intentional identical message after confirmation', async () => {
    const hook = await openInbox();
    await act(async () => { await hook.result.current.send('customer', 'Resposta', undefined, originalMessage.id, 'request-1'); });
    const sendOptions = mocks.request.mock.calls.find(([action]) => action === 'send')?.[1];
    expect(sendOptions.body).toEqual({ conversationId: 'customer', text: 'Resposta', quotedId: originalMessage.id, requestId: 'request-1' });
    await act(async () => { await hook.result.current.send('customer', 'Resposta', undefined, originalMessage.id, 'request-2'); });
    expect(mocks.request.mock.calls.filter(([action]) => action === 'send').map(([, options]) => options.body.requestId)).toEqual(['request-1', 'request-2']);
  });
  it('does not confirm enqueued/uncertain requests or retry them automatically; manual retry retains the idempotency key', async () => {
    const hook = await openInbox();
    const implementation = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((action, options) => action === 'send' ? Promise.resolve({ state: 'enqueued' }) : implementation(action, options));
    await act(async () => { await expect(hook.result.current.send('customer', 'Rascunho', undefined, originalMessage.id, 'stable-key')).rejects.toThrow('sem confirmação'); });
    await act(async () => { await expect(hook.result.current.send('customer', 'Rascunho', undefined, originalMessage.id, 'different-key')).rejects.toThrow('sem confirmação'); });
    expect(mocks.request.mock.calls.filter(([action]) => action === 'send').map(([, options]) => options.body.requestId)).toEqual(['stable-key', 'stable-key']);
  });
  it('rejects an unconfirmed sent response without a provider identifier', async () => {
    const hook = await openInbox(); const implementation = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((action, options) => action === 'send' ? Promise.resolve({ state: 'sent' }) : implementation(action, options));
    await act(async () => { await expect(hook.result.current.send('customer', 'Resposta')).rejects.toThrow('sem confirmação'); });
  });
  it('reuses the same File on manual retry but never reuses a different file with matching metadata', async () => {
    const hook = await openInbox(); const implementation = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((action, options) => action === 'send' ? Promise.resolve({ state: 'uncertain' }) : implementation(action, options));
    const original = new File(['aaaa'], 'proposta.txt', { type: 'text/plain', lastModified: 100 });
    const replacement = new File(['bbbb'], 'proposta.txt', { type: 'text/plain', lastModified: 100 });
    await act(async () => { await expect(hook.result.current.send('customer', 'Arquivo', original, undefined, 'original-key')).rejects.toThrow('sem confirmação'); });
    await act(async () => { await expect(hook.result.current.send('customer', 'Arquivo', original, undefined, 'ignored-retry-key')).rejects.toThrow('sem confirmação'); });
    await act(async () => { await expect(hook.result.current.send('customer', 'Arquivo', replacement, undefined, 'replacement-key')).rejects.toThrow('sem confirmação'); });
    const calls = mocks.request.mock.calls.filter(([action]) => action === 'send').map(([, options]) => options.body);
    expect(calls.map(body => body.requestId)).toEqual(['original-key', 'original-key', 'replacement-key']);
    expect(calls[0].file.path).toBe(calls[1].file.path);
    expect(calls[2].file.path).not.toBe(calls[0].file.path);
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.upload.mock.calls.map(([, file]) => file)).toEqual([original, replacement]);
  });
  it('blocks empty messages, quotes from another conversation, and duplicate clicks', async () => {
    const hook = await openInbox();
    await expect(hook.result.current.send('customer', ' ')).rejects.toThrow('Digite');
    await expect(hook.result.current.send('customer', 'Resposta', undefined, 'foreign-id')).rejects.toThrow('Selecione novamente');
    let confirm!: (value: unknown) => void;
    const implementation = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((action, options) => action === 'send' ? new Promise(resolve => { confirm = resolve; }) : implementation(action, options));
    const first = hook.result.current.send('customer', 'Resposta');
    await expect(hook.result.current.send('customer', 'Resposta')).rejects.toThrow('Aguarde');
    await act(async () => { confirm({ state: 'sent', providerId: 'provider-id' }); await first; });
    expect(mocks.request.mock.calls.filter(([action]) => action === 'send')).toHaveLength(1);
  });
});

it('keeps a settings choice on navigation, isolates preferences by user, and rejects revoked preferences', () => {
  const sales = { board_id: 'sales-board', workspace_id: 'org', sector_id: 'sales' } as BusinessContext;
  const support = { board_id: 'support-board', workspace_id: 'org', sector_id: 'support' } as BusinessContext;
  mocks.access.contexts = [sales, support];
  const settings = renderHook(useWhatsAppScope);
  expect(settings.result.current.needsSelection).toBe(true);
  act(() => settings.result.current.select('org:support'));
  expect(settings.result.current.current).toBe(support);
  settings.unmount();
  const inbox = renderHook(useWhatsAppScope);
  expect(inbox.result.current.current).toBe(support);
  mocks.auth = { ...mocks.auth, user: { id: 'another-operator' } }; inbox.rerender();
  expect(inbox.result.current.current).toBeNull();
  mocks.auth = { ...mocks.auth, user: { id: 'operator' } };
  mocks.access.contexts = [sales]; inbox.rerender();
  expect(inbox.result.current.current).toBe(sales);
});
