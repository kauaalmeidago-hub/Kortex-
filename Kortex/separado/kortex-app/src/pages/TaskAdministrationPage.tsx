import { TaskChatDialogContent as DialogContent } from "@/components/tasks/TaskChatDialogContent";
import TaskHistoryView from "@/components/tasks/TaskHistoryView";
import { useChatDialog } from "@/features/tasks/useChatDialog";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Users, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBusinessAccess } from "@/features/access/BusinessAccess";
import TaskAdminBrand from "@/components/TaskAdminBrand";
import WhatsAppSupervision from "@/components/tasks/WhatsAppSupervision";
import KoaBrand from "@/components/KoaBrand";
import TaskDraftCollection from "@/components/tasks/TaskDraftCollection";
import { draftIssue } from "@/features/tasks/draft-batches";
import { useTaskCycle } from "@/features/tasks/useTaskCycle";
import { environmentKey } from "@/features/access/environment";
import KoaChatComposer from "@/components/KoaChatComposer";
import TaskFormDialog, { TaskField } from "@/components/tasks/TaskFormDialog";
import TaskAiConnectionDialog from "@/components/tasks/TaskAiConnectionDialog";
import { taskAiStatus, interpretTaskMessage } from "@/features/tasks/ai";
import { useTaskAdmin, useTasksData } from "@/features/tasks/hooks";
import {
  defaultTaskFilters,
  emptyCatalog,
  formatTaskDate,
  personLabel,
  priorityLabels,
  selectTasks,
  taskValues,
  validateTask,
  type Task,
  type TaskCatalog,
  type TaskValues,
} from "@/features/tasks/model";
import {
  currentTaskCycle, prepareTaskCycle, resumeTaskDraft, lookupTaskHistory, taskForReview,
  confirmTaskBatch,
  createTaskSector,
  listTaskDrafts,
  listTaskMessages,
  postTaskMessage,
  saveTaskDraft,
  setSectorMember,
  operationalTaskConversation,
  taskFileAccept,
  uploadTaskAttachment,
  removeTaskAttachment,
  validateTaskAttachments,
} from "@/features/tasks/service";
import type {
  TaskChatCycle, TaskHistoryRequest,
  TaskConversation,
  TaskDraft,
  TaskMessage,
} from "@/integrations/supabase/taskTypes";
import { TaskAttachments, TaskBadge } from "./TasksPage";
import "./TasksPage.css";
import "./TaskAdministrationPage.css";

