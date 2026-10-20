import { beforeEach, describe, expect, it, vi } from "vitest";
import { taskCatalogFixture, taskFixture, taskIds } from "@/test/taskFixtures";
import { taskValues } from "./model";
const mock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  storageFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mock.from,
    rpc: mock.rpc,
    storage: { from: mock.storageFrom },
  },
}));
import {
  confirmTaskDraft,
  listTasks,
  moveTask,
  savePersonalTask,
  saveTaskDraft,
  taskFailure,
  uploadTaskAttachment,
  removeTaskAttachment,
  removeTaskColumn,
  validateTaskAttachment,
} from "./service";
import type { TaskDraft } from "@/integrations/supabase/taskTypes";
const draft: TaskDraft = {
  id: taskIds.draft,
  workspace_id: taskIds.workspace,
  conversation_id: taskIds.conversation,
  created_by: taskIds.admin,
  payload: { ...taskValues(taskFixture()), sector_id: taskIds.sector },
  version: 2,
  target_task_id: null,
  target_updated_at: null,
  confirmed_task_id: null,
  confirmed_version: null,
  created_at: "2026-10-15T15:00:00Z",
  updated_at: "2026-10-15T15:00:00Z",
};
let builder: Record<string, ReturnType<typeof vi.fn>>,
  rpcBuilder: Record<string, ReturnType<typeof vi.fn>>,
  storage: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  vi.clearAllMocks();
  builder = {};
  for (const k of ["select", "eq", "order", "update", "abortSignal"])
    builder[k] = vi.fn(() => builder);
  builder.single = vi.fn().mockResolvedValue({ data: draft, error: null });
  builder.range = vi
    .fn()
    .mockResolvedValue({ data: [taskFixture()], error: null });
  mock.from.mockReturnValue(builder);
  rpcBuilder = {
    single: vi.fn().mockResolvedValue({ data: taskFixture(), error: null }),
    abortSignal: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  mock.rpc.mockReturnValue(rpcBuilder);
  storage = {
    upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  mock.storageFrom.mockReturnValue(storage);
});
describe("task persistence boundary", () => {
  it("removes only the requested column through the existing versioned transfer transaction", async () => {
    const stages = taskCatalogFixture().stages;
    const scope = { kind: "tasks", board_id: "board", version: "version", can_manage: true } as Parameters<typeof removeTaskColumn>[0];
    mock.rpc.mockImplementation((name) => name === "business_save_columns" ? Promise.resolve({ error: null }) : rpcBuilder);
    builder.range.mockImplementation(() => ({ abortSignal: vi.fn().mockResolvedValue({ data: [], error: null }) }));
    await removeTaskColumn(scope, stages, "todo", "review");
    expect(mock.rpc).toHaveBeenCalledWith("business_save_columns", {
      p_board: "board", p_version: "version",
      p_columns: stages.filter(stage => stage.id !== "todo"),
      p_moves: { todo: "review" },
    });
    expect(mock.from).not.toHaveBeenCalledWith("tasks");
  });
  it("rejects invalid destinations, the last active column, mixed boards and missing management permission", async () => {
    const stages = taskCatalogFixture().stages;
    const scope = { kind: "tasks", board_id: "board", version: "version", can_manage: true } as Parameters<typeof removeTaskColumn>[0];
    await expect(removeTaskColumn(scope, stages, "todo", "todo")).rejects.toThrow("destino");
    await expect(removeTaskColumn(scope, stages, "todo", "unknown")).rejects.toThrow("destino");
    await expect(removeTaskColumn(scope, [{ ...stages[0] }, { ...stages[1], archived: true }], "todo", stages[1].id)).rejects.toThrow();
    await expect(removeTaskColumn(scope, stages.map(stage => ({ ...stage, board_id: "another-board" })), "todo", "review")).rejects.toThrow("destino");
    await expect(removeTaskColumn({ ...scope, can_manage: false }, stages, "todo", "review")).rejects.toThrow("permissão");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("does not report a removal on a stale board version or a transfer permission failure", async () => {
    const scope = { kind: "tasks", board_id: "board", version: "old", can_manage: true } as Parameters<typeof removeTaskColumn>[0];
    mock.rpc.mockResolvedValueOnce({ error: { code: "PT409" } });
    await expect(removeTaskColumn(scope, taskCatalogFixture().stages, "todo", "review")).rejects.toThrow("alterados");
    mock.rpc.mockResolvedValueOnce({ error: { code: "42501" } });
    await expect(removeTaskColumn(scope, taskCatalogFixture().stages, "todo", "review")).rejects.toThrow("permissão");
  });
  it("explains invalid column names and removed tasks without exposing database errors", () => {
    expect(() =>
      taskFailure({ code: "22023", message: "INVALID_COLUMNS" }),
    ).toThrow("1 a 80");
    expect(() =>
      taskFailure({ code: "PT409", message: "TASK_REMOVED" }),
    ).toThrow("Desfazer");
  });
  it("uses personal RPC with stable operation key, strips assignment and preserves corporate code", async () => {
    const task = taskFixture({
      company_id: taskCatalogFixture().companies[0].id,
      operational_code: "000ABC",
      sector_id: taskIds.sector,
      assigned_to: taskIds.other,
    });
    await savePersonalTask(
      taskIds.workspace,
      "stable-request",
      taskValues(task),
      task,
    );
    expect(mock.rpc).toHaveBeenCalledWith(
      "business_save_task",
      expect.objectContaining({
        p_board: taskIds.workspace,
        p_request: "stable-request",
        p_id: task.id,
        p_updated: task.updated_at,
        p_payload: expect.objectContaining({ operational_code: "000ABC" }),
      }),
    );
    const payload = mock.rpc.mock.calls[0][1].p_payload;
    expect(payload).not.toHaveProperty("assigned_to");
    expect(payload).not.toHaveProperty("created_by");
    expect(payload).not.toHaveProperty("sector_id");
  });
  it("paginates all authorized tasks rather than truncating at a server limit", async () => {
    builder.range
      .mockResolvedValueOnce({
        data: Array.from({ length: 500 }, (_, i) =>
          taskFixture({ id: String(i) }),
        ),
        error: null,
      })
      .mockResolvedValueOnce({
        data: [taskFixture({ id: "last" })],
        error: null,
      });
    expect(await listTasks(taskIds.workspace)).toHaveLength(501);
    expect(builder.eq).toHaveBeenCalledWith("board_id", taskIds.workspace);
    expect(builder.range).toHaveBeenLastCalledWith(500, 999);
  });
  it("moves by real ID/workspace/version and never writes completion timestamps in the browser", async () => {
    builder.single.mockResolvedValue({
      data: taskFixture({ status: "review", stage_id: "review" }),
      error: null,
    });
    await moveTask(taskIds.workspace, taskFixture(), "review");
    expect(mock.rpc).toHaveBeenCalledWith("business_move_task", {
      p_board: taskIds.workspace,
      p_id: taskFixture().id,
      p_updated: taskFixture().updated_at,
      p_stage: "review",
    });
  });
  it("keeps drafting and confirmation as separate calls using draft identity/version", async () => {
    await saveTaskDraft(
      draft.conversation_id,
      draft.id,
      draft.version,
      taskValues(taskFixture()),
      taskFixture().id,
    );
    expect(mock.rpc).toHaveBeenCalledWith(
      "task_save_draft",
      expect.objectContaining({
        p_id: draft.id,
        p_version: 2,
        p_target: taskFixture().id,
      }),
    );
    expect(mock.rpc).not.toHaveBeenCalledWith(
      "task_confirm_draft",
      expect.anything(),
    );
    await confirmTaskDraft(draft);
    expect(mock.rpc).toHaveBeenLastCalledWith("task_confirm_draft", {
      p_id: draft.id,
      p_version: 2,
    });
  });
  it("reads the persisted result before retrying an uncertain confirmation", async () => {
    builder.single
      .mockResolvedValueOnce({
        data: {
          ...draft,
          confirmed_task_id: taskFixture().id,
          confirmed_version: 2,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: taskFixture(), error: null });
    expect((await confirmTaskDraft(draft)).id).toBe(taskFixture().id);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("workspace_id", taskIds.workspace);
  });
  it("refuses a stale displayed version without confirming it", async () => {
    builder.single.mockResolvedValue({
      data: { ...draft, version: 3 },
      error: null,
    });
    await expect(confirmTaskDraft(draft)).rejects.toThrow("alterados");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("rejects empty/unsupported attachments before upload", () => {
    expect(() => validateTaskAttachment(new File([], "vazio.pdf"))).toThrow(
      "não vazio",
    );
    expect(() => validateTaskAttachment(new File(["abc"], "run.exe"))).toThrow(
      "PDF",
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('removes draft metadata before storage cleanup and rejects confirmed files',async()=>{
    const file={id:'file',draft_id:draft.id,workspace_id:draft.workspace_id,task_id:null,name:'a.txt',mime_type:'text/plain',size_bytes:1,storage_path:`${draft.workspace_id}/${draft.id}/a.txt`,created_by:taskIds.admin,created_at:''};
    mock.rpc.mockResolvedValueOnce({data:{path:file.storage_path,version:3},error:null});
    await expect(removeTaskAttachment(draft,file)).resolves.toEqual({version:3,cleanupPending:false});
    expect(mock.rpc).toHaveBeenCalledWith('task_remove_attachment',{p_draft:draft.id,p_id:'file',p_version:2});
    expect(storage.remove).toHaveBeenCalledWith([file.storage_path]);
    await expect(removeTaskAttachment({...draft,confirmed_task_id:'confirmed'},file)).rejects.toThrow('pendente');
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it('preserves storage on a version conflict and reports deferred cleanup after successful unlinking',async()=>{
    const file={id:'file',draft_id:draft.id,workspace_id:draft.workspace_id,task_id:null,name:'a.txt',mime_type:'text/plain',size_bytes:1,storage_path:`${draft.workspace_id}/${draft.id}/a.txt`,created_by:taskIds.admin,created_at:''};
    mock.rpc.mockResolvedValueOnce({data:null,error:{code:'PT409'}});
    await expect(removeTaskAttachment(draft,file)).rejects.toThrow('alterados');
    expect(storage.remove).not.toHaveBeenCalled();
    mock.rpc.mockResolvedValueOnce({data:{path:file.storage_path,version:3},error:null});storage.remove.mockResolvedValueOnce({error:{message:'unavailable'}});
    await expect(removeTaskAttachment(draft,file)).resolves.toEqual({version:3,cleanupPending:true});
  });
  it("reuses attachment identity after a failed registration and cleans only the staged object", async () => {
    const file = new File(["pdf"], "validacao.pdf", {
      type: "application/pdf",
    });
    rpcBuilder.single
      .mockResolvedValueOnce({ data: null, error: { code: "PT409" } })
      .mockResolvedValueOnce({ data: { id: "file" }, error: null });
    await expect(
      uploadTaskAttachment(taskIds.workspace, draft, file),
    ).rejects.toThrow("alterados");
    const first = mock.rpc.mock.calls[0][1];
    expect(storage.remove).toHaveBeenCalledWith([first.p_path]);
    storage.upload.mockResolvedValue({
      data: null,
      error: { statusCode: "409" },
    });
    await uploadTaskAttachment(taskIds.workspace, draft, file);
    expect(mock.rpc.mock.calls[1][1]).toMatchObject({
      p_id: first.p_id,
      p_path: first.p_path,
    });
    expect(storage.upload.mock.calls[0][0]).toContain(
      `${taskIds.workspace}/${draft.id}/`,
    );
  });
});
