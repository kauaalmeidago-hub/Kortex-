import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksWorkspace } from "./TasksPage";
import { taskCatalogFixture, taskFixture, taskIds } from "@/test/taskFixtures";
afterEach(cleanup);
function mount(
  props: Partial<React.ComponentProps<typeof TasksWorkspace>> = {},
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <TasksWorkspace
          tasks={[taskFixture()]}
          catalog={taskCatalogFixture()}
          userId={taskIds.user}
          canPersist
          canManageColumns
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("published Kanban interactions", () => {
  it("keeps creation inside the column and global controls, without the header plus or removed menu shortcuts", () => {
    mount({ onRemoveColumn: vi.fn() });
    const column = screen.getByRole("region", { name: "Coluna A fazer" });
    expect(within(column).queryByRole("button", { name: "Nova tarefa em A fazer" })).not.toBeInTheDocument();
    expect(within(column).getByRole("button", { name: "Nova tarefa na etapa A fazer" })).toBeInTheDocument();
    fireEvent.click(within(column).getByLabelText("Opções da etapa A fazer"));
    expect(within(column).queryByText("Filtrar esta etapa")).not.toBeInTheDocument();
    expect(within(column).queryByText("Configurar colunas e remoção")).not.toBeInTheDocument();
    expect(within(column).getByText("Renomear coluna")).toBeInTheDocument();
    expect(within(column).getByText("Remover coluna")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtros" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova tarefa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar coluna" })).toBeInTheDocument();
  });
  it("removes by the real ID despite repeated titles, requires a valid destination and waits for persistence", async () => {
    const catalog = taskCatalogFixture();
    catalog.stages = catalog.stages.map((stage, index) => ({ ...stage, name: index < 2 ? "Repetida" : stage.name }));
    let finish: () => void = () => {};
    const remove = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    mount({ catalog, onRemoveColumn: remove });
    const second = screen.getAllByRole("region", { name: "Coluna Repetida" })[1];
    fireEvent.click(within(second).getByLabelText("Opções da etapa Repetida"));
    fireEvent.click(within(second).getByText("Remover coluna"));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Remover coluna" });
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText(/inclusive fora da busca ou dos filtros/)).toBeInTheDocument();
    const select = within(dialog).getByLabelText("Mover tarefas para");
    expect(within(select).queryByRole("option", { name: "Repetida" })).toHaveValue("todo");
    fireEvent.change(select, { target: { value: "todo" } });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(catalog.stages[1].id, "todo");
    expect(second).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Removendo..." })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("preserves the column, destination and error on failure, and allows retry", async () => {
    const remove = vi.fn().mockRejectedValueOnce(new Error("Falha de rede")).mockResolvedValue(undefined);
    mount({ onRemoveColumn: remove });
    const column = screen.getByRole("region", { name: "Coluna A fazer" });
    fireEvent.click(within(column).getByLabelText("Opções da etapa A fazer"));
    fireEvent.click(within(column).getByText("Remover coluna"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Mover tarefas para"), { target: { value: "review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover coluna" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Falha de rede");
    expect(column).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Mover tarefas para")).toHaveValue("review");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover coluna" }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    expect(remove).toHaveBeenLastCalledWith("todo", "review");
  });
  it("keeps the final active column and does not offer removal without management permission", () => {
    const catalog = taskCatalogFixture();
    catalog.stages = catalog.stages.slice(0, 1);
    const remove = vi.fn();
    const view = mount({ catalog, onRemoveColumn: remove });
    fireEvent.click(screen.getByLabelText("Opções da etapa A fazer"));
    expect(screen.getByText("Remover coluna").closest("button")).toBeDisabled();
    expect(remove).not.toHaveBeenCalled();
    view.unmount();
    mount({ canManageColumns: false, onRemoveColumn: remove });
    fireEvent.click(screen.getByLabelText("Opções da etapa A fazer"));
    expect(screen.queryByText("Remover coluna")).not.toBeInTheDocument();
  });
  it("applies filter drafts only on confirmation, preserves search and real empty columns, and resets draft defaults", async () => {
    mount();
    const search = screen.getByLabelText("Buscar tarefas");
    fireEvent.change(search, { target: { value: "Revisar" } });
    const open = () =>
      fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    open();
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Prioridade"), {
      target: { value: "low" },
    });
    fireEvent.click(screen.getByLabelText("Fechar filtros"));
    open();
    expect(screen.getByLabelText("Prioridade")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Prioridade"), {
      target: { value: "low" },
    });
    fireEvent.click(screen.getByText("Aplicar filtros"));
    expect(screen.queryByText(taskFixture().title)).not.toBeInTheDocument();
    expect(
      screen.getByText("Nenhuma tarefa corresponde à busca ou aos filtros."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(4);
    for (const view of ["Lista", "Timeline", "Checklist", "Kanban"]) {
      fireEvent.click(screen.getByRole("tab", { name: view }));
      expect(screen.queryByText(taskFixture().title)).not.toBeInTheDocument();
    }
    open();
    expect(screen.getByLabelText("Prioridade")).toHaveValue("low");
    fireEvent.click(screen.getByText("Limpar filtros"));
    expect(screen.getByLabelText("Prioridade")).toHaveValue("");
    fireEvent.click(screen.getByText("Aplicar filtros"));
    expect(search).toHaveValue("Revisar");
    expect(screen.getByText(taskFixture().title)).toBeInTheDocument();
  });
  it("reveals the temporary add control after two completed horizontal gestures, never on wheel, card drag or cancellation", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    mount();
    const board = screen.getByRole("region", { name: "Quadro de tarefas" });
    const gesture = () => {
      fireEvent.pointerDown(board, { button: 0, clientX: 400, clientY: 80 });
      fireEvent.pointerMove(board, { clientX: 300, clientY: 80 });
      fireEvent.pointerUp(board, { clientX: 300, clientY: 80 });
    };
    expect(screen.queryByLabelText("Criar coluna")).not.toBeInTheDocument();
    fireEvent.wheel(board, { deltaX: 500 });
    expect(screen.queryByLabelText("Criar coluna")).not.toBeInTheDocument();
    gesture();
    expect(screen.queryByLabelText("Criar coluna")).not.toBeInTheDocument();
    gesture();
    expect(screen.getByLabelText("Criar coluna")).toBeInTheDocument();
    fireEvent.keyDown(board, { key: "Escape" });
    expect(screen.queryByLabelText("Criar coluna")).not.toBeInTheDocument();
    const card = screen.getByText(taskFixture().title).closest("article")!;
    fireEvent.dragStart(card);
    gesture();
    gesture();
    expect(screen.queryByLabelText("Criar coluna")).not.toBeInTheDocument();
    fireEvent.dragEnd(card);
    vi.unstubAllGlobals();
  });
  it("creates once with a stable ID and opens inline editing without leaving a second placeholder", async () => {
    let finish: (v: void) => void = () => {};
    const column = vi.fn<(...args: [string, string, boolean]) => Promise<void>>(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    mount({ onColumn: column });
    fireEvent.click(screen.getByText("Adicionar coluna"));
    const add = screen.getByLabelText("Criar coluna");
    fireEvent.click(add);
    fireEvent.click(add);
    expect(column).toHaveBeenCalledTimes(1);
    expect(column.mock.calls[0][1]).toBe("Nova etapa");
    finish();
    await waitFor(() =>
      expect(screen.queryByLabelText("Criar coluna")).not.toBeInTheDocument(),
    );
  });
  it("renames the same ID once on Enter and blur, cancels Escape and refuses an empty name", async () => {
    const column = vi.fn().mockResolvedValue(undefined);
    mount({ onColumn: column });
    const title = screen.getByRole("button", {
      name: "Renomear coluna A fazer",
    });
    fireEvent.doubleClick(title);
    let input = screen.getByLabelText("Nome da coluna");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "  Conferência  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(column).toHaveBeenCalledTimes(1));
    expect(column).toHaveBeenCalledWith("todo", "Conferência", false);
    await waitFor(() =>
      expect(screen.queryByLabelText("Nome da coluna")).not.toBeInTheDocument(),
    );
    fireEvent.doubleClick(
      screen.getByRole("button", { name: "Renomear coluna A fazer" }),
    );
    input = screen.getByLabelText("Nome da coluna");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("Informe um nome");
    expect(column).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("A fazer")).toBeInTheDocument();
  });
  it("only removes on a valid trash drop, and undo restores the same record and counters", async () => {
    const remove = vi.fn().mockResolvedValue(undefined),
      restore = vi.fn().mockResolvedValue(undefined),
      move = vi.fn();
    mount({ onDelete: remove, onRestore: restore, onMove: move });
    const task = taskFixture(),
      card = screen.getByText(task.title).closest("article")!,
      trash = screen.getByLabelText("Lixeira de tarefas");
    fireEvent.click(trash);
    expect(remove).not.toHaveBeenCalled();
    fireEvent.dragStart(card);
    fireEvent.dragOver(trash, { dataTransfer: { dropEffect: "" } });
    fireEvent.dragEnd(card);
    expect(remove).not.toHaveBeenCalled();
    fireEvent.dragStart(card);
    fireEvent.drop(trash);
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(move).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: task.title }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("0 de 0 tarefas autorizadas")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Desfazer"));
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith(task, remove.mock.calls[0][1]),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: task.title }),
      ).toBeInTheDocument(),
    );
  });
  it("restores a failed removal in its original column and allows retry with the same operation key", async () => {
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("Falha de rede"))
      .mockResolvedValue(undefined);
    mount({ onDelete: remove });
    fireEvent.click(
      screen.getByLabelText(`Remover tarefa ${taskFixture().title}`),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede");
    const column = screen.getByRole("region", { name: "Coluna A fazer" });
    expect(within(column).getByText(taskFixture().title)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Tentar remoção novamente"));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    expect(remove.mock.calls[0][1]).toBe(remove.mock.calls[1][1]);
  });
});