export default function TaskAdministrationPage() {
  const location = useLocation();
  const [routeParams] = useSearchParams();
  const permission = useTaskAdmin();
  const {
    tasks,
    catalog,
    workspace,
    user,
    authLoading,
    contextError,
    retryContext,
    scope,
    access,
  } = useTasksData(true);
  const requestedBoard = routeParams.get("board");
  useEffect(() => {
    const destination =
      access.contexts?.find(
        (c) =>
          c.kind === "tasks" && c.board_id === requestedBoard && c.can_dispatch,
      ) ??
      (!scope?.can_dispatch
        ? access.contexts?.find(
            (c) =>
              c.kind === "tasks" &&
              c.can_dispatch &&
              (!scope || c.workspace_id === scope.workspace_id),
          )
        : null);
    if (
      destination &&
      scope?.board_id !== destination.board_id &&
      !access.loading
    )
      access.select(destination);
  }, [requestedBoard, scope, access]);
  if (authLoading)
    return (
      <div className="tasks-theme task-empty" role="status">
        <Loader2 className="animate-spin" />
        Carregando sua conta...
      </div>
    );
  if (contextError)
    return (
      <div className="tasks-theme task-empty">
        <p role="alert">{contextError}</p>
        <button className="task-button" onClick={retryContext}>
          Tentar novamente
        </button>
      </div>
    );
  if (!workspace || !user)
    return (
      <div className="tasks-theme task-empty">
        <TaskAdminBrand size={96} />
        <h1>Acesso administrativo</h1>
        <p>A Gestão de tarefas está disponível para contas administrativas.</p>
        <Link
          className="task-button"
          to="/auth/login"
          state={{ from: location }}
        >
          Entrar na plataforma
        </Link>
      </div>
    );
  if (permission.isLoading)
    return (
      <div className="tasks-theme task-empty">
        <Loader2 className="animate-spin" />
        Conferindo permissões...
      </div>
    );
  if (!permission.data)
    return (
      <div className="tasks-theme">
        <div className="task-empty">
          <TaskAdminBrand size={96} />
          <h1>Acesso restrito</h1>
          <p>
            {permission.error?.message ||
              "Esta área está disponível somente para administradores."}
          </p>
          <Link className="task-button" to="/tasks">
            Abrir minhas tarefas
          </Link>
        </div>
      </div>
    );
  return (
    <>
      <TaskAdminWorkspace
        key={`${workspace.id}:${user.id}`}
        workspaceId={workspace.id}
        userId={user.id}
        catalog={catalog.data ?? emptyCatalog}
        tasks={tasks.data ?? []}
        loading={catalog.isLoading || tasks.isLoading}
        loadError={(catalog.error || tasks.error)?.message}
        onRetry={() => {
          void catalog.refetch();
          void tasks.refetch();
        }}
      />
    </>
  );
}
export function TaskAdminWorkspace({
  workspaceId,
  userId,
  catalog,
  tasks,
  loading = false,
  loadError,
  onRetry,
}: {
  workspaceId?: string;
  userId?: string;
  catalog: TaskCatalog;
  tasks: Task[];
  loading?: boolean;
  loadError?: string;
  onRetry?: () => void;
}) {
  const client = useQueryClient();
  const access = useBusinessAccess();
  const scope = access.selected("tasks");
  const token = access.token;
  const cache = (resource: string) => access.key("tasks", resource);
  const [params, setParams] = useSearchParams();
  const canPersist = Boolean(workspaceId && userId);
  const ai = useQuery({
    queryKey: cache("task-ai-connection"),
    queryFn: () => taskAiStatus(workspaceId!),
    enabled: canPersist,
    retry: false,
    refetchInterval: 30000,
  });
  const [aiOpen, setAiOpen, aiDialogOpen] = useChatDialog(params.get("config") === "openai");
  const conversation = useQuery({
    queryKey: [...cache("task-operational-conversation"), workspaceId, userId],
    queryFn: () => operationalTaskConversation(scope!.board_id),
    enabled: canPersist,
    retry: false,
    staleTime: Infinity,
  });
  const selected = conversation.data;
  const conversationId = selected?.id ?? "";
  useEffect(() => {
    if (!selected || !access.isCurrent(token)) return;
    if (params.get("conversation") !== selected.id) {
      const next = new URLSearchParams(params);
      next.set("conversation", selected.id);
      setParams(next, { replace: true });
    }
  }, [selected, params, setParams, access, token]);
  const cycleKey = [...cache("task-current-cycle"),conversationId];
  const cycle = useQuery({queryKey:cycleKey,queryFn:({signal})=>currentTaskCycle(conversationId,signal),enabled:canPersist&&!!selected,retry:false,refetchInterval:15000});
  const cycleId=cycle.data?.id??"";
  const enteredAt=useRef(Date.now());
  const currentCycle=useRef(cycleId);currentCycle.current=cycleId;
  const [starting,setStarting]=useState(false);
  const messages = useQuery({
    queryKey:[...cache("task-messages"),conversationId,cycleId],
    queryFn:({signal})=>listTaskMessages(workspaceId!,conversationId,signal,cycleId),
    enabled:canPersist&&!!cycleId,retry:false,refetchInterval:15000,
  });
  const drafts = useQuery({
    queryKey:[...cache("task-drafts"),conversationId,cycleId],
    queryFn:({signal})=>listTaskDrafts(workspaceId!,conversationId,signal,cycleId),
    enabled:canPersist&&!!cycleId,retry:false,refetchInterval:15000,
  });
  const pendingDrafts=(drafts.data??[]).filter(d=>d.cycle_id===cycleId&&!d.confirmed_task_id);
  const visibleMessages=(messages.data??[]).filter(m=>m.cycle_id===cycleId);
  const textKey = `task-operational-text:${environmentKey}:${workspaceId}:${userId}`;
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(textKey) || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(textKey, text);
      else sessionStorage.removeItem(textKey);
    } catch {
      /* optional unsent text recovery */
    }
  }, [text, textKey]);
  const [busy, setBusy] = useState("");
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queries, setQueries] = useState(false);
  const [sectorsOpen, setSectorsOpen, sectorsDialogOpen] = useChatDialog(false);
  const [historical,setHistorical]=useState<TaskHistoryRequest|null>(null);
  const [editor, setEditor, editorOpen] = useChatDialog<{
    draft?: TaskDraft;
    target?: Task;
    trigger?: HTMLElement | null;
    initial: TaskValues;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const editorState = useRef({value:editor,open:editorOpen});
  editorState.current = {value:editor,open:editorOpen};
  const fileInput = useRef<HTMLInputElement>(null);
  const sectorsTrigger = useRef<HTMLButtonElement>(null);
  const activeDraft = useRef("");
  const [attachmentPicker, setAttachmentPicker, attachmentDialogOpen] = useChatDialog(false);
  const [selectingFiles, setSelectingFiles] = useState(false);
  useEffect(() => {
    const input = fileInput.current;
    const cancel = () => setSelectingFiles(false);
    input?.addEventListener("cancel", cancel);
    return () => input?.removeEventListener("cancel", cancel);
  }, []);
  const chooseFiles = () => {
    setSelectingFiles(true);
    fileInput.current?.click();
  };
  const retryKey = textKey + ":request";
  const [recovery] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(retryKey) || "null");
      return saved?.content === text.trim() &&
        typeof saved?.request === "string"
        ? (saved as {
            request: string;
            content: string;
            conversation: string;
            message?: TaskMessage;
          })
        : null;
    } catch {
      return null;
    }
  });
  const request = useRef<string | null>(recovery?.request ?? null);
  const postedMessage = useRef<TaskMessage | null>(recovery?.message ?? null);
  const rememberRequest = (
    value: {
      request: string;
      content: string;
      conversation: string;
      message?: TaskMessage;
    } | null,
  ) => {
    try {
      if (value) sessionStorage.setItem(retryKey, JSON.stringify(value));
      else sessionStorage.removeItem(retryKey);
    } catch {
      /* server idempotency remains authoritative */
    }
  };
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});
  const [historyFocused, setHistoryFocused] = useState(false);
  const onDetailsChange = useCallback(
    (id: string, open: boolean) =>
      setOpenDetails((s) => (s[id] === open ? s : { ...s, [id]: open })),
    [],
  );
  const flow = useTaskCycle({
    identity: `task-cycle:${environmentKey}:${workspaceId}:${userId}:${conversationId}`,
    drafts: pendingDrafts,
    messages: visibleMessages,
    serverCycle: cycle.data ?? null,
    ready: Boolean(selected && cycle.isSuccess && (!cycleId || (drafts.isSuccess && messages.isSuccess))),
    blocked: Boolean(
      busy ||
      uploading ||
      text ||
      pendingFiles.length ||
      sectorsOpen ||
      editor ||
      aiOpen ||
      attachmentPicker ||
      selectingFiles ||
      queries || historical ||
      historyFocused ||
      Object.values(openDetails).some(Boolean),
    ),
    hasError: Boolean(
      error ||
      loadError ||
      conversation.error || cycle.error ||
      drafts.error ||
      messages.error,
    ),
    activeWork: Boolean(text || pendingFiles.length),
  });
  const first = catalog.stages.find((s) => !s.archived)?.id ?? "todo";
  const refresh = async () => {
    if (!access.isCurrent(token)) return;
    await Promise.all([
      client.invalidateQueries({queryKey:cache("task-current-cycle")}),
      client.invalidateQueries({queryKey:cache("task-history")}),
      client.invalidateQueries({
        queryKey: cache("task-operational-conversation"),
      }),
      client.invalidateQueries({
        queryKey: cache("task-messages"),
      }),
      client.invalidateQueries({
        queryKey: cache("task-drafts"),
      }),
      client.invalidateQueries({ queryKey: cache("task-attachments") }),
      client.invalidateQueries({ queryKey: cache("tasks") }),
      client.invalidateQueries({ queryKey: cache("task-count") }),
    ]);
  };
  const ensureConversation = async (): Promise<TaskConversation> => {
    if (!canPersist)
      throw new Error("Entre com uma conta administrativa para salvar.");
    if (selected && access.isCurrent(token)) return selected;
    const result = await conversation.refetch();
    if (!result.data || !access.isCurrent(token))
      throw new Error(
        result.error?.message ||
          "Confira seu contexto autorizado e tente novamente.",
      );
    return result.data;
  };
  const ensureCycle = async (c:TaskConversation,key:string):Promise<TaskChatCycle>=>{
    await client.cancelQueries({queryKey:cycleKey});
    const active=await prepareTaskCycle(c.id,cycle.data?.id??null,key);
    if(!access.isCurrent(token))throw new Error("O contexto mudou. Confira sua conta.");
    currentCycle.current=active.id;
    client.setQueryData(cycleKey,active);
    setHistorical(null);setQueries(false);
    return active;
  };
  const stillCurrent=(id:string)=>access.isCurrent(token)&&currentCycle.current===id;
  const send = async () => {
    if (
      inFlight.current ||
      (!text.trim() && !pendingFiles.length) ||
      !canPersist ||
      ai.isLoading
    )
      return;
    inFlight.current = true;
    flow.interact(true);
    setBusy("message");
    setError("");
    setNotice("");
    const content = text.trim() || (pendingFiles.length
      ? 'Analise os arquivos anexados para preparar o direcionamento da tarefa. Se a ação não estiver clara no contexto, pergunte o que precisa ser feito.'
      : '');
    setStarting(cycle.data?.state!=="active");
    try {
      const c = await ensureConversation();
      request.current ??= crypto.randomUUID();
      const active=await ensureCycle(c,request.current);
      setStarting(false);
      if (pendingFiles.length) await upload(c, pendingFiles,active.id);
      if (!content) {
        await refresh();
        return;
      }
      request.current ??= crypto.randomUUID();
      const requestId = request.current;
      rememberRequest({ request: requestId, content, conversation: c.id });
      const message =
        postedMessage.current?.content === content &&
        postedMessage.current.conversation_id === c.id && postedMessage.current.cycle_id === active.id
          ? postedMessage.current
          : await postTaskMessage(c.id, requestId, content, active.id);
      postedMessage.current = message;
      rememberRequest({
        request: requestId,
        content,
        conversation: c.id,
        message,
      });
      if (!stillCurrent(active.id)) return;
      await client.cancelQueries({
        queryKey: [...cache("task-messages"), c.id, active.id],
      });
      client.setQueryData(
        [...cache("task-messages"), c.id, active.id],
        (
          rows:
            | import("@/integrations/supabase/taskTypes").TaskMessage[]
            | undefined,
        ) => [...(rows ?? []).filter((m) => m.id !== message.id), message],
      );
      if (ai.data?.configured && message?.id) {
        setNotice("Mensagem registrada. Preparando rascunho com a OpenAI...");
        await interpretTaskMessage(message.id);
        if(!stillCurrent(active.id))return;
        setNotice("");
      } else
        setNotice(
          "Mensagem registrada. A interpretação por IA aguarda configuração; use Preencher manualmente para preparar a tarefa.",
        );
      request.current = null;
      postedMessage.current = null;
      rememberRequest(null);
      setText((value) => (value.trim() === content ? "" : value));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      inFlight.current = false;
      setBusy("");
      setStarting(false);
    }
  };
  const upload = async (c: TaskConversation, files: File[], active:string) => {
    setUploading(true);
    let remaining = files;
    try {
      validateTaskAttachments(files);
      let d = drafts.data?.find(
        (d) => d.id === activeDraft.current && d.cycle_id === active && !d.confirmed_task_id,
      );
      if (!d) {
        d = await saveTaskDraft(c.id, crypto.randomUUID(), 0, {
          ...taskValues(undefined, first),
          board_id: scope?.board_id,
          sector_id: scope?.sector_id ?? "",
        },undefined,active);
        activeDraft.current = d.id;
      }
      for (const file of files) {
        setNotice(`Enviando ${file.name}...`);
        await uploadTaskAttachment(workspaceId!, d, file);
        remaining = remaining.slice(1);
        setPendingFiles(remaining);
        await refresh();
      }
      setPendingFiles([]);
      setNotice(
        "Anexos enviados. Complete e revise o rascunho antes de confirmar.",
      );
    } catch (e) {
      setPendingFiles(remaining);
      throw e;
    } finally {
      setUploading(false);
    }
  };
  const latestUserMessage = visibleMessages
    .filter((m) => m.role === "user")
    .slice(-1)[0];
  const latestMessage = latestUserMessage?.content ?? "";
  const runAi = async () => {
    if (inFlight.current || !latestUserMessage || !ai.data?.configured) return;
    inFlight.current = true;
    const interpretingCycle=cycleId;
    flow.interact(true);
    setBusy("interpret");
    setError("");
    setNotice("Preparando rascunho com a OpenAI...");
    try {
      await interpretTaskMessage(latestUserMessage.id);
      if(!stillCurrent(interpretingCycle))return;
      setText((value) =>
        value.trim() === latestUserMessage.content ? "" : value,
      );
      postedMessage.current = null;
      rememberRequest(null);
      request.current = null;
      setNotice("");
    } catch (e) {
      setError((e as Error).message);
      setNotice(
        "Sua mensagem foi preservada. Você pode tentar a interpretação novamente.",
      );
    } finally {
      await refresh();
      inFlight.current = false;
      setBusy("");
    }
  };
  const openManual = (trigger: HTMLElement, target?: Task) => {
    flow.interact(true);
    setEditor({
      trigger,
      target,
      initial: target
        ? taskValues(target, first)
        : {
            ...taskValues(undefined, first),
            board_id: scope?.board_id,
            sector_id: scope?.sector_id ?? "",
            description: latestMessage,
          },
    });
  };
  const confirm = async (items: TaskDraft[]) => {
    if (inFlight.current || uploading || pendingFiles.length || !items.length)
      return;
    const invalid = items.map((d) => draftIssue(d, catalog)).find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }
    inFlight.current = true;
    setBusy("batch");
    setError("");
    setNotice("");
    try {
      const result = await confirmTaskBatch(conversationId, items,cycleId);
      if(!stillCurrent(cycleId))return;
      await client.cancelQueries({queryKey:[...cache("task-drafts"),conversationId,cycleId]});
      client.setQueryData([...cache("task-drafts"),conversationId,cycleId],(rows:TaskDraft[]|undefined)=>rows?.filter(d=>!result.some(r=>r.draft_id===d.id)));
      setNotice("");
      await client.invalidateQueries({
        predicate: (q) =>
          q.queryKey.includes(userId) &&
          q.queryKey.includes(workspaceId) &&
          ["tasks", "task-count"].some((r) => q.queryKey.includes(r)),
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
      throw e;
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  };
  const reviewExisting=async(task:Task,trigger:HTMLElement)=>{
    flow.interact();
    try{const fresh=await taskForReview(task.id);if(access.isCurrent(token))openManual(trigger,fresh);}catch(e){setError((e as Error).message);}
  };
  const resumeHistorical=async(draft:TaskDraft)=>{
    if(inFlight.current)return;inFlight.current=true;flow.interact();setBusy("resume");setError("");
    try{const c=await ensureConversation(),active=await ensureCycle(c,crypto.randomUUID());await resumeTaskDraft(active.id,draft);await refresh();}
    catch(e){setError((e as Error).message);throw e;}finally{inFlight.current=false;setBusy("");}
  };
  const showHistoricalDrafts=async()=>{
    flow.interact();setBusy("history");setError("");
    try{const rows=await lookupTaskHistory(conversationId,"drafts");setHistorical({kind:"drafts",ids:rows.map(r=>r.id),intent:"resume"});}
    catch(e){setError((e as Error).message);}finally{setBusy("");}
  };
  const hasContent = Boolean(
    visibleMessages.length || pendingDrafts.length || queries || historical,
  );
  const queryError = conversation.error || cycle.error || messages.error || drafts.error;
  const hydrating=loading||conversation.isLoading||starting||Boolean(selected&&cycle.isLoading)||Boolean(cycleId&&(messages.isLoading||drafts.isLoading));
  const showInitial=!hydrating&&!loadError&&(!hasContent||(flow.initial&&!queries&&!historical));
  return (
    <div
      className="tasks-theme task-admin"
      data-conversation-id={conversationId}
      data-cycle-id={cycleId}
    >
      <header className="task-admin-toolbar">
        <WhatsAppSupervision />
        <h1 className="sr-only">Gestão de tarefas</h1>
        <button
          ref={sectorsTrigger}
          className="task-button task-sectors-button"
          onClick={() => setSectorsOpen(true)}
        >
          <Users size={16} />
          Setores
        </button>
      </header>
      <div className="task-admin-chat">
        <div className="task-admin-stage">
          <div className="task-admin-empty" data-visible={showInitial} aria-hidden={!showInitial}>
            <TaskAdminBrand size={104}/><h2>Qual tarefa vamos realizar hoje e para qual setor?</h2><p>Descreva a tarefa. Você poderá revisar as informações antes de confirmar.</p>
          </div>
        {loading ||
        conversation.isLoading || starting ||
        (selected && cycle.isLoading) ||
        (cycleId && (messages.isLoading || drafts.isLoading)) ? (
          <div className="task-empty">
            <Loader2 className="animate-spin" />
            Carregando cadastros...
          </div>
        ) : loadError ? (
          <div className="task-empty">
            <p role="alert">{loadError}</p>
            <button className="task-button" onClick={onRetry}>
              Tentar novamente
            </button>
          </div>
        ) : (hasContent && (!flow.initial || queries || historical)) ? (
          <div
            className="task-admin-history"
            onFocusCapture={() => setHistoryFocused(true)}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                setHistoryFocused(false);
            }}
          >
            {queries && (
              <TaskAdminQueries
                tasks={tasks}
                catalog={catalog}
                userId={userId}
                onClose={()=>setQueries(false)}
                onReview={(task, trigger) => void reviewExisting(task,trigger)}
              />
            )}
            {historical && <TaskHistoryView key={historical.ids.join(":")} conversation={conversationId} request={historical} busy={!!busy} onResume={resumeHistorical} onRevise={reviewExisting}/>}
            {!flow.initial && visibleMessages.map((m) =>
              m.role === "user" ? (
                <div className={`task-chat-user ${Date.parse(m.created_at)>=enteredAt.current?"task-message-enter":""}`} key={m.id}>
                  {m.content}
                </div>
              ) : (
                <div className={`task-chat-assistant ${Date.parse(m.created_at)>=enteredAt.current?"task-message-enter":""}`} key={m.id}>
                  <KoaBrand size={36} />
                  <div>{m.content}{historyRequest(m) && <TaskHistoryView conversation={conversationId} request={historyRequest(m)!} busy={!!busy} onResume={resumeHistorical} onRevise={reviewExisting}/>}</div>
                </div>
              ),
            )}
            {Array.from(
              new Set(pendingDrafts.map((d) => d.batch_id || "legacy")),
            ).map((batch) => (
              <TaskDraftCollection
                key={cycleId + ":" + batch}
                workspaceId={workspaceId}
                catalog={catalog}
                drafts={pendingDrafts.filter(
                  (d) => (d.batch_id || "legacy") === batch,
                )}
                busy={Boolean(busy) || uploading || pendingFiles.length > 0}
                onEdit={(d, trigger) => {
                  flow.interact(true);
                  setEditor({
                    draft: d,
                    trigger,
                    initial: taskValues(
                      d.payload as Partial<TaskValues>,
                      first,
                    ),
                  });
                }}
                onApprove={confirm}
                onDetailsChange={onDetailsChange}
              />
            ))}
            {cycle.data?.state === "active" && !pendingDrafts.length && (
              <button
                className="task-button"
                onClick={(e) => openManual(e.currentTarget)}
                disabled={Boolean(busy) || uploading}
              >
                <Pencil size={16} />
                Preencher manualmente
              </button>
            )}
          </div>
        ) : null}
        </div>
        {(error || queryError) && (
          <div className="task-admin-error">
            <p className="task-error" role="alert">
              {error || queryError?.message}
            </p>
            {queryError && (
              <button
                type="button"
                className="task-link"
                onClick={() => void refresh()}
              >
                Tentar novamente
              </button>
            )}
          </div>
        )}
        <div className="task-chat-bottom">
          <KoaChatComposer
            multiline
            multilineRows={1}
            allowEmpty={pendingFiles.length > 0}
            submitting={Boolean(busy) || uploading}
            value={text}
            onChange={(v) => {
              flow.interact();
              setText(v);
              request.current = null;
              if (postedMessage.current?.content !== v.trim()) {
                postedMessage.current = null;
                rememberRequest(null);
              }
            }}
            onSubmit={() => void send()}
            disabled={
              !canPersist ||
              Boolean(busy) ||
              uploading ||
              Boolean(loadError) ||
              ai.isLoading ||
              !selected || cycle.isLoading
            }
            inputLabel="Mensagem para Gestão de tarefas"
            onAttach={() => {
              const pending = (drafts.data ?? []).filter(
                (d) => !d.confirmed_task_id,
              );
              if (pending.length > 1) setAttachmentPicker(true);
              else {
                activeDraft.current = pending[0]?.id ?? "";
                chooseFiles();
              }
            }}
            attachmentDisabled={
              !canPersist ||
              Boolean(busy) ||
              uploading ||
              Boolean(editor) ||
              pendingFiles.length > 0
            }
            attachmentTitle="PDF, imagens, documentos e planilhas · até 5 arquivos, 20 MB por arquivo e 40 MB no total"
          />
          <input
            className="sr-only"
            ref={fileInput}
            aria-label="Arquivos da tarefa"
            type="file"
            accept={taskFileAccept}
            multiple
            onChange={(e) => {
              setSelectingFiles(false);
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (!files.length) return;
              flow.interact();
              try {
                validateTaskAttachments(files);
                setPendingFiles(files);
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
          {pendingFiles.length > 0 && (
            <ul
              className="task-pending-files"
              aria-label="Arquivos selecionados"
            >
              {pendingFiles.map((file, index) => (
                <li key={index}>
                  <span>{file.name}</span>
                  <button
                    type="button"
                    aria-label={`Remover ${file.name}`}
                    disabled={Boolean(busy) || uploading}
                    onClick={() =>
                      setPendingFiles((files) =>
                        files.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {notice && !flow.initial && (
            <p className="task-help" role="status">
              {notice}
            </p>
          )}
          {error && latestUserMessage && ai.data?.configured && (
            <button
              className="task-link"
              disabled={Boolean(busy) || uploading}
              onClick={() => void runAi()}
            >
              Interpretar última mensagem com OpenAI
            </button>
          )}
          {pendingFiles.length > 0 && !uploading && (
            <button
              className="task-link"
              disabled={Boolean(busy)}
              onClick={() => void send()}
            >
              Tentar enviar {pendingFiles.length} anexo(s) novamente
            </button>
          )}
          {pendingFiles.length > 0 && !uploading && (
            <button
              type="button"
              className="task-link"
              onClick={() => {
                setPendingFiles([]);
                setError("");
                setNotice(
                  "Seleção não enviada descartada. Os anexos já registrados foram preservados.",
                );
              }}
            >
              Descartar seleção não enviada
            </button>
          )}
        </div>
      </div>
      {attachmentPicker && (
        <Dialog open={attachmentDialogOpen} onOpenChange={setAttachmentPicker}>
          <DialogContent className="tasks-theme task-dialog task-attachment-picker">
            <DialogTitle>Anexar a qual tarefa?</DialogTitle>
            <DialogDescription>
              O arquivo será vinculado somente ao rascunho escolhido.
            </DialogDescription>
            {(drafts.data ?? [])
              .filter((d) => !d.confirmed_task_id)
              .map((d) => (
                <button
                  className="task-button"
                  key={d.id}
                  onClick={() => {
                    activeDraft.current = d.id;
                    setAttachmentPicker(false);
                    chooseFiles();
                  }}
                >
                  {taskValues(d.payload as never).title ||
                    "Rascunho a preencher"}
                </button>
              ))}
          </DialogContent>
        </Dialog>
      )}
      {editor && (
        <TaskFormDialog
          open={editorOpen} chatMotion
          initial={editor.initial}
          catalog={catalog}
          admin
          title={
            editor.draft
              ? "Ajustar informações"
              : editor.target
                ? "Revisar atribuição"
                : "Preparar encaminhamento"
          }
          submitLabel={editor.draft ? "Salvar ajustes" : "Salvar rascunho"}
          returnFocus={editor.trigger}
          onClose={() => setEditor(null)}
          disabledReason={
            !canPersist
              ? "Entre com uma conta administrativa para salvar."
              : undefined
          }
          onSave={async (v, key) => {
            const c = await ensureConversation();
            const active=await ensureCycle(c,key);
            const d = await saveTaskDraft(
              c.id,
              editor.draft?.id ?? key,
              editor.draft?.version ?? 0,
              { ...v, title: v.title.trim() },
              editor.target?.id,
              active.id,
            );
            activeDraft.current = d.id;
            editor.trigger
              ?.closest(".task-collection")
              ?.dispatchEvent(new CustomEvent("draft-reviewed", { detail: d }));
            await refresh();
            setNotice(
              "Rascunho salvo. Confira o resumo e confirme o encaminhamento.",
            );
          }}
        >
          {editor.draft && (
            <TaskAttachments
              workspaceId={workspaceId}
              draftId={editor.draft.id}
              onRemove={async(file)=>{
                const result=await removeTaskAttachment(editor.draft!,file);
                const current=editorState.current;
                if(current.open && current.value?.draft?.id===editor.draft!.id)
                  setEditor({...current.value,draft:{...current.value.draft,version:result.version}});
                await refresh();
                if(result.cleanupPending)setNotice('Anexo desvinculado do rascunho. A limpeza do arquivo armazenado ficou pendente.');
              }}
            />
          )}
        </TaskFormDialog>
      )}
      {aiOpen && workspaceId && ai.isError && (
        <Dialog open={aiDialogOpen} onOpenChange={setAiOpen}>
          <DialogContent className="tasks-theme task-dialog task-ai-dialog">
            <DialogTitle>Conexão OpenAI</DialogTitle>
            <DialogDescription>
              Não foi possível consultar a conexão salva. A configuração
              existente foi preservada.
            </DialogDescription>
            <button className="task-button" onClick={() => void ai.refetch()}>
              Tentar novamente
            </button>
          </DialogContent>
        </Dialog>
      )}
      {aiOpen && workspaceId && !ai.isLoading && !ai.isError && (
        <TaskAiConnectionDialog
          open={aiDialogOpen} chatMotion
          workspace={workspaceId}
          connection={ai.data}
          onSaved={() => ai.refetch()}
          onClose={() => {
            setAiOpen(false);
            const next = new URLSearchParams(params);
            next.delete("config");
            setParams(next, { replace: true });
          }}
        />
      )}
      {sectorsOpen && (
        <TaskSectorsDialog
          open={sectorsDialogOpen}
          catalog={catalog}
          workspaceId={workspaceId}
          onClose={() => setSectorsOpen(false)}
          tools={
            <details className="task-admin-tools">
              <summary>Ferramentas administrativas</summary>
              <button
                type="button"
                className="task-link"
                onClick={() => {
                  setSectorsOpen(false);
                  flow.interact(true);
                  setQueries(true);
                }}
              >
                Consultar tarefas
              </button>
              <button
                type="button"
                className="task-link"
                onClick={(e) => {
                  setSectorsOpen(false);
                  openManual(sectorsTrigger.current || e.currentTarget);
                }}
              >
                Preencher manualmente
              </button>
              <button
                type="button"
                className="task-link"
                onClick={() => {
                  setSectorsOpen(false);
                  void showHistoricalDrafts();
                }}
              >
                Consultar rascunhos anteriores
              </button>
              <button
                type="button"
                className="task-link"
                onClick={() => {
                  setSectorsOpen(false);
                  setAiOpen(true);
                }}
              >
                Configuração de IA
              </button>
            </details>
          }
        />
      )}
    </div>
  );
}
function historyRequest(m:TaskMessage):TaskHistoryRequest|null{
  const h=(m.result as {history?:TaskHistoryRequest}|null)?.history;
  return h && ["tasks","drafts","messages"].includes(h.kind) && Array.isArray(h.ids) && h.ids.length<=10 ? h : null;
}
function TaskAdminQueries({
  tasks,
  catalog,
  userId,
  onReview,
  onClose,
}: {
  tasks: Task[];
  catalog: TaskCatalog;
  userId?: string;
  onReview: (task: Task, trigger: HTMLElement) => void;
  onClose:()=>void;
}) {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("");
  const [limit, setLimit] = useState(30);
  const result = selectTasks(
    tasks,
    { ...defaultTaskFilters, query, sector },
    catalog,
    userId,
  );
  return (
    <section className="task-admin-queries">
      <h2>Consultar tarefas reais</h2>
      <button className="task-link" onClick={onClose}>Fechar consulta</button>
      <header>
        <input
          aria-label="Pesquisar tarefas administrativas"
          placeholder="Título, empresa ou código..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(30);
          }}
        />
        <select
          aria-label="Setor da consulta"
          value={sector}
          onChange={(e) => {
            setSector(e.target.value);
            setLimit(30);
          }}
        >
          <option value="">Todos os setores</option>
          {catalog.sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </header>
      <p className="task-help">
        {result.length} tarefas autorizadas. Redistribuir altera o mesmo
        registro após sua confirmação.
      </p>
      {result.slice(0, limit).map((t) => (
        <div className="task-admin-query-row" key={t.id}>
          <div>
            <strong>{t.title}</strong>
            <small>
              {catalog.sectors.find((s) => s.id === t.sector_id)?.name ||
                "Sem setor"}{" "}
              · {personLabel(t.assigned_to, catalog.people, userId)} ·{" "}
              {formatTaskDate(t.due_date)}
            </small>
          </div>
          <button
            className="task-button"
            onClick={(e) => onReview(t, e.currentTarget)}
          >
            <Pencil size={14} />
            Revisar atribuição
          </button>
        </div>
      ))}
      {limit < result.length && (
        <button className="task-button" onClick={() => setLimit((v) => v + 30)}>
          Mostrar mais
        </button>
      )}
    </section>
  );
}
function TaskSectorsDialog({
  catalog,
  workspaceId,
  onClose,
  tools,
  open = true,
}: {
  open?:boolean;
  catalog: TaskCatalog;
  workspaceId?: string;
  onClose: () => void;
  tools?: ReactNode;
}) {
  const client = useQueryClient();
  const access = useBusinessAccess();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const refresh = () => {
    access.retry();
    return client.invalidateQueries({
      queryKey: access.key("tasks", "task-catalog"),
    });
  };
  const run = async (fn: () => Promise<unknown>) => {
    if (inFlight.current || !workspaceId) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent className="tasks-theme task-dialog">
        <header>
          <DialogTitle>Setores e integrantes</DialogTitle>
          <DialogDescription>
            Use os integrantes cadastrados na equipe. Vínculos de setor não
            alteram papéis administrativos.
          </DialogDescription>
          <DialogClose asChild>
            <button
              className="task-close"
              aria-label="Fechar setores"
              disabled={busy}
            >
              <X size={18} />
            </button>
          </DialogClose>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim())
              void run(async () => {
                await createTaskSector(workspaceId!, name);
                setName("");
              });
          }}
        >
          <div className="task-dialog-body">
            <div className="task-sector-form">
              <TaskField label="Novo setor">
                <select value={name} onChange={(e) => setName(e.target.value)}>
                  <option value="">Selecione o setor</option>
                  <option value="financeiro">Financeiro</option>
                  <option value="relacionamento">Relacionamento</option>
                  <option value="comercial">Comercial</option>
                </select>
              </TaskField>
              <button
                className="task-button task-cyan"
                disabled={!workspaceId || busy || !name.trim()}
              >
                Adicionar setor
              </button>
            </div>
            <div className="task-sector-list">
              {catalog.sectors.map((s) => (
                <section className="task-sector-members" key={s.id}>
                  <h3>
                    {s.name}
                    {!s.active ? " (inativo)" : ""}
                  </h3>
                  {catalog.people.map((p) => (
                    <label key={p.user_id}>
                      <input
                        type="checkbox"
                        checked={catalog.members.some(
                          (m) =>
                            m.sector_id === s.id && m.user_id === p.user_id,
                        )}
                        disabled={!workspaceId || busy || !s.active}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          void run(() =>
                            setSectorMember(
                              workspaceId!,
                              s.id,
                              p.user_id,
                              checked,
                            ),
                          );
                        }}
                      />
                      {p.full_name && p.email
                        ? `${p.full_name} · ${p.email}`
                        : p.full_name || p.email || "Integrante sem nome"}
                    </label>
                  ))}
                </section>
              ))}
              {!catalog.sectors.length && (
                <p className="task-help">
                  Nenhum setor cadastrado. Adicione um setor e escolha seus
                  integrantes antes de encaminhar.
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="task-error">
                {error}
              </p>
            )}
          </div>
          <footer>
            {tools}
            <button
              type="button"
              className="task-button"
              disabled={busy}
              onClick={onClose}
            >
              Fechar
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
