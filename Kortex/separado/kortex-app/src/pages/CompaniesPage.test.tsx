import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompaniesPage from "./CompaniesPage";
import CompanyProfilePage from "./CompanyProfilePage";
import { companyFixture } from "@/test/companyFixtures";
import type { Company, CompanyValues } from "@/features/companies/model";
const mocks = vi.hoisted(() => ({
  auth: {
    workspace: { id: "workspace-test" },
    user: { id: "user-test" },
    loading: false,
  } as {
    workspace: { id: string } | null;
    user: { id: string } | null;
    loading: boolean;
  },
  listCompanies: vi.fn(),
  getCompany: vi.fn(),
  saveCompany: vi.fn(),
  listCompanyContacts: vi.fn(),
  listCompanyNotes: vi.fn(),
  saveCompanyNote: vi.fn(),
  listCompanyFiles: vi.fn(),
  saveCompanyContact: vi.fn(),
  unassignedCompanyContacts: vi.fn(),
  linkCompanyContact: vi.fn(),
  validateImage: vi.fn(),
  uploadCompanyFile: vi.fn(),
  companyFileUrl: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/features/companies/service", () => mocks);
let records: Company[];
function renderApp(path = "/companies") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/companies" element={<CompaniesPage />} />
          <Route
            path="/companies/:companyId"
            element={<CompanyProfilePage />}
          />
          <Route
            path="/companies/:companyId/files"
            element={<CompanyProfilePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = {
    workspace: { id: "workspace-test" },
    user: { id: "user-test" },
    loading: false,
  };
  records = [structuredClone(companyFixture)];
  mocks.listCompanies.mockImplementation(async () => records);
  mocks.getCompany.mockImplementation(
    async (_ws, id) => records.find((c) => c.id === id) ?? null,
  );
  mocks.saveCompany.mockImplementation(
    async (_scope, values: CompanyValues, previous?: Company) => {
      const saved = {
        ...companyFixture,
        ...values,
        id: previous?.id ?? "00000000-0000-4000-8000-000000000002",
        cnpj: values.cnpj.replace(/\D/g, ""),
      };
      records = [saved, ...records.filter((c) => c.id !== saved.id)];
      return saved;
    },
  );
  mocks.listCompanyContacts.mockResolvedValue([]);
  mocks.listCompanyNotes.mockResolvedValue([]);
  mocks.listCompanyFiles.mockResolvedValue([]);
  mocks.unassignedCompanyContacts.mockResolvedValue([]);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:company-test"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(cleanup);
describe("company screens", () => {
  it("keeps all results accessible with shared pagination and page-size controls", async () => {
    records = Array.from({ length: 13 }, (_, index) => ({
      ...companyFixture,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `Empresa ${String(index).padStart(2, "0")}`,
      cnpj: null,
    }));
    renderApp();
    await screen.findByRole("link", { name: "Empresa 00" });
    expect(screen.getAllByRole("link", { name: /Empresa \d/ })).toHaveLength(
      10,
    );
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    expect(screen.getAllByRole("link", { name: /Empresa \d/ })).toHaveLength(3);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Empresas por página" }),
      { target: { value: "50" } },
    );
    expect(screen.getAllByRole("link", { name: /Empresa \d/ })).toHaveLength(
      13,
    );
  });
  it("shows only the unavailable session state when there is no authenticated workspace", () => {
    mocks.auth = { workspace: null, user: null, loading: false };
    renderApp();
    expect(screen.getByText("0 empresas exibidas")).toBeInTheDocument();
    expect(screen.queryByText("RM Books")).not.toBeInTheDocument();
    expect(mocks.listCompanies).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar empresa" }));
    expect(
      screen.getByRole("button", { name: "Salvar empresa" }),
    ).toBeDisabled();
  });
  it("keeps search, filter and view state shared between List and Grid", async () => {
    renderApp();
    await screen.findByRole("link", { name: companyFixture.name });
    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "Buscar empresa por nome ou CNPJ",
      }),
      { target: { value: "11.222.333/0001-81" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("link", { name: companyFixture.name }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.change(screen.getByLabelText("Produto"), {
      target: { value: "Saúde" },
    });
    fireEvent.change(screen.getByLabelText("Operadora"), {
      target: { value: "NDI" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Nenhuma empresa encontrada")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("11.222.333/0001-81");
  });
  it("creates, opens, edits and returns to the same filtered Grid using saved fields", async () => {
    renderApp("/companies?view=grid&q=Alfa");
    await screen.findByRole("link", { name: companyFixture.name });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar empresa" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Empresa")).toHaveValue("");
    expect(within(dialog).getByLabelText("Projeto")).toHaveValue("");
    for (const [label, value] of [
      ["Empresa", "Nova empresa Alfa"],
      ["CNPJ", "11.222.333/0001-81"],
      ["Telefone", "11900000001"],
      ["E-mail", "cadastro@empresa.invalid"],
      ["Cidade", "Cidade nova"],
      ["Responsável", "Responsável novo"],
    ])
      fireEvent.change(within(dialog).getByLabelText(label), {
        target: { value },
      });
    fireEvent.change(within(dialog).getByLabelText("Projeto"), {
      target: { value: "PME" },
    });
    fireEvent.change(within(dialog).getByLabelText("Produto"), {
      target: { value: "Saúde" },
    });
    fireEvent.change(within(dialog).getByLabelText("Operadora"), {
      target: { value: "Hapvida" },
    });
    fireEvent.change(within(dialog).getByLabelText("Imagem da empresa"), {
      target: { files: [new File(["png"], "logo.png", { type: "image/png" })] },
    });
    expect(
      await within(dialog).findByRole("button", { name: "Remover imagem" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar empresa" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(await screen.findByLabelText("Empresa")).toHaveValue(
      "Nova empresa Alfa",
    );
    expect(screen.getByLabelText("Cidade")).toHaveValue("Cidade nova");
    expect(screen.getByLabelText("Responsável")).toHaveValue(
      "Responsável novo",
    );
    expect(mocks.saveCompany.mock.calls[0][1].offerings).toEqual([
      { product: "Saúde", operator: "Hapvida" },
    ]);
    expect(mocks.saveCompany.mock.calls[0][3]).toBeInstanceOf(File);
    fireEvent.change(screen.getByLabelText("Empresa"), {
      target: { value: "Alfa atualizada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await screen.findByText("Alterações salvas.");
    fireEvent.click(screen.getByRole("link", { name: "Voltar para empresas" }));
    expect(
      await screen.findByRole("link", { name: "Alfa atualizada" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("searchbox")).toHaveValue("Alfa");
  });
  it("preserves the draft and all existing offerings after a failed write", async () => {
    mocks.saveCompany.mockRejectedValue(
      new Error("Não foi possível salvar a empresa."),
    );
    renderApp(`/companies/${companyFixture.id}`);
    await screen.findByLabelText("Empresa");
    expect(screen.getByLabelText("Produto 2")).toHaveValue("Odonto");
    fireEvent.change(screen.getByLabelText("Cidade"), {
      target: { value: "Rascunho mantido" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível",
    );
    expect(screen.getByLabelText("Cidade")).toHaveValue("Rascunho mantido");
    expect(screen.queryByText("Alterações salvas.")).not.toBeInTheDocument();
  });
  it("loads the correct profile by URL and saves notes against that same company", async () => {
    mocks.saveCompanyNote.mockResolvedValue({ id: "note-test" });
    renderApp(`/companies/${companyFixture.id}`);
    await screen.findByLabelText("Empresa");
    expect(mocks.getCompany).toHaveBeenCalledWith(
      "workspace-test",
      companyFixture.id,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Notas" }));
    fireEvent.change(screen.getByLabelText("Nova nota"), {
      target: { value: "Nota da empresa aberta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nota" }));
    await waitFor(() =>
      expect(mocks.saveCompanyNote).toHaveBeenCalledWith(
        { workspaceId: "workspace-test", userId: "user-test" },
        companyFixture.id,
        "Nota da empresa aberta",
        undefined,
      ),
    );
  });
  it("keeps the existing files route and lets the user switch tabs", async () => {
    renderApp(`/companies/${companyFixture.id}/files`);
    await screen.findByLabelText("Empresa");
    expect(screen.getByRole("tab", { name: "Arquivos" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Conversa" }));
    expect(
      screen.getByText("Selecione um contato para conversar."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });
  it("shows not-found for an unknown profile instead of a demonstration record", async () => {
    mocks.getCompany.mockResolvedValue(null);
    renderApp("/companies/00000000-0000-4000-8000-000000000099");
    expect(
      await screen.findByText("Empresa não encontrada"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Salvar alterações" }),
    ).not.toBeInTheDocument();
  });
});
