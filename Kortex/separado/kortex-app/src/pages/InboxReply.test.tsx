import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import InboxPage from "./InboxPage";

vi.setConfig({ testTimeout: 15000 });

const controls = vi.hoisted(() => ({
  user: "user-a", scopeKey: "scope-a", activeId: "conversation-a", group: false, error: "", send: vi.fn(), select: vi.fn(), download: vi.fn(),
}));
vi.mock("@/features/auth/localBypass", () => ({ localAuthBypass: false }));
vi.mock("@/features/whatsapp/useInbox", () => ({
  useWhatsAppScope: () => ({ scope: { workspaceId: "workspace-a", sectorId: "sector-a" }, loading: false, error: null, retry: vi.fn() }),
  useInbox: () => ({
    scopeKey: `${controls.user}:${controls.scopeKey}`, activeId: controls.activeId, canSend: true, dataError: controls.error,
    connection: { data: { id: "connection-a", state: "connected" } },
    conversations: { data: [
      { id: "conversation-a", name: "Paulo", preview: "Cobertura nacional", status: "active", remote_jid: controls.group ? "1203630000@g.us" : "5511999990000@s.whatsapp.net", last_message_at: "2026-10-21T15:36:00Z" },
      { id: "conversation-b", name: "Fernanda", preview: "Outro atendimento", status: "pending", remote_jid: "5511999990001@s.whatsapp.net", last_message_at: "2026-10-21T15:37:00Z" },
    ], isLoading: false },
    messages: { fetchNextPage: vi.fn(), hasNextPage: false, isFetching: false },
    rows: controls.activeId === "conversation-a" ? [
      { id: "row-1", provider_id: "provider-1", body: "Cobertura nacional", participant: controls.group ? "5511987654321@s.whatsapp.net" : undefined, sent_at: "2026-10-21T15:30:00Z", from_me: false, kind: "text" },
      { id: "row-2", provider_id: "provider-2", body: "Vou verificar", sent_at: "2026-10-21T15:31:00Z", from_me: true, kind: "text" },
      { id: "row-3", provider_id: "provider-3", body: "Confira https://example.com/plano", sent_at: "2026-10-21T15:32:00Z", from_me: false, kind: "text" },
      { id: "row-4", provider_id: "provider-4", body: "", media_name: "proposta.pdf", sent_at: "2026-10-21T15:33:00Z", from_me: false, kind: "document" },
    ] : [],
    send: controls.send, select: controls.select, refresh: vi.fn(),
  }),
}));
vi.mock("@/features/whatsapp/api", () => ({ waRequest: (...args: unknown[]) => controls.download(...args) }));

beforeEach(() => {
  controls.user = "user-a"; controls.scopeKey = "scope-a"; controls.activeId = "conversation-a"; controls.group = false; controls.error = "";
  controls.send.mockReset().mockResolvedValue(undefined);
  controls.select.mockReset(); controls.download.mockReset().mockResolvedValue({ url: "https://example.com/proposta.pdf" });
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as Selection);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Inbox reply interaction", () => {
  it("selects a message in one click, focuses the draft, replaces/cancels just the quote, sends its row id", async () => {
    render(<InboxPage />);
    const input = screen.getByRole("textbox", { name: "Mensagem" });
    fireEvent.change(input, { target: { value: "Minha resposta" } });
    fireEvent.click(screen.getByText("Cobertura nacional", { selector: ".inbox-message-body" }));
    expect(input).toHaveFocus();
    expect(screen.getByText("Respondendo para")).toHaveTextContent("Respondendo para Paulo");
    fireEvent.click(screen.getByText("Vou verificar", { selector: ".inbox-message-body" }));
    expect(screen.getByText("Respondendo para")).toHaveTextContent("Você");
    expect(input).toHaveValue("Minha resposta");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar resposta" }));
    expect(input).toHaveValue("Minha resposta");
    expect(screen.queryByText("Respondendo para")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Responder à mensagem de Paulo: Cobertura/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    await waitFor(() => expect(controls.send).toHaveBeenCalledWith("conversation-a", "Minha resposta", undefined, "row-1"));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(screen.queryByText("Respondendo para")).not.toBeInTheDocument();
  });

  it("keeps the quote and draft when send fails or is uncertain", async () => {
    controls.send.mockRejectedValue(new Error("Envio sem confirmação."));
    render(<InboxPage />);
    fireEvent.click(screen.getByText("Cobertura nacional", { selector: ".inbox-message-body" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Mensagem" }), { target: { value: "Conferindo" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/confirmar|enviar|confirmação/i);
    expect(screen.getByRole("textbox", { name: "Mensagem" })).toHaveValue("Conferindo");
    expect(screen.getByText("Respondendo para")).toHaveTextContent("Paulo");
    expect(controls.send).toHaveBeenCalledTimes(1);
  });

  it("identifies a group author with the available participant, never the group name", () => {
    controls.group = true;
    render(<InboxPage />);
    fireEvent.click(screen.getByText("Cobertura nacional", { selector: ".inbox-message-body" }));
    expect(screen.getByText("Respondendo para")).toHaveTextContent("5511987654321");
  });

  it("does not open a late media response after changing authorized context", async () => {
    let resolveDownload: (value: { url: string }) => void;
    controls.download.mockReturnValue(new Promise((resolve) => { resolveDownload = resolve; }));
    const open = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const view = render(<InboxPage />);
    fireEvent.click(screen.getByRole("button", { name: /Abrir anexo/ }));
    controls.scopeKey = "scope-b";
    view.rerender(<InboxPage />);
    await act(async () => { resolveDownload({ url: "https://example.com/proposta.pdf" }); });
    expect(open).not.toHaveBeenCalled();
  });

  it("ignores links, file controls and copied text; previews a captionless file accurately", () => {
    render(<InboxPage />);
    fireEvent.click(screen.getByRole("link", { name: "https://example.com/plano" }));
    expect(screen.queryByText("Respondendo para")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Abrir anexo/ }));
    expect(screen.queryByText("Respondendo para")).not.toBeInTheDocument();
    vi.mocked(window.getSelection).mockReturnValue({ toString: () => "Cobertura" } as Selection);
    fireEvent.click(screen.getByText("Cobertura nacional", { selector: ".inbox-message-body" }));
    expect(screen.queryByText("Respondendo para")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Responder à mensagem de Paulo: proposta.pdf/ }));
    expect(screen.getByText("proposta.pdf")).toBeInTheDocument();
  });

  it.each(["conversation", "account", "scope"])("clears the quote when switching %s", (boundary) => {
    const view = render(<InboxPage />);
    fireEvent.click(screen.getByText("Cobertura nacional", { selector: ".inbox-message-body" }));
    if (boundary === "conversation") controls.activeId = "conversation-b";
    if (boundary === "account") controls.user = "user-b";
    if (boundary === "scope") controls.scopeKey = "scope-b";
    view.rerender(<InboxPage />);
    expect(screen.queryByText("Respondendo para")).not.toBeInTheDocument();
  });

  it("has no connection/sector controls, and preserves loaded history during a refresh failure", () => {
    controls.error = "Temporariamente indisponível";
    render(<InboxPage />);
    expect(screen.getByText("Vou verificar")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Conversas" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Setor/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Conectar WhatsApp|WhatsApp conectado|Desconectar/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Responder", { exact: true })).not.toBeInTheDocument();
  });
});
