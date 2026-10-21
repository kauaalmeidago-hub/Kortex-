import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsAppComposer, { type ComposerQuote, type WhatsAppComposerHandle } from './Composer';

const quote: ComposerQuote = { id: 'message-1', author: 'Cliente', preview: 'Preciso de cobertura nacional.' };
const NativeURL = URL;

beforeEach(() => {
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:attachment-preview');
    static revokeObjectURL = vi.fn();
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function attach(file = new File(['document'], 'proposta.pdf', { type: 'application/pdf' })) {
  fireEvent.change(screen.getByLabelText('Selecionar arquivo'), { target: { files: [file] } });
  return file;
}

describe('WhatsApp inbox composer', () => {
  it('preserves the draft and attachment when replacing or cancelling the quote', () => {
    const onClearQuote = vi.fn();
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<WhatsAppComposer disabled={false} quoted={quote} onClearQuote={onClearQuote} onSend={onSend} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem' }), { target: { value: 'Vou verificar.' } });
    attach();

    rerender(<WhatsAppComposer disabled={false} quoted={{ id: 'message-2', author: 'Você', preview: 'Outra mensagem.' }} onClearQuote={onClearQuote} onSend={onSend} />);
    expect(screen.getByRole('region', { name: 'Mensagem selecionada para resposta' })).toHaveTextContent('Respondendo para Você');
    expect(screen.getByText('Outra mensagem.')).toBeInTheDocument();
    expect(screen.queryByText(quote.preview)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Vou verificar.');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar resposta' }));
    expect(onClearQuote).toHaveBeenCalledTimes(1);
    rerender(<WhatsAppComposer disabled={false} onClearQuote={onClearQuote} onSend={onSend} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Vou verificar.');
    expect(screen.getByText(/proposta\.pdf/)).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('blocks duplicate sends and clears only after the send is confirmed', async () => {
    let confirm!: () => void;
    const onSend = vi.fn(() => new Promise<void>(resolve => { confirm = resolve; }));
    const onClearQuote = vi.fn();
    render(<WhatsAppComposer disabled={false} quoted={quote} onClearQuote={onClearQuote} onSend={onSend} />);
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: '  Segue a proposta.  ' } });
    const file = attach();
    const send = screen.getByRole('button', { name: 'Enviar mensagem' });

    fireEvent.click(send);
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Segue a proposta.', file);
    expect(field).toHaveValue('  Segue a proposta.  ');
    expect(field).toBeDisabled();
    expect(send).toHaveAttribute('aria-busy', 'true');
    expect(onClearQuote).not.toHaveBeenCalled();
    expect(screen.getByText(/proposta\.pdf/)).toBeInTheDocument();

    await act(async () => { confirm(); });
    expect(field).toHaveValue('');
    expect(screen.queryByText(/proposta\.pdf/)).not.toBeInTheDocument();
    expect(onClearQuote).toHaveBeenCalledTimes(1);
    expect(send).toHaveAttribute('aria-busy', 'false');
    expect(send).toBeDisabled();
  });

  it('keeps the draft, attachment and quote on failure without automatic retries', async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error('internal-service-detail')).mockResolvedValue(undefined);
    const onClearQuote = vi.fn();
    render(<WhatsAppComposer disabled={false} quoted={quote} onClearQuote={onClearQuote} onSend={onSend} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Texto em preparo' } });
    const file = attach();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Seu rascunho foi mantido.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('internal-service-detail');
    expect(screen.getByRole('textbox')).toHaveValue('Texto em preparo');
    expect(screen.getByText(/proposta\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(quote.preview)).toBeInTheDocument();
    expect(onClearQuote).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(onClearQuote).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenLastCalledWith('Texto em preparo', file);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('shares the send routine for Enter and click while respecting Shift+Enter and IME', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<WhatsAppComposer disabled={false} onClearQuote={vi.fn()} onSend={onSend} />);
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Olá' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.compositionEnd(field);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(field).toHaveValue(''));
    fireEvent.change(field, { target: { value: 'Mensagem por clique' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    await waitFor(() => expect(field).toHaveValue(''));
    expect(onSend.mock.calls).toEqual([['Olá', undefined], ['Mensagem por clique', undefined]]);
  });

  it('blocks blank and unavailable sends while keeping the regular placeholder', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<WhatsAppComposer disabled={false} onClearQuote={vi.fn()} onSend={onSend} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled();

    rerender(<WhatsAppComposer disabled unavailableReason="Revise o acesso em Configurações para enviar." onClearQuote={vi.fn()} onSend={onSend} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Digite uma mensagem...');
    expect(screen.getByRole('status')).toHaveTextContent('Revise o acesso em Configurações');
    expect(screen.getByRole('button', { name: 'Gravar áudio' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anexar arquivo de até 20 MB' })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('exposes focus and discards the old draft on context remount without clearing the new context', async () => {
    const ref = createRef<WhatsAppComposerHandle>();
    let confirm!: () => void;
    const onSend = vi.fn(() => new Promise<void>(resolve => { confirm = resolve; }));
    const onClearQuote = vi.fn();
    const { rerender } = render(<WhatsAppComposer key="context-1" ref={ref} disabled={false} quoted={quote} onClearQuote={onClearQuote} onSend={onSend} />);
    act(() => { ref.current?.focus(); });
    expect(screen.getByRole('textbox')).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Rascunho anterior' } });
    attach();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    rerender(<WhatsAppComposer key="context-2" ref={ref} disabled={false} onClearQuote={onClearQuote} onSend={onSend} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByText(/proposta\.pdf/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Novo contexto' } });
    await act(async () => { confirm(); });
    expect(screen.getByRole('textbox')).toHaveValue('Novo contexto');
    expect(onClearQuote).not.toHaveBeenCalled();
  });

  it('preserves a new quote selected while an earlier send is pending', async () => {
    let confirm!: () => void;
    const onSend = vi.fn(() => new Promise<void>(resolve => { confirm = resolve; }));
    const onClearQuote = vi.fn();
    const { rerender } = render(<WhatsAppComposer disabled={false} quoted={quote} onClearQuote={onClearQuote} onSend={onSend} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Resposta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    rerender(<WhatsAppComposer disabled={false} quoted={{ id: 'new-message', author: 'Cliente', preview: 'Próxima pergunta' }} onClearQuote={onClearQuote} onSend={onSend} />);

    await act(async () => { confirm(); });
    expect(onClearQuote).not.toHaveBeenCalled();
    expect(screen.getByText('Próxima pergunta')).toBeInTheDocument();
  });

  it('caps input growth and releases attachment previews when removed', () => {
    render(<WhatsAppComposer disabled={false} onClearQuote={vi.fn()} onSend={vi.fn()} />);
    const field = screen.getByRole('textbox');
    Object.defineProperty(field, 'scrollHeight', { configurable: true, value: 320 });
    fireEvent.change(field, { target: { value: 'Uma mensagem\ncom várias\nlinhas' } });
    expect(field.style.height).toBe('112px');
    Object.defineProperty(field, 'scrollHeight', { configurable: true, value: 22 });
    fireEvent.change(field, { target: { value: 'Curta' } });
    expect(field.style.height).toBe('38px');

    attach(new File(['image'], 'imagem.png', { type: 'image/png' }));
    expect(screen.getByAltText('Prévia do anexo')).toHaveAttribute('src', 'blob:attachment-preview');
    fireEvent.change(screen.getByLabelText('Selecionar arquivo'), { target: { files: [] } });
    expect(screen.getByAltText('Prévia do anexo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover anexo' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:attachment-preview');
    expect(screen.queryByAltText('Prévia do anexo')).not.toBeInTheDocument();
  });

  it('preserves audio recording, preview and attachment sending', async () => {
    const stopTrack = vi.fn();
    const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } });
    class TestRecorder {
      static isTypeSupported = () => true;
      state = 'inactive';
      mimeType = 'audio/ogg;codecs=opus';
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', TestRecorder);
    const onSend = vi.fn().mockResolvedValue(undefined);
    try {
      render(<WhatsAppComposer disabled={false} onClearQuote={vi.fn()} onSend={onSend} />);
      fireEvent.click(screen.getByRole('button', { name: 'Gravar áudio' }));
      const stop = await screen.findByRole('button', { name: 'Parar gravação e ouvir prévia' });
      expect(screen.getByRole('textbox')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled();
      fireEvent.click(stop);
      expect(screen.getByText(/audio-\d+\.ogg/)).toBeInTheDocument();
      expect(stopTrack).toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
      await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
      expect(onSend.mock.calls[0][0]).toBe('');
      expect(onSend.mock.calls[0][1]).toBeInstanceOf(File);
      expect(onSend.mock.calls[0][1].type).toBe('audio/ogg;codecs=opus');
    } finally {
      if (mediaDevicesDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor);
      else Reflect.deleteProperty(navigator, 'mediaDevices');
    }
  });
});
