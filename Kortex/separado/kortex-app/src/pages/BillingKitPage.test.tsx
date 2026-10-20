import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BillingKitPage from "./BillingKitPage";

const mocks = vi.hoisted(() => ({
  auth: { workspace: null, user: null, loading: false } as {
    workspace: { id: string } | null;
    user: { id: string } | null;
    loading: boolean;
  },
  from: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BillingKitPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mocks.auth = { workspace: null, user: null, loading: false };
  mocks.from.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("billing page availability", () => {
  it("does not invent orders, downloads, or an authenticated company list", () => {
    renderPage();
    expect(screen.getByText("0 pedidos exibidos")).toBeInTheDocument();
    expect(screen.getByText("Nenhum pedido carregado")).toBeInTheDocument();
    expect(
      screen.queryByText(
        /Os pedidos e arquivos de faturamento ainda não estão conectados/,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Baixar/ }),
    ).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("shows and clears the search-without-results state", () => {
    renderPage();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar empresa" }),
      { target: { value: "inexistente" } },
    );
    expect(screen.getByText("Nenhum pedido encontrado")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Limpar busca e filtros" }),
    );
    expect(screen.getByText("Nenhum pedido carregado")).toBeInTheDocument();
  });
  it("keeps the creation dialog interactive but prevents an unsupported submission", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Solicitar pedido" }),
    ).toBeDisabled();
    expect(screen.queryByText(/Entre na plataforma/)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Empresa" })).toBeDisabled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("uses the transparent decorative folder without changing the empty-state copy", () => {
    renderPage();
    const folder = document.querySelector(
      'img[src="/brand/billing-empty-folder-transparent.png"]',
    );
    expect(folder).toHaveAttribute("alt", "");
    expect(folder).toHaveAttribute("aria-hidden", "true");
    expect(folder).toHaveClass("billing-kit-empty-folder", "object-contain");
    expect(screen.getByText("Nenhum pedido carregado")).toBeInTheDocument();
  });
  it("updates the existing request-type state with a single selected card", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    expect(
      screen.queryByRole("combobox", { name: "Tipo de pedido" }),
    ).not.toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "Boleto mensal" })).toBeChecked();
    fireEvent.click(
      screen.getByRole("radio", { name: "Kit faturamento completo" }),
    );
    expect(
      screen.getByRole("radio", { name: "Kit faturamento completo" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Kit faturamento completo" }),
    ).toHaveAttribute("value", "Kit faturamento completo");
    expect(
      radios.filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(
        'img[src="/brand/billing-request-folder-flat.png"]',
      ),
    ).toHaveLength(4);
    expect(
      screen.getByRole("button", { name: "Solicitar pedido" }),
    ).toBeDisabled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("closes the manual modal and restores focus to its trigger", async () => {
    renderPage();
    const trigger = screen.getByRole("button", { name: "Novo pedido" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByRole("button", { name: "Fechar pedido manual" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
  it("opens the billing panel directly while preserving the KOA identity", () => {
    renderPage();
    const button = screen.getByRole("button", { name: "Abrir chat do KOA" });
    expect(button.querySelector("img")).toHaveAttribute(
      "src",
      "/brand/koa-minimized-robot.png",
    );
    expect(button.querySelector(".koa-brand")).toHaveClass("koa-symbol-motion");
    fireEvent.click(button);
    const panel = screen.getByRole("complementary", {
      name: "KOA do Kit Faturamento",
    });
    expect(panel).toHaveClass("koa-panel-enter");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /conversas/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", {
        name: "Mensagem para o KOA do faturamento",
      }),
    ).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Kit de faturamento" }));
    expect(screen.queryByText("O que deseja emitir?")).not.toBeInTheDocument();
    expect(
      within(panel).getByRole("group", { name: "Empresa" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Iniciar busca" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Anexar arquivo" }),
    ).toBeDisabled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("keeps one panel and one sidebar event through repeated clicks and a quick reopen", () => {
    vi.useFakeTimers();
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const { unmount } = renderPage();
    const trigger = screen.getByRole("button", { name: "Abrir chat do KOA" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(
      screen.getAllByRole("complementary", { name: "KOA do Kit Faturamento" }),
    ).toHaveLength(1);
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Mensagem para o KOA do faturamento",
      }),
      { target: { value: "Rascunho preservado" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Fechar KOA do faturamento" }),
    );
    expect(document.getElementById("billing-koa-panel")).toHaveAttribute(
      "data-state",
      "closing",
    );
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    act(() => vi.advanceTimersByTime(300));
    expect(
      screen.getByRole("textbox", {
        name: "Mensagem para o KOA do faturamento",
      }),
    ).toHaveValue("Rascunho preservado");
    expect(
      dispatch.mock.calls.filter(
        ([event]) => event.type === "kortex:koa-panel-open",
      ),
    ).toHaveLength(1);
    expect(
      dispatch.mock.calls.filter(
        ([event]) => event.type === "kortex:koa-panel-close",
      ),
    ).toHaveLength(0);
    fireEvent.keyDown(
      screen.getByRole("textbox", {
        name: "Mensagem para o KOA do faturamento",
      }),
      { key: "Escape" },
    );
    act(() => vi.advanceTimersByTime(220));
    expect(document.getElementById("billing-koa-panel")).toHaveAttribute(
      "hidden",
    );
    expect(
      dispatch.mock.calls.filter(
        ([event]) => event.type === "kortex:koa-panel-close",
      ),
    ).toHaveLength(1);
    fireEvent.click(trigger);
    unmount();
    expect(
      dispatch.mock.calls.filter(
        ([event]) => event.type === "kortex:koa-panel-close",
      ),
    ).toHaveLength(2);
  });
  it("preserves the selected billing context and unsent message on close/reopen", async () => {
    mocks.auth = {
      workspace: { id: "workspace-test" },
      user: { id: "user-test" },
      loading: false,
    };
    const range = vi.fn().mockResolvedValue({
      data: [{ id: "company-test", name: "Empresa unitária" }],
      error: null,
    });
    const order = vi.fn();
    const eq = vi.fn().mockReturnValue({ order });
    order.mockReturnValue({ order, range });
    mocks.from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });
    renderPage();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar empresa" }),
      { target: { value: "Filtro mantido" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir chat do KOA" }));
    fireEvent.click(screen.getByRole("button", { name: "NF" }));
    fireEvent.click(
      await screen.findByRole("radio", { name: "Empresa unitária" }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Operadora" }), {
      target: { value: "NDI" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Competência" }), {
      target: { value: "09/2026" },
    });
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Mensagem para o KOA do faturamento",
      }),
      { target: { value: "Consultar as notas" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "O envio de mensagens de faturamento ainda não está conectado",
    );
    expect(
      screen.getByRole("button", { name: "Iniciar busca" }),
    ).toBeDisabled();
    expect(eq).toHaveBeenCalledWith("workspace_id", "workspace-test");
    fireEvent.click(
      screen.getByRole("button", { name: "Fechar KOA do faturamento" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "KOA do Kit Faturamento" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir chat do KOA" }));
    expect(
      screen.getByLabelText("Tipo de faturamento escolhido"),
    ).toHaveTextContent("NF");
    expect(
      screen.getByRole("radio", { name: "Empresa unitária" }),
    ).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Operadora" })).toHaveValue(
      "NDI",
    );
    expect(screen.getByRole("textbox", { name: "Competência" })).toHaveValue(
      "09/2026",
    );
    expect(
      screen.getByRole("textbox", {
        name: "Mensagem para o KOA do faturamento",
      }),
    ).toHaveValue("Consultar as notas");
    expect(
      screen.getByRole("searchbox", { name: "Buscar empresa" }),
    ).toHaveValue("Filtro mantido");
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar empresa no KOA" }),
      { target: { value: "sem resultado" } },
    );
    expect(screen.getByText("Nenhuma empresa encontrada.")).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar empresa no KOA" }),
      { target: { value: "unitária" } },
    );
    expect(
      screen.getByRole("radio", { name: "Empresa unitária" }),
    ).toBeChecked();
    expect(
      mocks.from.mock.calls.every(([table]) => table === "companies"),
    ).toBe(true);
  });
  it("uses a static brand and closes immediately with reduced motion", () => {
    const originalMedia = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...originalMedia(query),
      matches: query.includes("prefers-reduced-motion"),
    }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Abrir chat do KOA" }));
    expect(
      document.querySelector(".billing-kit-koa-brand video"),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector(".billing-kit-koa-brand img"),
    ).toHaveAttribute("src", "/brand/koa-billing-folder-poster.png");
    fireEvent.click(
      screen.getByRole("button", { name: "Fechar KOA do faturamento" }),
    );
    expect(document.getElementById("billing-koa-panel")).toHaveAttribute(
      "hidden",
    );
  });
  it("lets an inner selection or the manual dialog handle Escape first", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Abrir chat do KOA" }));
    fireEvent.click(screen.getByRole("button", { name: "Boleto" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Operadora" }), {
      key: "Escape",
    });
    expect(document.getElementById("billing-koa-panel")).toHaveAttribute(
      "data-state",
      "open",
    );
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.getElementById("billing-koa-panel")).toHaveAttribute(
      "data-state",
      "open",
    );
  });
  it("loads company names only through the active workspace query", async () => {
    mocks.auth = {
      workspace: { id: "workspace-test" },
      user: { id: "user-test" },
      loading: false,
    };
    const range = vi.fn().mockResolvedValue({
      data: [{ id: "company-test", name: "Empresa unitária" }],
      error: null,
    });
    const order = vi.fn();
    const eq = vi.fn().mockReturnValue({ order });
    order.mockReturnValue({ order, range });
    mocks.from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Empresa unitária" }),
      ).toBeInTheDocument(),
    );
    expect(mocks.from).toHaveBeenCalledWith("companies");
    expect(eq).toHaveBeenCalledWith("workspace_id", "workspace-test");
    expect(
      screen.getByRole("button", { name: "Solicitar pedido" }),
    ).toBeDisabled();
    expect(screen.getByText("0 pedidos exibidos")).toBeInTheDocument();
  });
  it("shows a retry state after a real company-query failure", async () => {
    mocks.auth = {
      workspace: { id: "workspace-test" },
      user: { id: "user-test" },
      loading: false,
    };
    const range = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "failure" } });
    const order = vi.fn();
    order.mockReturnValue({ order, range });
    mocks.from.mockReturnValue({
      select: vi
        .fn()
        .mockReturnValue({ eq: vi.fn().mockReturnValue({ order }) }),
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Não foi possível carregar as empresas.",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Empresa" })).toBeDisabled();
  });
});
