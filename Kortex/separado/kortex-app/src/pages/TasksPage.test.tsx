import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksWorkspace } from "./TasksPage";
import TaskFormDialog from "@/components/tasks/TaskFormDialog";
import { taskCatalogFixture, taskFixture, taskIds } from "@/test/taskFixtures";
import { taskValues } from "@/features/tasks/model";
afterEach(cleanup);
function wrap(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const catalog = taskCatalogFixture();
describe("task workspace", () => {
  it("removes the session banner and both selectors while preserving received tasks, queues and filters", () => {
    const received = taskFixture({
      id: "received",
      title: "Recebida do administrador",
      created_by: taskIds.admin,
    });
    const queued = taskFixture({
      id: "queued",
      title: "Fila autorizada do setor",
      created_by: taskIds.admin,
      assigned_to: null,
      sector_id: taskIds.sector,
    });
    wrap(
      <TasksWorkspace
        tasks={[received, queued]}
        catalog={catalog}
        userId={taskIds.user}
      />,
    );
    expect(
      screen.queryByText(/Entre em um workspace para consultar/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Entrar na plataforma" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Ordenar tarefas" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Escopo das tarefas" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Recentes")).not.toBeInTheDocument();
    expect(screen.queryByText("Todas autorizadas")).not.toBeInTheDocument();
    for (const view of ["Lista", "Timeline", "Checklist", "Kanban"]) {
      fireEvent.click(screen.getByRole("tab", { name: view }));
      expect(screen.getByText("Recebida do administrador")).toBeInTheDocument();
      expect(screen.getByText("Fila autorizada do setor")).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.queryByRole("combobox", { name: "Setor" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Prioridade" }),
    ).toBeInTheDocument();
  });
  it("never creates a local success without a workspace and opens a complete empty personal form", () => {
    wrap(<TasksWorkspace tasks={[]} catalog={catalog} />);
    expect(
      screen.queryByRole("link", { name: "Entrar na plataforma" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Título da tarefa")).toHaveValue("");
    for (const field of [
      "Empresa",
      "Código",
      "Operadora",
      "Projeto",
      "Descrição",
      "Data de vencimento",
      "Prioridade",
      "Etapa",
    ])
      expect(within(dialog).getByLabelText(field)).toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("Responsável"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Criar tarefa" }),
    ).toBeDisabled();
    expect(screen.getByText("0 de 0 tarefas autorizadas")).toBeInTheDocument();
  });
  it("uses the column stage and preserves corporate fields and code on a real save callback", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    wrap(
      <TasksWorkspace
        tasks={[]}
        catalog={catalog}
        userId={taskIds.user}
        canPersist
        onSave={save}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Nova tarefa na etapa Em revisão" }),
    );
    const d = screen.getByRole("dialog");
    expect(within(d).getByLabelText("Etapa")).toHaveValue("review");
    fireEvent.change(within(d).getByLabelText("Título da tarefa"), {
      target: { value: "Conferir registro" },
    });
    fireEvent.change(within(d).getByLabelText("Empresa"), {
      target: { value: catalog.companies[0].id },
    });
    fireEvent.change(within(d).getByLabelText("Código"), {
      target: { value: "000EMP-A" },
    });
    fireEvent.change(within(d).getByLabelText("Operadora"), {
      target: { value: "Hapvida" },
    });
    fireEvent.change(within(d).getByLabelText("Projeto"), {
      target: { value: "PME" },
    });
    fireEvent.change(within(d).getByLabelText("Data de vencimento"), {
      target: { value: "2026-10-20" },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Criar tarefa" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      title: "Conferir registro",
      company_id: catalog.companies[0].id,
      operational_code: "000EMP-A",
      operator: "Hapvida",
      project: "PME",
      due_date: "2026-10-20",
      priority: "medium",
      stage_id: "review",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("rejects empty title and long description without truncation or submission", async () => {
    const save = vi.fn();
    wrap(
      <TasksWorkspace
        tasks={[]}
        catalog={catalog}
        userId={taskIds.user}
        canPersist
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe o título",
    );
    fireEvent.change(screen.getByLabelText("Título da tarefa"), {
      target: { value: "Teste" },
    });
    fireEvent.change(screen.getByLabelText("Descrição"), {
      target: { value: "x".repeat(501) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    expect(screen.getByRole("alert")).toHaveTextContent("500");
    expect(screen.getByLabelText("Descrição")).toHaveValue("x".repeat(501));
    expect(save).not.toHaveBeenCalled();
  });
  it("keeps search and filters across all four views", () => {
    wrap(
      <TasksWorkspace
        tasks={[
          taskFixture(),
          taskFixture({
            id: "other",
            title: "Outra atividade",
            stage_id: "review",
            status: "review",
          }),
        ]}
        catalog={catalog}
        userId={taskIds.user}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar tarefas" }), {
      target: { value: "Revisar dados" },
    });
    for (const view of ["Lista", "Timeline", "Checklist", "Kanban"]) {
      fireEvent.click(screen.getByRole("tab", { name: view }));
      expect(
        screen.getByRole("textbox", { name: "Buscar tarefas" }),
      ).toHaveValue("Revisar dados");
      expect(screen.queryByText("Outra atividade")).not.toBeInTheDocument();
      expect(
        screen.getByText("1 de 2 tarefas autorizadas"),
      ).toBeInTheDocument();
    }
  });
  it("does not move a card or counters after a failed drop", async () => {
    const move = vi.fn().mockRejectedValue(new Error("Falha de persistência"));
    wrap(
      <TasksWorkspace
        tasks={[taskFixture()]}
        catalog={catalog}
        userId={taskIds.user}
        canPersist
        onMove={move}
      />,
    );
    const article = screen
      .getByRole("button", { name: "Revisar dados de validação" })
      .closest("article")!;
    const destination = screen
      .getByRole("heading", { name: /Em revisão/ })
      .closest("section")!;
    fireEvent.dragStart(article);
    fireEvent.drop(destination);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Falha de persistência",
    );
    expect(
      within(destination).queryByText("Revisar dados de validação"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "A fazer 1" }),
    ).toBeInTheDocument();
  });
  it("checklist completes the existing record through the same stage service", async () => {
    const move = vi.fn().mockResolvedValue(undefined);
    wrap(
      <TasksWorkspace
        tasks={[taskFixture()]}
        catalog={catalog}
        userId={taskIds.user}
        canPersist
        onMove={move}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Checklist" }));
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(move).toHaveBeenCalledWith(
        expect.objectContaining({ id: taskFixture().id }),
        "done",
      ),
    );
  });
  it("keeps a sector queue read-only and names its unassigned state", () => {
    wrap(
      <TasksWorkspace
        tasks={[
          taskFixture({
            created_by: taskIds.admin,
            assigned_to: null,
            sector_id: taskIds.sector,
          }),
        ]}
        catalog={catalog}
        userId={taskIds.user}
        canPersist
      />,
    );
    expect(screen.getByText("Sem responsável")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Revisar dados de validação" }),
    );
    expect(
      screen.getByRole("button", { name: "Salvar alterações" }),
    ).toBeDisabled();
    expect(screen.queryByLabelText("Responsável")).not.toBeInTheDocument();
  });
  it("preserves a received task draft after error and never reassigns on editing", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Falha ao salvar"));
    wrap(
      <TasksWorkspace
        tasks={[taskFixture({ created_by: taskIds.admin })]}
        catalog={catalog}
        userId={taskIds.user}
        canPersist
        onSave={save}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Revisar dados de validação" }),
    );
    fireEvent.change(screen.getByLabelText("Descrição"), {
      target: { value: "Rascunho preservado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Falha ao salvar",
    );
    expect(screen.getByLabelText("Descrição")).toHaveValue(
      "Rascunho preservado",
    );
    expect(save.mock.calls[0][2]).toMatchObject({
      created_by: taskIds.admin,
      assigned_to: taskIds.user,
    });
  });
  it("closing a dialog performs no save and restores focus", async () => {
    const save = vi.fn();
    wrap(
      <TasksWorkspace
        tasks={[]}
        catalog={catalog}
        userId={taskIds.user}
        canPersist
        onSave={save}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Nova tarefa",
    });
    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByRole("button", { name: "Fechar formulário de tarefa" }),
    );
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("admin review opens prefilled, validates sector membership and saves adjustments without confirmation", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const initial = taskValues(
      taskFixture({
        company_id: catalog.companies[0].id,
        operational_code: "000A",
        operator: "Hapvida",
        project: "PME",
        sector_id: taskIds.sector,
        assigned_to: taskIds.user,
      }),
    );
    wrap(
      <TaskFormDialog
        initial={initial}
        catalog={catalog}
        admin
        title="Ajustar informações"
        submitLabel="Salvar ajustes"
        onClose={() => {}}
        onSave={save}
      />,
    );
    expect(screen.getByLabelText("Código")).toHaveValue("000A");
    expect(screen.getByLabelText("Responsável")).toHaveValue(taskIds.user);
    fireEvent.change(screen.getByLabelText("Setor"), {
      target: { value: taskIds.otherSector },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ajustes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("responsável");
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Responsável"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ajustes" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: "Confirmar e encaminhar" }),
    ).not.toBeInTheDocument();
  });
});
