import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaError, waRequest } from './api';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), fetch: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: mocks.getSession } } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } } });
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('WhatsApp API response validation', () => {
  it('rejects an HTML fallback even when the server returns HTTP 200', async () => {
    mocks.fetch.mockResolvedValue(new Response('<!doctype html><title>SPA</title>', {
      status: 200, headers: { 'Content-Type': 'text/html' },
    }));
    await expect(waRequest('status')).rejects.toMatchObject({
      name: 'Error', code: 'BACKEND_UNAVAILABLE', message: 'Não foi possível acessar o serviço de conexão.',
    });
  });
  it('preserves a structured authorization error and its code', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ code: 'SCOPE_FORBIDDEN', error: 'Acesso não autorizado.' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    }));
    const request = waRequest('messages');
    await expect(request).rejects.toBeInstanceOf(WaError);
    await expect(request).rejects.toMatchObject({ code: 'SCOPE_FORBIDDEN', message: 'Acesso não autorizado.' });
  });
  it('returns valid JSON and passes the authenticated context to the transport', async () => {
    const payload = { id: 'connection', state: 'connected' };
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    await expect(waRequest('status', { scope: { workspaceId: 'org', sectorId: 'sales' } })).resolves.toEqual(payload);
    expect(mocks.fetch).toHaveBeenCalledWith('/api/whatsapp?action=status&workspaceId=org&sectorId=sales', expect.objectContaining({
      headers: { Authorization: 'Bearer test-token' }, credentials: 'same-origin', method: 'GET',
    }));
  });
});
