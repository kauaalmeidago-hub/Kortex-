import { supabase } from "@/integrations/supabase/client";
import { fileAccept, validateFileMetadata, validateFileBatch } from '../../../supabase/functions/_shared/file-inputs.mjs';
import type { Json } from "@/integrations/supabase/types";
import type {
  TaskAttachment,
  TaskDraft,
  TaskStageRow,
  TaskChatCycle,
  TaskHistoryRequest,
} from "@/integrations/supabase/taskTypes";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
import type { Task, TaskCatalog, TaskValues } from "./model";

export function taskFailure(error: unknown): never {
  const e = error as { code?: string; message?: string };
  if(e?.message?.includes('INVALID_COLUMNS'))
    throw new Error('Informe um nome de coluna com 1 a 80 caracteres.');
  if(e?.message?.includes('TASK_REMOVED'))
    throw new Error('Esta tarefa foi removida. Atualize o quadro ou use Desfazer.');
  if (e?.code === "42501")
    throw new Error(
      "Sua conta não tem permissão para esta ação. Confira seu acesso com a administração.",
    );
  if (e?.code === "PT409" || e?.code === "40001" || e?.code === "PGRST116")
    throw new Error(
      "Os dados foram alterados. Seu rascunho foi preservado; atualize e revise a versão mais recente antes de confirmar.",
    );
  if (e?.message?.includes("RECIPIENT_INELIGIBLE"))
    throw new Error(
      "O responsável não está mais disponível neste setor. Revise o destino.",
    );
  if (e?.message?.includes("SECTOR_REQUIRED"))
    throw new Error("Selecione o setor de destino.");
  if (e?.message?.includes("INVALID_TEXT"))
    throw new Error("Informe um título e uma descrição de até 500 caracteres.");
  if (e?.message?.includes("ATTACHMENT_UNAVAILABLE"))
    throw new Error(
      "Um anexo não está disponível. Confira os arquivos antes de confirmar.",
    );
  if (["42P01", "42703", "PGRST202", "PGRST204"].includes(e?.code ?? ""))
    throw new Error(
      "Esta área aguarda a atualização da integração de tarefas. Os dados preenchidos foram preservados.",
    );
  if (e?.code === "23503" || e?.code === "22023")
    throw new Error(
      "Confira os vínculos, a etapa e os dados da tarefa antes de tentar novamente.",
    );
  throw new Error(
    "Não foi possível concluir a operação. Os dados foram preservados; tente novamente.",
  );
}
function required<T>(result: {
  data: T | null;
  error: unknown;
}): NonNullable<T> {
  if (result.error) taskFailure(result.error);
  if (result.data == null)
    throw new Error(
      "A operação não retornou um registro. Confira a integração e tente novamente.",
    );
  return result.data as NonNullable<T>;
}
async function rows<T>(
  read: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const result: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await read(offset);
    if (r.error) taskFailure(r.error);
    result.push(...(r.data ?? []));
    if (!r.data || r.data.length < 500) return result;
  }
}
export async function listTasks(board: string, signal?: AbortSignal) {
  const tasks = await rows<Task>((offset) =>
    supabase
      .from("tasks")
      .select("*")
      .eq("board_id", board)
      .order("created_at", { ascending: false })
      .order("id")
      .abortSignal(signal)
      .range(offset, offset + 499),
  );
  const permissions = await supabase
    .rpc("business_task_permissions", { p_board: board })
    .abortSignal(signal);
  if (permissions.error) taskFailure(permissions.error);
  const byId = new Map(permissions.data?.map((p) => [p.id, p.can_edit]));
  return tasks.map((t) => ({ ...t, can_edit: byId.get(t.id) === true }));
}
export async function loadTaskCatalog(
  scope: BusinessContext,
  signal?: AbortSignal,
): Promise<TaskCatalog> {
  const { workspace_id: ws, sector_id: sector, board_id: board } = scope;
  const [companyResult, people, sectors, members, stages] = await Promise.all([
    rows((o) =>
      supabase
        .from("companies")
        .select("*")
        .eq("workspace_id", ws)
        .eq("sector_id", sector)
        .order("name")
        .order("id")
        .range(o, o + 499)
        .abortSignal(signal),
    ),
    supabase.rpc("business_people", { p_board: board }).abortSignal(signal),
    rows((o) =>
      supabase
        .from("task_sectors")
        .select("*")
        .eq("workspace_id", ws)
        .eq("id", sector)
        .order("id")
        .range(o, o + 499)
        .abortSignal(signal),
    ),
    rows((o) =>
      supabase
        .from("task_sector_members")
        .select("*")
        .eq("workspace_id", ws)
        .eq("sector_id", sector)
        .eq("active", true)
        .order("user_id")
        .range(o, o + 499)
        .abortSignal(signal),
    ),
    rows((o) =>
      supabase
        .from("task_stages")
        .select("*")
        .eq("workspace_id", ws)
        .eq("board_id", board)
        .order("position")
        .order("id")
        .range(o, o + 499)
        .abortSignal(signal),
    ),
  ]);
  if (people.error) taskFailure(people.error);
  return {
    companies: companyResult.map((c) => ({ ...c, avatarUrl: null })),
    people: people.data ?? [],
    sectors,
    members,
    stages,
    boards: [scope],
  };
}
export async function checkTaskAdmin(board: string, _uid?: string) {
  const r = await supabase.rpc("task_admin_access", {
    p_board: board,
  });
  if (r.error) taskFailure(r.error);
  return Boolean(r.data);
}
export async function savePersonalTask(
  board: string,
  request: string,
  values: TaskValues,
  previous?: Task | null,
) {
  const { sector_id: _sector, assigned_to: _assigned, ...payload } = values;
  const r = await supabase
    .rpc("business_save_task", {
      p_board: board,
      p_request: request,
      p_id: previous?.id ?? null,
      p_updated: previous?.updated_at ?? null,
      p_payload: payload,
    })
    .single();
  if (r.error) taskFailure(r.error);
  return r.data;
}
export async function moveTask(board:string,task:Task,stage:string) {
  return required(await supabase.rpc('business_move_task',{p_board:board,p_id:task.id,p_updated:task.updated_at,p_stage:stage}).single());
}
export async function removeTask(board:string,task:Task,request:string) {
  return required(await supabase.rpc('business_remove_task',{p_board:board,p_id:task.id,p_updated:task.updated_at,p_request:request}).single());
}
export async function restoreTask(board:string,id:string,request:string) {
  return required(await supabase.rpc('business_restore_task',{p_board:board,p_id:id,p_request:request}).single());
}
export async function saveTaskColumn(scope:BusinessContext,id:string,name:string,create:boolean) {
  return required(await supabase.rpc('business_task_column',{p_board:scope.board_id,p_version:scope.version,p_id:id,p_name:name.trim(),p_create:create}).single());
}
export function listTaskConversations(board: string, signal?: AbortSignal) {
  return rows((o) =>
    supabase
      .from("task_conversations")
      .select("*")
      .eq("board_id", board)
      .order("created_at", { ascending: false })
      .order("id")
      .range(o, o + 499)
      .abortSignal(signal),
  );
}
export async function startTaskConversation(board: string, id: string) {
  const r = await supabase
    .rpc("business_start_conversation", { p_board: board, p_id: id })
    .single();
  return required(r);
}
export async function operationalTaskConversation(board: string) {
  return required(await supabase.rpc("task_operational_conversation", { p_board: board }).single());
}
export function listTaskMessages(
  ws: string,
  conversation: string,
  signal?: AbortSignal,
  cycle?: string,
) {
  return rows((o) => {
    let query = supabase
      .from("task_messages")
      .select("*")
      .eq("workspace_id", ws)
      .eq("conversation_id", conversation);
    if(cycle)query=query.eq("cycle_id",cycle);
    return query
      .order("created_at")
      .order("id")
      .range(o, o + 499)
      .abortSignal(signal);
  });
}
export function listTaskDrafts(
  ws: string,
  conversation: string,
  signal?: AbortSignal,
  cycle?: string,
) {
  return rows((o) => {
    let query = supabase
      .from("task_drafts")
      .select("*")
      .eq("workspace_id", ws)
      .eq("conversation_id", conversation);
    if(cycle)query=query.eq("cycle_id",cycle);
    return query
      .order("created_at")
      .order("id")
      .range(o, o + 499)
      .abortSignal(signal);
  });
}
export async function postTaskMessage(
  conversation: string,
  request: string,
  content: string,
  cycle?: string,
) {
  const r = cycle ? await supabase.rpc("task_post_cycle_message",{p_cycle:cycle,p_request:request,p_content:content}).single() : await supabase
    .rpc("task_post_message", {
      p_conversation: conversation,
      p_request: request,
      p_content: content,
    })
    .single();
  if (r.error) taskFailure(r.error);
  return r.data;
}
export async function saveTaskDraft(
  conversation: string,
  id: string,
  version: number,
  values: TaskValues,
  target?: string | null,
  cycle?: string,
) {
  const r = cycle ? await supabase.rpc("task_save_cycle_draft",{p_cycle:cycle,p_id:id,p_version:version,p_payload:{...values,unresolved:[]},p_target:target??null}).single() : await supabase
    .rpc("task_save_draft", {
      p_conversation: conversation,
      p_id: id,
      p_version: version,
      p_payload: { ...values, unresolved: [] },
      p_target: target ?? null,
    })
    .single();
  return required(r);
}
export async function confirmTaskDraft(draft: TaskDraft) {
  // Consult the persisted operation before any repeat after a lost response.
  const current = await supabase
    .from("task_drafts")
    .select("*")
    .eq("workspace_id", draft.workspace_id)
    .eq("id", draft.id)
    .single();
  if (current.error) taskFailure(current.error);
  if (
    current.data.confirmed_task_id &&
    current.data.confirmed_version === draft.version
  ) {
    const task = await supabase
      .from("tasks")
      .select("*")
      .eq("workspace_id", draft.workspace_id)
      .eq("id", current.data.confirmed_task_id)
      .single();
    return required(task);
  }
  if (current.data.version !== draft.version) taskFailure({ code: "40001" });
  const r = await supabase
    .rpc("task_confirm_draft", { p_id: draft.id, p_version: draft.version })
    .single();
  if (r.error) taskFailure(r.error);
  return r.data;
}
export async function confirmTaskBatch(conversation: string, drafts: TaskDraft[], cycle?:string) {
  const items=drafts.map(d=>({id:d.id,version:d.version}));
  const r=cycle ? await supabase.rpc("task_confirm_cycle",{p_cycle:cycle,p_items:items}) : await supabase.rpc("task_confirm_batch",{p_conversation:conversation,p_items:items});
  if(r.error)taskFailure(r.error);
  const result=(cycle?(r.data as {items:unknown}).items:r.data) as {draft_id:string;task_id:string}[];
  if(!Array.isArray(result)||result.length!==drafts.length||result.some(r=>!r.task_id||!drafts.some(d=>d.id===r.draft_id)))throw new Error("O resultado do encaminhamento ainda é desconhecido. Atualize antes de tentar novamente.");
  return result;
}
export async function currentTaskCycle(conversation:string,signal?:AbortSignal){
  const r=await supabase.rpc("task_current_cycle",{p_conversation:conversation}).abortSignal(signal);if(r.error)taskFailure(r.error);return r.data as unknown as TaskChatCycle|null;
}
export async function prepareTaskCycle(conversation:string,expected:string|null,request:string){return required(await supabase.rpc("task_prepare_cycle",{p_conversation:conversation,p_expected:expected,p_request:request}).single());}
export async function resumeTaskDraft(cycle:string,draft:TaskDraft){return required(await supabase.rpc("task_resume_cycle_draft",{p_cycle:cycle,p_draft:draft.id,p_version:draft.version}).single());}
export async function lookupTaskHistory(conversation:string,kind:TaskHistoryRequest["kind"],query=""){
  const r=await supabase.rpc("task_history_lookup",{p_conversation:conversation,p_kind:kind,p_query:query,p_limit:5});if(r.error)taskFailure(r.error);return r.data as unknown as (Task|TaskDraft|import("@/integrations/supabase/taskTypes").TaskMessage)[];
}
export async function readTaskHistory(conversation:string,request:TaskHistoryRequest){
  if(!request.ids.length)return[];
  const r=await supabase.rpc("task_history_records",{p_conversation:conversation,p_kind:request.kind,p_ids:request.ids});if(r.error)taskFailure(r.error);return r.data as unknown as (Task|TaskDraft|import("@/integrations/supabase/taskTypes").TaskMessage)[];
}
export async function taskForReview(id:string){
  const t=required(await supabase.from("tasks").select("*").eq("id",id).single());
  const r=await supabase.rpc("business_task_permissions",{p_board:t.board_id});if(r.error)taskFailure(r.error);
  if(!r.data?.some(p=>p.id===id&&p.can_edit))taskFailure({code:"42501"});return {...t,can_edit:true};
}
export function listTaskAttachments(
  ws: string,
  task?: string,
  draft?: string,
  signal?: AbortSignal,
) {
  return rows<TaskAttachment>((o) => {
    let q = supabase
      .from("task_attachments")
      .select("*")
      .eq("workspace_id", ws);
    if (task) q = q.eq("task_id", task);
    if (draft) q = q.eq("draft_id", draft);
    return q
      .order("created_at")
      .order("id")
      .range(o, o + 499)
      .abortSignal(signal);
  });
}
export const taskFileAccept = fileAccept;
const pendingUploads = new WeakMap<File, Map<string, string>>();
export function validateTaskAttachment(file: File) {
  validateFileMetadata({name:file.name,size:file.size,mime:file.type});
}
export function validateTaskAttachments(files: File[]) {
  validateFileBatch(files.map(f=>({name:f.name,size:f.size,mime:f.type})));
}
export async function uploadTaskAttachment(
  ws: string,
  draft: TaskDraft,
  file: File,
) {
  validateTaskAttachment(file);
  const identities = pendingUploads.get(file) ?? new Map<string, string>();
  const id = identities.get(draft.id) ?? crypto.randomUUID();
  identities.set(draft.id, id);
  pendingUploads.set(file, identities);
  const path = `${ws}/${draft.id}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const bucket = supabase.storage.from("task-attachments");
  const upload = await bucket.upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (upload.error && String(upload.error.statusCode) !== "409")
    taskFailure(upload.error);
  const r = await supabase
    .rpc("task_register_attachment", {
      p_draft: draft.id,
      p_id: id,
      p_name: file.name,
      p_mime: file.type || "application/octet-stream",
      p_size: file.size,
      p_path: path,
    })
    .single();
  if (r.error) {
    await bucket.remove([path]);
    taskFailure(r.error);
  }
  return r.data;
}
export async function removeTaskAttachment(draft: TaskDraft, file: TaskAttachment) {
  if(draft.confirmed_task_id || file.task_id || file.draft_id!==draft.id || file.workspace_id!==draft.workspace_id)
    throw new Error('Somente anexos deste rascunho pendente podem ser removidos.');
  const result = await supabase.rpc('task_remove_attachment',{p_draft:draft.id,p_id:file.id,p_version:draft.version});
  if(result.error)taskFailure(result.error);
  const value=result.data as {path:string|null;version:number};
  if(!value || !Number.isInteger(value.version))throw new Error('Atualize o rascunho para conferir a remoção do arquivo.');
  // Metadata is removed first. Storage policy allows cleanup only for an unregistered object owned by this draft.
  let cleanupPending=false;
  if(value.path){
    if(value.path!==file.storage_path)throw new Error('Atualize o rascunho para conferir a remoção do arquivo.');
    try{cleanupPending=Boolean((await supabase.storage.from('task-attachments').remove([value.path])).error);}catch{cleanupPending=true;}
  }
  return {version:value.version,cleanupPending};
}
export async function taskAttachmentUrl(file: TaskAttachment) {
  const r = await supabase.storage
    .from("task-attachments")
    .createSignedUrl(file.storage_path, 60, { download: file.name });
  if (r.error) taskFailure(r.error);
  return r.data.signedUrl;
}
export async function saveTaskStages(
  scope: BusinessContext,
  stages: TaskStageRow[],
  moves: Record<string, string> = {},
) {
  const r = await supabase.rpc("business_save_columns", {
    p_board: scope.board_id,
    p_version: scope.version,
    p_columns: stages as unknown as Json,
    p_moves: moves,
  });
  if (r.error) taskFailure(r.error);
  return (await loadTaskCatalog(scope)).stages;
}
export async function removeTaskColumn(
  scope: BusinessContext,
  stages: TaskStageRow[],
  id: string,
  destination: string,
) {
  if (scope.kind !== "tasks" || !scope.can_manage)
    throw new Error("Sua conta não tem permissão para remover colunas deste quadro.");
  const source = stages.find((stage) => stage.id === id);
  const target = stages.find((stage) => stage.id === destination);
  if (!source || !target || id === destination || target.archived ||
      stages.some((stage) => stage.board_id && stage.board_id !== scope.board_id))
    throw new Error("Selecione uma coluna de destino disponível neste quadro.");
  if (!stages.some((stage) => stage.id !== id && !stage.archived))
    throw new Error("Mantenha pelo menos uma coluna ativa no quadro.");
  // The existing transaction transfers all rows, including filtered/hidden tasks,
  // before deleting only this stage. The server verifies version and authority.
  return saveTaskStages(scope, stages.filter((stage) => stage.id !== id), {
    [id]: destination,
  });
}
export async function createTaskSector(ws: string, name: string) {
  const r = await supabase.rpc("task_admin_create_sector", {
    p_workspace: ws,
    p_code: name.trim().toLowerCase(),
  });
  if (r.error) taskFailure(r.error);
  return r.data;
}
export async function setSectorMember(
  _ws: string,
  sector: string,
  user: string,
  enabled: boolean,
) {
  const r = await supabase.rpc("business_set_sector_member", {
    p_sector: sector,
    p_user: user,
    p_active: enabled,
  });
  if (r.error) taskFailure(r.error);
}
