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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { taskCatalogFixture, taskFixture, taskIds } from "@/test/taskFixtures";
import type {
  TaskConversation,
  TaskDraft,
  TaskMessage,
} from "@/integrations/supabase/taskTypes";
import { taskValues } from "@/features/tasks/model";
const controls = vi.hoisted(() => ({ admin: true }));
vi.mock("@/features/tasks/ai", () => ({
  taskAiStatus: vi.fn(),
  interpretTaskMessage: vi.fn(),
  connectTaskAi: vi.fn(),
  disconnectTaskAi: vi.fn(),
}));
import * as ai from "@/features/tasks/ai";
vi.mock("@/features/access/BusinessAccess", () => ({
  useBusinessAccess: () => ({
    token: "test",
    isCurrent: () => true,
    key: (_kind: string, r: string) => [r, taskIds.workspace, taskIds.admin],
    selected: () => ({
      board_id: "board",
      sector_id: taskIds.sector,
      can_dispatch: controls.admin,
    }),
    contexts: [],
    retry: vi.fn(),
  }),
  BusinessContextPicker: () => null,
}));
vi.mock("@/features/tasks/hooks", () => ({
  useTaskAdmin: () => ({ data: controls.admin, isLoading: false }),
  useTasksData: () => ({
    scope: { board_id: "board", can_dispatch: controls.admin },
    access: { token: "test" },
    workspace: { id: taskIds.workspace },
    user: { id: taskIds.admin },
    tasks: { data: [taskFixture()], isLoading: false },
    catalog: { data: taskCatalogFixture(), isLoading: false },
  }),
}));
vi.mock("@/features/tasks/service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/tasks/service")>();
  return {
    ...actual,
    listTaskConversations: vi.fn(),
    listTaskMessages: vi.fn(),
    listTaskDrafts: vi.fn(),
    listTaskAttachments: vi.fn(),
    startTaskConversation: vi.fn(),
    operationalTaskConversation: vi.fn(),
    currentTaskCycle:vi.fn(),prepareTaskCycle:vi.fn(),resumeTaskDraft:vi.fn(),lookupTaskHistory:vi.fn(),readTaskHistory:vi.fn(),taskForReview:vi.fn(),
    uploadTaskAttachment: vi.fn(),
    removeTaskAttachment: vi.fn(),
    postTaskMessage: vi.fn(),
    saveTaskDraft: vi.fn(),
    confirmTaskBatch: vi.fn(),
  };
});
import * as service from "@/features/tasks/service";
import TaskAdministrationPage from "./TaskAdministrationPage";
let conversations: TaskConversation[],
  drafts: TaskDraft[],
  messages: TaskMessage[];
