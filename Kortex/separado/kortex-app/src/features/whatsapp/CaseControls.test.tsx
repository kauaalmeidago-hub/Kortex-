import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaseActionDialog, PhaseControl, TransferDialog } from './CaseControls';
import { waRequest, type WaConversation } from './api';
vi.mock('./api', () => ({ waRequest: vi.fn() }));
const row: WaConversation = { id: 'conversation', connection_id: 'origin', remote_jid: 'test', name: 'Cliente de teste', preview: '', last_message_at: '', unread_count: 0, status: 'triage', case_id: 'case', case_version: 2, can_claim: true, can_manage: true };
beforeEach(() => vi.resetAllMocks()); afterEach(cleanup);
it('the compact phase menu exposes claim and keeps unauthorized actions disabled', () => {
  const move = vi.fn();
  render(<PhaseControl conversation={{ ...row, can_manage: false }} onMove={move} />);
  fireEvent.click(screen.getByRole('button', { name: 'Alterar fase: Triagem' }));
  expect(screen.getByRole('menuitem', { name: 'Pendentes' })).toBeDisabled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Assumir atendimento' }));
  expect(move).toHaveBeenCalledWith('active');
});
it('requires reopening resolved requests and does not offer pending before a human claim', () => {
  const props = { onMove: vi.fn(), onNew: vi.fn() };
  const view = render(<PhaseControl conversation={row} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Alterar fase: Triagem' }));
  expect(screen.getByRole('menuitem', { name: 'Pendentes' })).toBeDisabled();
  view.rerender(<PhaseControl conversation={{ ...row, status: 'resolved' }} {...props} />);
  expect(screen.getByRole('menuitem', { name: 'Assumir atendimento' })).toBeDisabled();
  expect(screen.getByRole('menuitem', { name: 'Pendentes' })).toBeDisabled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Triagem' }));
  expect(props.onMove).toHaveBeenCalledWith('triage');
});
it('failed phase changes stay contextual and do not announce success or close the dialog', async () => {
  vi.mocked(waRequest).mockRejectedValue(new Error('Outro atendente já assumiu.'));
  const close = vi.fn(), refresh = vi.fn().mockResolvedValue(undefined);
  render(<CaseActionDialog conversation={row} action="claim" onClose={close} onChanged={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Assumir atendimento' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Outro atendente já assumiu.');
  expect(close).not.toHaveBeenCalled(); expect(refresh).toHaveBeenCalledOnce();
});
it('pending submits its reason and current version, then refreshes authorized lists', async () => {
  vi.mocked(waRequest).mockResolvedValue({ saved: true }); const refresh = vi.fn().mockResolvedValue(undefined), close = vi.fn();
  render(<CaseActionDialog conversation={{ ...row, status: 'active' }} action="pending" onClose={close} onChanged={refresh} />);
  fireEvent.change(screen.getByLabelText('Motivo e próxima providência'), { target: { value: 'Aguardando retorno da operadora' } });
  fireEvent.click(screen.getByRole('button', { name: 'Marcar como pendente' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(waRequest).toHaveBeenCalledWith('case-action', expect.objectContaining({ body: { caseId: 'case', version: 2, action: 'pending', reason: 'Aguardando retorno da operadora' } }));
  expect(refresh).toHaveBeenCalledOnce();
});
it('transfer presents only server-authorized destinations and records context without sending any WhatsApp message', async () => {
  vi.mocked(waRequest).mockImplementation(async action => action === 'case-destinations' ? [{ userId: 'fernando', name: 'Fernando', sectorId: 'sales', sector: 'Comercial', channelId: 'origin', channelOwner: 'Luísa', connected: true }] : { saved: true });
  const close = vi.fn(); render(<TransferDialog conversation={row} onClose={close} onChanged={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.change(await screen.findByLabelText('Setor, responsável e canal de continuidade'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Tipo de pedido'), { target: { value: 'Cotação' } });
  fireEvent.change(screen.getByLabelText('Resumo e informações coletadas'), { target: { value: 'Plano para empresa com 12 pessoas' } });
  fireEvent.change(screen.getByLabelText('Motivo e pendências'), { target: { value: 'Avaliar proposta' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar transferência' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(waRequest).toHaveBeenLastCalledWith('case-action', expect.objectContaining({ body: expect.objectContaining({ action: 'transfer', userId: 'fernando', channelId: 'origin', caseId: 'case', version: 2 }) }));
  expect(vi.mocked(waRequest).mock.calls.map(call => call[0])).toEqual(['case-destinations', 'case-action']);
});
it('an offline continuity channel cannot be selected and an empty authorized destination list cannot be submitted', async () => {
  vi.mocked(waRequest).mockResolvedValue([]);
  render(<TransferDialog conversation={row} onClose={vi.fn()} onChanged={vi.fn()} />);
  expect(await screen.findByText(/Não há outro destino autorizado/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirmar transferência' })).toBeDisabled();
});
