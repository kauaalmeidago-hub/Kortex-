import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { taskCatalogFixture, taskFixture, taskIds } from "@/test/taskFixtures";
import { taskValues } from "@/features/tasks/model";
import type { TaskDraft } from "@/integrations/supabase/taskTypes";
import TaskDraftCollection from "./TaskDraftCollection";
vi.mock("@/pages/TasksPage", () => ({
  TaskAttachments: ({ draftId }: { draftId: string }) => (
    <span>Anexos de {draftId}</span>
  ),
  TaskBadge: () => null,
}));
afterEach(cleanup);
const catalog = taskCatalogFixture();
catalog.sectors = [0, 1, 2].map((i) => ({
  ...catalog.sectors[0],
  id: "sector" + i,
  name: ["Relacionamento", "Financeiro", "Comercial"][i],
}));
catalog.members = catalog.sectors.flatMap((s) =>
  catalog.people.map((p) => ({
    workspace_id: taskIds.workspace,
    sector_id: s.id,
    user_id: p.user_id,
  })),
);
function drafts(): TaskDraft[] {
  return Array.from({ length: 6 }, (_, i) => ({
    id: "draft" + i,
    batch_id: "batch",
    position: i + 1,
    workspace_id: taskIds.workspace,
    conversation_id: taskIds.conversation,
    created_by: taskIds.admin,
    payload: {
      ...taskValues(taskFixture()),
      title: "Pedido " + (i + 1),
      sector_id: catalog.sectors[Math.floor(i / 2)].id,
      assigned_to: i === 1 ? taskIds.admin : taskIds.user,
      due_date: "2026-11-20",
    },
    version: 1,
    target_task_id: null,
    target_updated_at: null,
    confirmed_task_id: null,
    confirmed_version: null,
    created_at: "2026-10-19",
    updated_at: "2026-10-19",
  }));
}
const setup = (
  rows = drafts(),
  approve = vi.fn(async (_items: TaskDraft[]) => {}),
) => {
  const edit = vi.fn();
  const props = {
    drafts: rows,
    catalog,
    busy: false,
    onEdit: edit,
    onApprove: approve,
  };
  return {
    ...render(<TaskDraftCollection {...props} />),
    props,
    approve,
    edit,
  };
};
describe("reviewing a draft collection", () => {
  it("keeps the visible groups and rows in stable presentation order even when database timestamps tie", () => {
    setup(drafts().reverse());
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((e) => e.textContent),
    ).toEqual(["Relacionamento", "Financeiro", "Comercial"]);
    expect(
      screen.getAllByRole("checkbox").map((e) => e.getAttribute("aria-label")),
    ).toEqual([1, 2, 3, 4, 5, 6].map((n) => "Selecionar Pedido " + n));
  });
  it("renders one summary with six unchecked rows in three actual sectors", () => {
    setup();
    expect(
      screen.getAllByRole("region", { name: "Resumo das tarefas" }),
    ).toHaveLength(1);
    expect(screen.getByText("6 tarefas · 3 setores")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
    expect(
      screen
        .getAllByRole("checkbox")
        .every((c) => !(c as HTMLInputElement).checked),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Aprovar e encaminhar" }),
    ).toBeDisabled();
    expect(screen.queryByText("Descrição")).not.toBeInTheDocument();
  });
  it("keeps distinct recipients within the same sector instead of copying the first", () => {
    setup();
    expect(
      screen.getAllByText(
        catalog.people.find((p) => p.user_id === taskIds.admin)!.full_name!,
      ),
    ).toHaveLength(1);
    expect(
      screen
        .getByText("Relacionamento")
        .closest("section")
        ?.querySelectorAll(".task-row-recipient"),
    ).toHaveLength(2);
  });
  it("selection does not create tasks and approves only two IDs and reviewed versions", async () => {
    const { approve } = setup();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Selecionar Pedido 1" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Selecionar Pedido 4" }),
    );
    expect(approve).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Aprovar e encaminhar (2)" }),
    );
    await waitFor(() => expect(approve).toHaveBeenCalledOnce());
    expect(
      approve.mock.calls[0][0].map((d: TaskDraft) => [d.id, d.version]),
    ).toEqual([
      ["draft0", 1],
      ["draft3", 1],
    ]);
  });
  it("details and return share the same data, numbers and explicit selection", () => {
    const { approve } = setup();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Selecionar Pedido 2" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Ver detalhes das tarefas" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "02. Pedido 2" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Descrição")).toHaveLength(6);
    expect(
      screen.getByRole("checkbox", { name: "Selecionar Pedido 2" }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao resumo" }));
    expect(
      screen.getByRole("checkbox", { name: "Selecionar Pedido 2" }),
    ).toBeChecked();
    expect(approve).not.toHaveBeenCalled();
  });
  it("opens the existing editor with the exact selected draft and trigger", () => {
    const { edit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Pedido 2" }));
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "draft1", version: 1 }),
      expect.any(HTMLElement),
    );
  });
  it("clears selection when a concurrent change replaces the reviewed version", async () => {
    const { rerender, props } = setup();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Selecionar Pedido 2" }),
    );
    const rows = props.drafts.map((d) =>
      d.id === "draft1" ? { ...d, version: 2 } : d,
    );
    rerender(<TaskDraftCollection {...props} drafts={rows} />);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Selecionar Pedido 2" }),
      ).not.toBeChecked(),
    );
    expect(
      screen.getByRole("button", { name: "Aprovar e encaminhar" }),
    ).toBeDisabled();
  });
  it("an explicit saved review preserves selection and approves the new version", async () => {
    const { rerender, props, approve } = setup();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Selecionar Pedido 2" }),
    );
    const d = { ...props.drafts[1], version: 2 };
    act(() =>
      screen
        .getByRole("region", { name: "Resumo das tarefas" })
        .dispatchEvent(new CustomEvent("draft-reviewed", { detail: d })),
    );
    rerender(
      <TaskDraftCollection
        {...props}
        drafts={props.drafts.map((old) => ({ ...old }))}
      />,
    );
    rerender(
      <TaskDraftCollection
        {...props}
        drafts={props.drafts.map((old) => (old.id === d.id ? d : old))}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Selecionar Pedido 2" }),
      ).toBeChecked(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Aprovar e encaminhar (1)" }),
    );
    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith([
        expect.objectContaining({ id: d.id, version: 2 }),
      ]),
    );
  });
  it("unresolved fields block approval and offer a review link", () => {
    const rows = drafts();
    rows[0].payload = {
      ...(rows[0].payload as object),
      unresolved: ["Selecione o setor autorizado."],
    };
    setup(rows);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Selecionar Pedido 1" }),
    );
    expect(
      screen.getByRole("button", { name: "Aprovar e encaminhar (1)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Selecione o setor autorizado/ }),
    ).toBeEnabled();
  });
  it("blocks double click while the result is unknown and keeps selection after a failure", async () => {
    let reject!: (e: Error) => void;
    const approve = vi.fn(
      () =>
        new Promise<void>((_, no) => {
          reject = no;
        }),
    );
    setup(drafts(), approve);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Selecionar Pedido 1" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Aprovar e encaminhar (1)" }),
    );
    expect(
      screen.getByRole("button", { name: "Encaminhando..." }),
    ).toBeDisabled();
    expect(approve).toHaveBeenCalledOnce();
    reject(new Error("Falha"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Aprovar e encaminhar (1)" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("checkbox", { name: "Selecionar Pedido 1" }),
    ).toBeChecked();
  });
  it("already confirmed items are identified and cannot be resubmitted", () => {
    const rows = drafts();
    rows[0].confirmed_task_id = "task1";
    setup(rows);
    expect(
      screen.getByRole("checkbox", { name: "Selecionar Pedido 1" }),
    ).toBeDisabled();
    expect(screen.getByText("Encaminhada")).toBeInTheDocument();
  });
});