let currentCycle:any;
const now = "2026-10-15T15:00:00Z";
const makeDraft = (values = taskValues(taskFixture())): TaskDraft => ({
  cycle_id:"cycle-test",
  id: taskIds.draft,
  workspace_id: taskIds.workspace,
  conversation_id: taskIds.conversation,
  created_by: taskIds.admin,
  payload: { ...values, sector_id: taskIds.sector, assigned_to: taskIds.user },
  version: 1,
  target_task_id: null,
  target_updated_at: null,
  confirmed_task_id: null,
  confirmed_version: null,
  created_at: now,
  updated_at: now,
});
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  controls.admin = true;
  vi.mocked(ai.taskAiStatus).mockResolvedValue({
    configured: false,
    model: null,
    updated_at: null,
  });
  currentCycle={id:"cycle-test",conversation_id:taskIds.conversation,state:"active",completed_at:null};
  vi.mocked(service.currentTaskCycle).mockImplementation(async()=>currentCycle);
  vi.mocked(service.prepareTaskCycle).mockImplementation(async()=>currentCycle);
  vi.mocked(service.taskForReview).mockImplementation(async(id)=>({...taskFixture(),id,can_edit:true}));
  conversations = [];
  drafts = [];
  messages = [];
  vi.mocked(service.listTaskConversations).mockImplementation(async () => [
    ...conversations,
  ]);
  vi.mocked(service.listTaskMessages).mockImplementation(async () => [
    ...messages,
  ]);
  vi.mocked(service.listTaskDrafts).mockImplementation(async () => [...drafts]);
  vi.mocked(service.listTaskAttachments).mockResolvedValue([]);
  vi.mocked(service.startTaskConversation).mockImplementation(
    async (ws, id) => {
      const c = {
        id,
        workspace_id: ws,
        created_by: taskIds.admin,
        created_at: now,
      };
      conversations.push(c);
      return c;
    },
  );
  vi.mocked(service.operationalTaskConversation).mockImplementation(
    async () => {
      if (!conversations.length)
        conversations.push({
          id: taskIds.conversation,
          workspace_id: taskIds.workspace,
          created_by: taskIds.admin,
          created_at: now,
        });
      return conversations[0];
    },
  );
  vi.mocked(service.postTaskMessage).mockImplementation(
    async (conv, key, content, cycle) => {
      const m = {
        id: crypto.randomUUID(),
        workspace_id: taskIds.workspace,
        conversation_id: conv,
        cycle_id:cycle??"cycle-test",
        role: "user" as const,
        content,
        request_key: key,
        result: null,
        created_at: now,
      };
      messages.push(m);
      return m;
    },
  );
  vi.mocked(service.saveTaskDraft).mockImplementation(
    async (conv, id, version, v, target) => {
      const d = {
        ...makeDraft(v),
        payload: { ...v },
        id,
        conversation_id: conv,
        version: version + 1,
        target_task_id: target ?? null,
      };
      drafts = [...drafts.filter((r) => r.id !== id), d];
      return d;
    },
  );
  vi.mocked(service.confirmTaskBatch).mockImplementation(
    async (_conv, items) => {
      drafts = drafts.map((d) =>
        items.some((i) => i.id === d.id)
          ? {
              ...d,
              confirmed_task_id: taskFixture().id,
              confirmed_version: d.version,
              updated_at: new Date().toISOString(),
            }
          : d,
      );
      messages.push({id:crypto.randomUUID(),cycle_id:"cycle-test",conversation_id:taskIds.conversation,workspace_id:taskIds.workspace,role:"assistant",content:"Pronto, as tarefas foram encaminhadas.",created_at:new Date().toISOString(),request_key:crypto.randomUUID(),result:null});
      if(drafts.every(d=>d.confirmed_task_id))currentCycle={...currentCycle,state:"completed",completed_at:new Date().toISOString()};
      return items.map((d) => ({ draft_id: d.id, task_id: taskFixture().id }));
    },
  );
});
afterEach(cleanup);
function setup(path = "/admin/tasks") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <TaskAdministrationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function seed() {
  conversations = [
    {
      id: taskIds.conversation,
      workspace_id: taskIds.workspace,
      created_by: taskIds.admin,
      created_at: now,
    },
  ];
  drafts = [makeDraft()];
}
async function tools() {
  fireEvent.click(screen.getByRole("button", { name: "Setores" }));
  fireEvent.click(await screen.findByText("Ferramentas administrativas"));
}
describe("administrative review flow with AI explicitly pending", () => {
  it("recovers a failed saved message after remount and retries the same ID", async () => {
    vi.mocked(ai.taskAiStatus).mockResolvedValue({
      configured: true,
      model: "gpt-4.1-mini",
      updated_at: now,
    });
    vi.mocked(ai.interpretTaskMessage)
      .mockRejectedValueOnce(new Error("Falha temporária"))
      .mockResolvedValueOnce({ draft_ids: [], reused: false });
    const first = setup();
    const input = screen.getByRole("textbox", {
      name: "Mensagem para Gestão de tarefas",
    });
    fireEvent.change(input, { target: { value: "Mensagem para recuperar" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByRole("alert");
    first.unmount();
    setup();
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", {
          name: "Mensagem para Gestão de tarefas",
        }),
      ).toHaveValue("Mensagem para recuperar"),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", {
          name: "Mensagem para Gestão de tarefas",
        }),
      ).toHaveValue(""),
    );
    expect(service.postTaskMessage).toHaveBeenCalledTimes(1);
    expect(ai.interpretTaskMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ai.interpretTaskMessage).mock.calls[0][0]).toBe(
      vi.mocked(ai.interpretTaskMessage).mock.calls[1][0],
    );
  });
  it("keeps selected files local and allows removing them before any upload", async () => {
    setup();
    const input = screen.getByLabelText("Arquivos da tarefa");
    fireEvent.change(input, {
      target: {
        files: [new File(["QA"], "arquivo.txt", { type: "text/plain" })],
      },
    });
    const remove = await screen.findByRole("button", {
      name: "Remover arquivo.txt",
    });
    expect(service.uploadTaskAttachment).not.toHaveBeenCalled();
    expect(service.saveTaskDraft).not.toHaveBeenCalled();
    fireEvent.click(remove);
    expect(
      screen.queryByRole("list", { name: "Arquivos selecionados" }),
    ).not.toBeInTheDocument();
  });
  it('interprets file-only submissions after upload instead of leaving an empty draft',async()=>{
    vi.mocked(ai.taskAiStatus).mockResolvedValue({configured:true,model:'configured-model',updated_at:null});
    setup();
    fireEvent.change(screen.getByLabelText('Arquivos da tarefa'),{target:{files:[new File(['Preparar documentação'],'pedido.txt',{type:'text/plain'})]}});
    await waitFor(()=>expect(screen.getByRole('button',{name:'Enviar'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
    await waitFor(()=>expect(ai.interpretTaskMessage).toHaveBeenCalledTimes(1));
    expect(service.uploadTaskAttachment).toHaveBeenCalledTimes(1);
    expect(service.postTaskMessage).toHaveBeenCalledWith(taskIds.conversation,expect.any(String),expect.stringContaining('Analise os arquivos anexados'),'cycle-test');
    expect(service.confirmTaskBatch).not.toHaveBeenCalled();
  });
  it("keeps only Setores in the header and reuses one operational conversation for successive messages", async () => {
    setup("/admin/tasks?conversation=untrusted-old-history");
    const input = screen.getByRole("textbox", {
      name: "Mensagem para Gestão de tarefas",
    });
    expect(screen.getByRole("button", { name: "Setores" })).toBeInTheDocument();
    for (const name of [
      "Histórico de conversas",
      "Quadro autorizado",
      "Mais ações da conversa",
      "OpenAI conectada",
    ])
      expect(screen.queryByLabelText(name)).not.toBeInTheDocument();
    for (const value of ["Primeiro pedido", "Segundo pedido"]) {
      fireEvent.change(input, { target: { value } });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
      await waitFor(() => expect(input).toHaveValue(""));
    }
    expect(service.postTaskMessage).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(service.postTaskMessage)
        .mock.calls.every((c) => c[0] === taskIds.conversation),
    ).toBe(true);
    expect(service.startTaskConversation).not.toHaveBeenCalled();
    expect(conversations).toHaveLength(1);
  });
  it("retries a provider failure against the saved message instead of reposting it", async () => {
    vi.mocked(ai.taskAiStatus).mockResolvedValue({
      configured: true,
      model: "gpt-4.1-mini",
      updated_at: now,
    });
    vi.mocked(ai.interpretTaskMessage)
      .mockRejectedValueOnce(new Error("Tente novamente"))
      .mockResolvedValueOnce({ draft_ids: [], reused: false });
    setup();
    const input = screen.getByRole("textbox", {
      name: "Mensagem para Gestão de tarefas",
    });
    fireEvent.change(input, {
      target: { value: "Pedido preservado para repetição" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(service.postTaskMessage).toHaveBeenCalledTimes(1);
    expect(ai.interpretTaskMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ai.interpretTaskMessage).mock.calls[0][0]).toBe(
      vi.mocked(ai.interpretTaskMessage).mock.calls[1][0],
    );
  });
  it("prepares an AI draft only after saving the message, and still requires explicit confirmation", async () => {
    vi.mocked(ai.taskAiStatus).mockResolvedValue({
      configured: true,
      model: "gpt-4.1-mini",
      updated_at: now,
    });
    vi.mocked(ai.interpretTaskMessage).mockImplementation(async (id) => {
      expect(messages.some((m) => m.id === id)).toBe(true);
      drafts = [makeDraft()];
      return { draft_ids: [taskIds.draft], reused: false };
    });
    setup();
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", {
          name: "Mensagem para Gestão de tarefas",
        }),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(ai.taskAiStatus).toHaveBeenCalled());
    fireEvent.change(
      screen.getByRole("textbox", { name: "Mensagem para Gestão de tarefas" }),
      { target: { value: "Preparar tarefa para o Financeiro" } },
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByRole("button", { name: "Aprovar e encaminhar" });
    expect(ai.interpretTaskMessage).toHaveBeenCalledTimes(1);
    expect(service.confirmTaskBatch).not.toHaveBeenCalled();
  });
  it("preserves a persisted message after provider failure and offers interpretation retry", async () => {
    vi.mocked(ai.taskAiStatus).mockResolvedValue({
      configured: true,
      model: "gpt-4.1-mini",
      updated_at: now,
    });
    vi.mocked(ai.interpretTaskMessage).mockRejectedValue(
      new Error("A OpenAI informou um limite de uso."),
    );
    setup();
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", {
          name: "Mensagem para Gestão de tarefas",
        }),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(ai.taskAiStatus).toHaveBeenCalled());
    fireEvent.change(
      screen.getByRole("textbox", { name: "Mensagem para Gestão de tarefas" }),
      { target: { value: "Pedido que deve ser preservado" } },
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/limite de uso/);
    expect(document.querySelector(".task-chat-user")).toHaveTextContent(
      "Pedido que deve ser preservado",
    );
    expect(
      screen.getByRole("textbox", { name: "Mensagem para Gestão de tarefas" }),
    ).toHaveValue("Pedido que deve ser preservado");
    expect(
      await screen.findByRole("button", {
        name: "Interpretar última mensagem com OpenAI",
      }),
    ).toBeEnabled();
    expect(service.postTaskMessage).toHaveBeenCalledTimes(1);
    expect(service.confirmTaskBatch).not.toHaveBeenCalled();
  });
  it("blocks confirmation when the AI draft contains unresolved fields", async () => {
    seed();
    drafts[0].payload = {
      ...taskValues(taskFixture()),
      sector_id: taskIds.sector,
      unresolved: ["Confirme o responsável homônimo."],
    };
    setup("/admin/tasks?conversation=" + taskIds.conversation);
    expect(
      await screen.findByRole("button", { name: "Aprovar e encaminhar" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Confirme o responsável homônimo/),
    ).toBeInTheDocument();
    expect(service.confirmTaskBatch).not.toHaveBeenCalled();
  });
  it("denies ordinary users before loading conversations", () => {
    controls.admin = false;
    setup();
    expect(
      screen.getByRole("heading", { name: "Acesso restrito" }),
    ).toBeInTheDocument();
    expect(service.listTaskConversations).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Preencher manualmente" }),
    ).not.toBeInTheDocument();
  });
  it("persists the message and honestly reports unavailable interpretation without inventing a draft", async () => {
    setup();
    expect(
      screen.queryByText(/Interpretação por IA pendente/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Mensagem para Gestão de tarefas" }),
      { target: { value: "Preparar uma atividade para o setor." } },
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(service.postTaskMessage).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByText("Preparar uma atividade para o setor."),
    ).toBeInTheDocument();
    expect(service.saveTaskDraft).not.toHaveBeenCalled();
    expect(service.confirmTaskBatch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Organizei a tarefa/)).not.toBeInTheDocument();
  });
  it("keeps unsent text on a failure and does not report success", async () => {
    vi.mocked(service.postTaskMessage).mockRejectedValue(
      new Error("Sem conexão"),
    );
    setup();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Mensagem para Gestão de tarefas" }),
      { target: { value: "Preservar esta mensagem" } },
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão");
    expect(
      screen.getByRole("textbox", { name: "Mensagem para Gestão de tarefas" }),
    ).toHaveValue("Preservar esta mensagem");
    expect(service.confirmTaskBatch).not.toHaveBeenCalled();
  });
  it("saves a manual draft then requires one explicit confirmation to create", async () => {
    setup();
    await tools();
    fireEvent.click(
      screen.getByRole("button", { name: "Preencher manualmente" }),
    );
    const d = screen.getByRole("dialog");
    fireEvent.change(within(d).getByLabelText("Título da tarefa"), {
      target: { value: "Encaminhamento controlado" },
    });
    fireEvent.change(within(d).getByLabelText("Setor"), {
      target: { value: taskIds.sector },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(service.saveTaskDraft).toHaveBeenCalledTimes(1));
    expect(service.confirmTaskBatch).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("button", {
      name: "Aprovar e encaminhar",
    });
    expect(screen.getByText("Fila do setor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar/ }));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(service.confirmTaskBatch).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("Pronto, as tarefas foram encaminhadas.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Selecionar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region",{name:"Resumo das tarefas"})).not.toBeInTheDocument();
  });
  it('removes a refused attachment without losing form edits and saves the new draft version',async()=>{
    seed();
    let files=[{id:'file',draft_id:taskIds.draft,workspace_id:taskIds.workspace,task_id:null,name:'recusado.txt',mime_type:'text/plain',size_bytes:10,storage_path:`${taskIds.workspace}/${taskIds.draft}/recusado.txt`,created_by:taskIds.admin,created_at:now}];
    vi.mocked(service.listTaskAttachments).mockImplementation(async()=>files);
    vi.mocked(service.removeTaskAttachment).mockImplementation(async()=>{
      files=[];drafts=drafts.map(d=>({...d,version:2}));return {version:2,cleanupPending:false};
    });
    setup();
    fireEvent.click(await screen.findByRole('button',{name:taskFixture().title}));
    fireEvent.change(await screen.findByLabelText('Prioridade'),{target:{value:'high'}});
    fireEvent.click(await screen.findByRole('button',{name:'Remover anexo recusado.txt'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Remover anexo recusado.txt'})).not.toBeInTheDocument());
    expect(screen.getByLabelText('Prioridade')).toHaveValue('high');
    fireEvent.click(screen.getByRole('button',{name:'Salvar ajustes'}));
    await waitFor(()=>expect(service.saveTaskDraft).toHaveBeenCalledWith(taskIds.conversation,taskIds.draft,2,expect.objectContaining({priority:'high'}),undefined,'cycle-test'));
  });
  it("opens filled adjustments and saves the same draft version without creating a task", async () => {
    seed();
    setup("/admin/tasks?conversation=" + taskIds.conversation);
    fireEvent.click(
      await screen.findByRole("button", { name: taskFixture().title }),
    );
    expect(await screen.findByLabelText("Título da tarefa")).toHaveValue(
      taskFixture().title,
    );
    fireEvent.change(screen.getByLabelText("Prioridade"), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ajustes" }));
    await waitFor(() =>
      expect(service.saveTaskDraft).toHaveBeenCalledWith(
        taskIds.conversation,
        taskIds.draft,
        1,
        expect.objectContaining({ priority: "high" }),
        undefined,
        "cycle-test",
      ),
    );
    expect(service.confirmTaskBatch).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Ver detalhes das tarefas" }),
    );
    expect(await screen.findByText("Alta")).toBeInTheDocument();
  });
  it("preserves the review after a confirmation failure", async () => {
    seed();
    vi.mocked(service.confirmTaskBatch).mockRejectedValue(
      new Error("Destino alterado; revise."),
    );
    setup("/admin/tasks?conversation=" + taskIds.conversation);
    await screen.findByRole("button", { name: "Aprovar e encaminhar" });
    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Aprovar e encaminhar (1)" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Destino alterado",
    );
    expect(
      screen.getByRole("button", { name: taskFixture().title }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("link", { name: "Abrir tarefa" }),
    ).not.toBeInTheDocument();
  });
  it("consults real supplied records and prepares redistribution against the same task ID", async () => {
    setup();
    await tools();
    fireEvent.click(
      await screen.findByRole("button", { name: "Consultar tarefas" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Revisar atribuição" }));
    expect(await screen.findByLabelText("Título da tarefa")).toHaveValue(
      taskFixture().title,
    );
    fireEvent.change(screen.getByLabelText("Setor"), {
      target: { value: taskIds.sector },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() =>
      expect(service.saveTaskDraft).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        0,
        expect.objectContaining({ title: taskFixture().title }),
        taskFixture().id,
        "cycle-test",
      ),
    );
    expect(service.confirmTaskBatch).not.toHaveBeenCalled();
  });
});

describe("current cycle isolation",()=>{
 it("never flashes completed history on hydration and sends oi into a fresh window",async()=>{
  seed();drafts[0]={...drafts[0],confirmed_task_id:taskFixture().id};
  messages=[{id:"old-message",cycle_id:"cycle-test",workspace_id:taskIds.workspace,conversation_id:taskIds.conversation,role:"assistant",content:"Resposta antiga que não deve reaparecer",request_key:"old",result:null,created_at:now}];
  currentCycle={...currentCycle,state:"completed",completed_at:"2026-10-18T10:00:00Z"};
  vi.mocked(service.prepareTaskCycle).mockImplementation(async()=>currentCycle={...currentCycle,id:"new-cycle",state:"active",completed_at:null});
  setup();await waitFor(()=>expect(screen.getByRole("button",{name:"Setores"})).toBeEnabled());
  expect(screen.queryByText("Resposta antiga que não deve reaparecer")).not.toBeInTheDocument();expect(screen.queryByRole("region",{name:"Resumo das tarefas"})).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox",{name:"Mensagem para Gestão de tarefas"}),{target:{value:"oi"}});
  await waitFor(()=>expect(screen.getByRole("button",{name:"Enviar"})).toBeEnabled());fireEvent.click(screen.getByRole("button",{name:"Enviar"}));
  expect(await screen.findByText("oi")).toBeInTheDocument();expect(screen.queryByText("Resposta antiga que não deve reaparecer")).not.toBeInTheDocument();expect(screen.queryByRole("region",{name:"Resumo das tarefas"})).not.toBeInTheDocument();
  expect(service.postTaskMessage).toHaveBeenCalledWith(taskIds.conversation,expect.any(String),"oi","new-cycle");expect(service.lookupTaskHistory).not.toHaveBeenCalled();
 });
 it("shows only current pending records after partial approval",async()=>{
  seed();drafts.push({...makeDraft(),id:"pending-second",payload:{...taskValues(taskFixture()),title:"Segunda pendente",sector_id:taskIds.sector,assigned_to:taskIds.user}});
  drafts.push({...makeDraft(),id:"old-pending",cycle_id:"previous",payload:{...taskValues(taskFixture()),title:"Histórico pendente"}});
  setup();await screen.findByRole("button",{name:taskFixture().title});expect(screen.queryByText("Histórico pendente")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox",{name:"Selecionar "+taskFixture().title}));fireEvent.click(screen.getByRole("button",{name:"Aprovar e encaminhar (1)"}));
  await screen.findByText("Pronto, as tarefas foram encaminhadas.");expect(screen.queryByRole("button",{name:taskFixture().title})).not.toBeInTheDocument();expect(screen.getByRole("button",{name:"Segunda pendente"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox",{name:"Selecionar Segunda pendente"}));fireEvent.click(screen.getByRole("button",{name:"Aprovar e encaminhar (1)"}));await waitFor(()=>expect(service.confirmTaskBatch).toHaveBeenCalledTimes(2));expect(vi.mocked(service.confirmTaskBatch).mock.calls[1][1].map(d=>d.id)).toEqual(["pending-second"]);
 });
});
