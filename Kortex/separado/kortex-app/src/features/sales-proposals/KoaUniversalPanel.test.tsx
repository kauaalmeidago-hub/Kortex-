import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InboxPage from "@/pages/InboxPage";

const mocks = vi.hoisted(() => ({ ask: vi.fn(), opportunities: vi.fn(), auth: { user: null, workspace: null } as {
  user: null | { id: string; user_metadata: Record<string, string>; app_metadata: Record<string, string> }; workspace: null | { id: string };
} }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("./salesAssistantApi", () => ({ askSalesAssistant: mocks.ask, listSalesOpportunities: mocks.opportunities }));

const analysis = { summary: "Paulo pediu cobertura nacional para a empresa.", missingInformation: ["Idades dos beneficiários"],
  salesApproach: "Confirmar o perfil antes de cotar.", suggestedMessage: "Paulo, pode me informar as idades?", proposalOutline: "Preparar comparativo após a cotação." };

async function openKoa() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "KOA" })); }); }
function openProposal() { fireEvent.click(screen.getByRole("button", { name: "Elaborar proposta" })); }

beforeEach(() => {
  mocks.auth = { user: { id: "seller-a", user_metadata: {}, app_metadata: { department: "comercial" } }, workspace: { id: "12345678-1234-1234-1234-123456789abc" } };
  mocks.ask.mockReset().mockResolvedValue(analysis);
  mocks.opportunities.mockReset().mockResolvedValue([]);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("KOA universal no atendimento", () => {
  it("abre o mesmo KOA pelo acesso global da plataforma", async () => {
    render(<InboxPage />);
    await act(async () => { window.dispatchEvent(new Event("kortex:open-koa")); });
    expect(screen.getByRole("heading", { name: "KOA" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Elaborar proposta" })).toBeInTheDocument();
  });

  it("mantém o atalho de proposta somente dentro do KOA e oculta ferramentas de relacionamento no Comercial", async () => {
    render(<InboxPage />);
    expect(screen.queryByRole("button", { name: "Elaborar proposta" })).not.toBeInTheDocument();
    await openKoa();
    expect(screen.getByRole("heading", { name: "KOA" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Elaborar proposta" })).toBeInTheDocument();
    for (const name of ["Inclusão", "Exclusão", "Carteirinha"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    openProposal();
    expect(screen.getByRole("heading", { name: "Vamos elaborar a proposta" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Mensagem para o KOA" })).toBeInTheDocument();
  });

  it("mostra atalhos de relacionamento apenas no contexto do setor correspondente", async () => {
    mocks.auth.user.app_metadata.department = "relacionamento";
    render(<InboxPage />); await openKoa();
    expect(screen.getByRole("button", { name: "Inclusão" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exclusão" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carteirinha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Elaborar proposta" })).not.toBeInTheDocument();
  });

  it("não usa dados editáveis do perfil para liberar ferramentas de um setor", async () => {
    mocks.auth.user.app_metadata = {};
    mocks.auth.user.user_metadata = { department: "comercial" };
    render(<InboxPage />); await openKoa();
    expect(screen.getByText("Setor não configurado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Elaborar proposta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inclusão" })).not.toBeInTheDocument();
  });

  it("aceita o pedido de elaborar proposta pelo próprio compositor do KOA", async () => {
    render(<InboxPage />); await openKoa();
    fireEvent.change(screen.getByRole("textbox", { name: "Mensagem para o KOA" }), { target: { value: "Elaborar proposta" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao KOA" }));
    expect(screen.getByRole("heading", { name: "Vamos elaborar a proposta" })).toBeInTheDocument();
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("usa apenas o cliente aberto e insere sugestão sem enviar", async () => {
    render(<InboxPage />); await openKoa();
    fireEvent.click(screen.getByRole("button", { name: "Analisar cliente" }));
    await screen.findByText(analysis.summary);
    expect(mocks.ask.mock.calls[0][0].client.name).toBe("Paulo");
    expect(JSON.stringify(mocks.ask.mock.calls[0][0])).not.toContain("Thiago");
    const composer = screen.getByRole("textbox", { name: "Mensagem ao cliente" });
    fireEvent.change(composer, { target: { value: "Boa tarde!" } });
    fireEvent.click(screen.getByRole("button", { name: /Inserir no campo de mensagem/ }));
    expect(composer).toHaveValue(`Boa tarde!\n\n${analysis.suggestedMessage}`);
    expect(screen.queryByText(analysis.suggestedMessage, { selector: ".rounded-br-md" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Thiago/ }));
    await waitFor(() => expect(screen.queryByLabelText("KOA — Thiago")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /P Paulo 15:36/ }));
    expect(screen.getByRole("textbox", { name: "Mensagem ao cliente" })).toHaveValue("");
  });

  it("mantém rascunhos separados ao fechar e trocar de cliente", async () => {
    render(<InboxPage />); await openKoa(); openProposal();
    fireEvent.change(screen.getByLabelText("Total de vidas confirmado"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Fechar KOA" }));
    await waitFor(() => expect(screen.queryByLabelText("KOA — Paulo")).not.toBeInTheDocument());
    await openKoa(); openProposal();
    expect(screen.getByLabelText("Total de vidas confirmado")).toHaveValue("12");
    fireEvent.click(screen.getByRole("button", { name: /Thiago/ }));
    await waitFor(() => expect(screen.queryByLabelText("KOA — Thiago")).not.toBeInTheDocument());
    await openKoa(); openProposal();
    expect(screen.getByLabelText("Total de vidas confirmado")).toHaveValue("");
  });

  it("descarta análise em andamento quando o vendedor troca de cliente", async () => {
    let resolve: (value: typeof analysis) => void;
    mocks.ask.mockImplementation(() => new Promise(done => { resolve = done; }));
    render(<InboxPage />); await openKoa();
    fireEvent.click(screen.getByRole("button", { name: "Analisar cliente" }));
    const signal = mocks.ask.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: /Thiago/ }));
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(analysis); });
    expect(screen.queryByText(analysis.summary)).not.toBeInTheDocument();
  });

  it("permite rascunho sem simular IA quando não existe sessão", async () => {
    mocks.auth = { user: null, workspace: null };
    render(<InboxPage />); await openKoa();
    fireEvent.click(screen.getByRole("button", { name: "Analisar cliente" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Entre em uma conta");
    expect(mocks.ask).not.toHaveBeenCalled();
    openProposal();
    fireEvent.click(screen.getByRole("button", { name: "Revisar apresentação" }));
    expect(screen.getByRole("alert")).toHaveTextContent("origem da cotação");
  });
});
