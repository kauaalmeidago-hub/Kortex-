import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OnboardingPage from './OnboardingPage';

const mocks = vi.hoisted(() => ({ auth: { user: null as { id: string } | null, loading: false }, contexts: [] as { workspace_id: string; sector_id: string; workspace_name: string; sector_name: string }[], request: vi.fn(), setSession: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/features/access/BusinessAccess', () => ({ useBusinessAccess: () => ({ contexts: mocks.contexts, loading: false, retry: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { setSession: mocks.setSession } } }));
vi.mock('./api', () => ({ waRequest: mocks.request }));
vi.mock('./ConnectionModal', () => ({ default: ({ onConnected, continuing }: { onConnected: () => void; continuing: boolean }) => <button disabled={continuing} onClick={onConnected}>Simular pareamento confirmado</button> }));

const sector = { workspace_id: 'workspace', sector_id: 'sector', workspace_name: 'Minha organização', sector_name: 'Comercial' };
let client: QueryClient;
function Harness() {
  return <QueryClientProvider client={client}><MemoryRouter initialEntries={['/auth/whatsapp']}><Routes>
    <Route path="/auth/whatsapp" element={<OnboardingPage />} />
    <Route path="/inbox" element={<div>Área de trabalho aberta</div>} />
  </Routes></MemoryRouter></QueryClientProvider>;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth = { user: null, loading: false }; mocks.contexts = [];
  mocks.setSession.mockResolvedValue({ error: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(cleanup);

it('opens the workspace automatically after pairing, restoring the session and activating only its authorized sector', async () => {
  mocks.request.mockImplementation(async action => action === 'complete' ? { session: { access_token: 'access', refresh_token: 'refresh' } } : { state: 'connected' });
  const view = render(<Harness />);
  expect(mocks.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Simular pareamento confirmado' }));
  await waitFor(() => expect(mocks.setSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' }));
  expect(mocks.request).toHaveBeenCalledWith('complete', { temporary: true, body: {} });
  expect(screen.queryByText(/Confira seu e-mail|Confirme seu e-mail/)).not.toBeInTheDocument();
  mocks.auth = { user: { id: 'new' }, loading: false }; mocks.contexts = [sector];
  view.rerender(<Harness />);
  expect(await screen.findByText('Área de trabalho aberta')).toBeInTheDocument();
  expect(mocks.request).toHaveBeenCalledWith('activate', { scope: { workspaceId: 'workspace', sectorId: 'sector' }, body: {} });
  expect(mocks.request.mock.calls.map(call => call[0])).toEqual(['complete', 'activate']);
});
it('does not enter the workspace when the server refuses the creation grant', async () => {
  mocks.request.mockRejectedValue(new Error('Sua autorização de pareamento expirou.'));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Simular pareamento confirmado' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sua autorização de pareamento expirou.');
  expect(mocks.setSession).not.toHaveBeenCalled();
  expect(screen.queryByText('Área de trabalho aberta')).not.toBeInTheDocument();
});
it('an existing authenticated account goes straight to its authorized workspace after pairing', async () => {
  mocks.auth = { user: { id: 'existing' }, loading: false }; mocks.contexts = [sector];
  mocks.request.mockResolvedValue({ state: 'connected' });
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Simular pareamento confirmado' }));
  expect(await screen.findByText('Área de trabalho aberta')).toBeInTheDocument();
  expect(mocks.setSession).not.toHaveBeenCalled();
  expect(mocks.request.mock.calls.map(call => call[0])).toEqual(['activate']);
});
