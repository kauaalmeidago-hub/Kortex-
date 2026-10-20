import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
import type { LeadRow, PipelineStage } from "./service";
vi.mock("./service", () => ({
  savePipelineColumn: vi.fn(),
  pipelineColumnCount: vi.fn(),
  removePipelineColumn: vi.fn(),
  restorePipelineColumn: vi.fn(),
}));
vi.mock("@/features/access/BusinessAccess", () => ({
  useBusinessAccess: () => ({
    token: "current",
    isCurrent: (t: string) => t === "current",
  }),
}));
import * as service from "./service";
import PipelineBoard from "./PipelineBoard";
const scope = {
  board_id: "board",
  pipeline_id: "pipeline",
  workspace_id: "workspace",
  sector_id: "sector",
  sector_name: "Relacionamento",
  can_manage: true,
  can_write: true,
  version: "version",
} as BusinessContext;
const stages = [
  { id: "stage-a", name: "Backlog", position: 0 },
  { id: "stage-b", name: "Boas-Vindas", position: 1 },
].map((s) => ({
  ...s,
  color: "blue",
  workspace_id: "workspace",
  pipeline_id: "pipeline",
  created_at: "2026-10-19",
})) as PipelineStage[];
const lead = {
  id: "lead",
  title: "Demanda existente",
  stage_id: "stage-a",
  description: "Contexto preservado",
  can_edit: true,
  value: 0,
  position: 0,
} as LeadRow;
const changed = vi.fn(),
  move = vi.fn();
function setup(props: Partial<Parameters<typeof PipelineBoard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PipelineBoard
        scope={scope}
        stages={stages}
        leads={[lead]}
        filtered={[lead]}
        financial={false}
        moving=""
        onMove={move}
        onChanged={changed}
        onAddRecord={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  changed.mockResolvedValue(undefined);
  vi.mocked(service.savePipelineColumn).mockResolvedValue(stages[0]);
  vi.mocked(service.pipelineColumnCount).mockResolvedValue(0);
});
afterEach(cleanup);
describe("pipeline stage identity and operations", () => {
  it("saves a trimmed title against the same stage ID once, with no blur save", async () => {
    let resolve: (v: PipelineStage) => void;
    vi.mocked(service.savePipelineColumn).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    setup();
    fireEvent.doubleClick(screen.getByRole("heading", { name: "Backlog" }));
    const input = screen.getByRole("textbox", { name: "Título de Backlog" });
    fireEvent.change(input, { target: { value: "  Implantação  " } });
    fireEvent.blur(input);
    expect(service.savePipelineColumn).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    // Submit explicitly: jsdom does not implement the browser's implicit Enter submit.
    fireEvent.submit(input.closest("form")!);
    fireEvent.submit(input.closest("form")!);
    expect(service.savePipelineColumn).toHaveBeenCalledTimes(1);
    expect(service.savePipelineColumn).toHaveBeenCalledWith(
      scope,
      "stage-a",
      "  Implantação  ",
    );
    resolve!(stages[0]);
    await screen.findByText("Título salvo.");
    expect(screen.getByRole("link", { name: lead.title })).toHaveAttribute(
      "href",
      "/leads/lead",
    );
  });
  it("cancels with Escape, blocks empty names and preserves the draft after failure", async () => {
    setup();
    fireEvent.doubleClick(screen.getByRole("heading", { name: "Backlog" }));
    const input = screen.getByRole("textbox", { name: "Título de Backlog" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("1 a 80");
    expect(service.savePipelineColumn).not.toHaveBeenCalled();
    vi.mocked(service.savePipelineColumn).mockRejectedValue(
      new Error("Conexão indisponível"),
    );
    fireEvent.change(input, { target: { value: "Título revisado" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("Conexão indisponível");
    expect(input).toHaveValue("Título revisado");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      screen.getByRole("heading", { name: "Backlog" }),
    ).toBeInTheDocument();
  });
  it("canceling creation writes nothing; repeated submits create only one stable ID", async () => {
    let resolve: (v: PipelineStage) => void;
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar coluna" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(service.savePipelineColumn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar coluna" }));
    vi.mocked(service.savePipelineColumn).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const input = screen.getByLabelText("Nome da etapa");
    fireEvent.change(input, { target: { value: "Revisão" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.submit(input.closest("form")!);
    expect(service.savePipelineColumn).toHaveBeenCalledTimes(1);
    expect(service.savePipelineColumn).toHaveBeenCalledWith(
      scope,
      expect.any(String),
      "Revisão",
      true,
    );
    resolve!(stages[0]);
    await screen.findByText("Etapa criada.");
  });
  it("requires a destination based on the server count, even when filters hide all cards", async () => {
    vi.mocked(service.pipelineColumnCount).mockResolvedValue(7);
    vi.mocked(service.removePipelineColumn).mockResolvedValue({
      count: 7,
      undoable: false,
    });
    setup({ filtered: [] });
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Ações da etapa Backlog" }),
      { key: "Enter" },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Remover etapa" }),
    );
    await screen.findByText(/7 registro\(s\)/);
    const dialog = screen.getByRole("dialog");
    const button = within(dialog).getByRole("button", {
      name: "Remover etapa",
    });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Mover os registros para"), {
      target: { value: "stage-b" },
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(service.removePipelineColumn).toHaveBeenCalledWith(
        scope,
        "stage-a",
        "stage-b",
        expect.any(String),
      ),
    );
    expect(
      screen.queryByRole("button", { name: /Desfazer remoção/ }),
    ).not.toBeInTheDocument();
  });
  it("restores an empty removed stage through its server receipt", async () => {
    vi.mocked(service.removePipelineColumn).mockResolvedValue({
      count: 0,
      undoable: true,
    });
    vi.mocked(service.restorePipelineColumn).mockResolvedValue("stage-a");
    setup();
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Ações da etapa Backlog" }),
      { key: "Enter" },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Remover etapa" }),
    );
    await screen.findByText(/Esta etapa está vazia/);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Remover etapa",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Desfazer remoção de Backlog",
      }),
    );
    await waitFor(() =>
      expect(service.restorePipelineColumn).toHaveBeenCalledWith(
        scope,
        expect.any(String),
      ),
    );
  });
  it("keeps permission restrictions, detail links and an alternative to drag", () => {
    setup({
      scope: { ...scope, can_manage: false },
      filtered: [{ ...lead, can_edit: false }],
    });
    fireEvent.doubleClick(screen.getByRole("heading", { name: "Backlog" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Adicionar coluna" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
  });
  it("moves the same record using the accessible stage selection", async () => {
    setup();
    expect(screen.queryByRole("combobox", {name:"Mover Demanda existente"})).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button",{name:"Ações de Demanda existente"}),{key:"Enter"});
    fireEvent.click(await screen.findByRole("menuitem",{name:"Mover para Boas-Vindas"}));
    expect(move).toHaveBeenCalledWith("lead", "stage-b");
  });
});

