import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectionModal from './ConnectionModal';
import { waRequest } from './api';
vi.mock('./api', () => ({ waRequest: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);
describe('WhatsApp pairing modal with mocked transport', () => {
  it('displays a genuine provider image unchanged and keeps continue disabled before confirmed connection', async () => {
    vi.mocked(waRequest).mockResolvedValue({ id: 'test', state: 'qr', qr: 'data:image/png;base64,YWJj', qrExpiresAt: new Date(Date.now() + 30000).toISOString() });
    render(<ConnectionModal open onOpenChange={vi.fn()} onContinue={vi.fn()} temporary />);
    const image = await screen.findByAltText(/QR Code de pareamento/);
    expect(image).toHaveAttribute('src', 'data:image/png;base64,YWJj');
    expect(screen.getByRole('button', { name: /Prosseguir/ })).toBeDisabled();
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(waRequest).toHaveBeenCalledWith('prepare', expect.objectContaining({ temporary: true, body: {} }));
  });
  it('removes QR after confirmed pairing without asking for email verification', async () => {
    vi.mocked(waRequest).mockResolvedValue({ id: 'test', state: 'connected', emailPending: true });
    const proceed = vi.fn();
    render(<ConnectionModal open onOpenChange={vi.fn()} onContinue={proceed} temporary />);
    expect((await screen.findAllByText('WhatsApp conectado')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Confirme seu e-mail/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Prosseguir/ })); expect(proceed).toHaveBeenCalledOnce();
  });
  it('offers renewal after expiration without showing a stale image', async () => {
    vi.mocked(waRequest).mockResolvedValue({ id: 'test', state: 'expired' });
    render(<ConnectionModal open onOpenChange={vi.fn()} onContinue={vi.fn()} temporary />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar novo QR Code' }));
    await waitFor(() => expect(waRequest).toHaveBeenCalledWith('renew', expect.anything()));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('explains missing infrastructure and never fabricates a QR', async () => {
    vi.mocked(waRequest).mockRejectedValue(new Error('Servidor de pareamento indisponível.'));
    render(<ConnectionModal open onOpenChange={vi.fn()} onContinue={vi.fn()} temporary />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Servidor de pareamento indisponível.');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prosseguir/ })).toBeDisabled();
  });
  it('aborts pending requests when closed, preserving provider session', async () => {
    let signal: AbortSignal;
    vi.mocked(waRequest).mockImplementation(async (_action, options) => { signal = options!.signal; return new Promise(() => {}); });
    const props = { onOpenChange: vi.fn(), onContinue: vi.fn(), temporary: true };
    const view = render(<ConnectionModal open {...props} />);
    await waitFor(() => expect(waRequest).toHaveBeenCalledOnce());
    view.rerender(<ConnectionModal open={false} {...props} />);
    expect(signal!.aborted).toBe(true);
    expect(waRequest).not.toHaveBeenCalledWith('disconnect', expect.anything());
  });
});
