import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckSquare,
  Clock3,
  Grid2X2,
  List,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import TaskFormDialog from "@/components/tasks/TaskFormDialog";
import { useTasksData } from "@/features/tasks/hooks";
import {
  canEdit,
  dateKey,
  defaultTaskFilters,
  emptyCatalog,
  formatTaskDate,
  overdue,
  personLabel,
  priorityLabels,
  selectTasks,
  taskValues,
  type Task,
  type TaskCatalog,
  type TaskFilters,
  type TaskValues,
} from "@/features/tasks/model";
import {
  listTaskAttachments,
  moveTask,
  removeTask,
  removeTaskColumn,
  restoreTask,
  saveTaskColumn,
  savePersonalTask,
  taskAttachmentUrl,
} from "@/features/tasks/service";
import { useBusinessAccess } from "@/features/access/BusinessAccess";
import TaskKanban from "@/components/tasks/TaskKanban";
import TaskFiltersDialog from "@/components/tasks/TaskFiltersDialog";
import type { TaskStageRow, TaskAttachment } from "@/integrations/supabase/taskTypes";
import "./TasksPage.css";

export default function TasksPage() {
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
  } = useTasksData();
  const client = useQueryClient();
  const token = access.token;
  useEffect(() => {
    if (scope || access.loading) return;
    const options = access.contexts.filter((c) => c.kind === "tasks");
    const preferred =
      options.find(
        (c) => c.visibility === "personal" && c.board_name === "Minhas tarefas",
      ) ??
      options.find((c) => c.visibility === "personal") ??
      options[0];
    if (preferred) access.select(preferred);
  }, [scope, access]);
  const update = (task: Task) => {
    if (!access.isCurrent(token)) return;
    void client.invalidateQueries({ queryKey: access.key("tasks", "tasks") });
    void client.invalidateQueries({
      queryKey: access.key("tasks", "task-count"),
    });
  };
  return (
    <div className="tasks-theme flex h-full min-h-0 flex-col">
      {!scope && (
        <p className="task-empty" role="status">
          {access.loading
            ? "Validando acesso às tarefas..."
            : access.error ||
              "Nenhum contexto de tarefas autorizado está disponível para esta conta."}
        </p>
      )}
      {scope && (
        <TasksWorkspace
          key={`${user?.id}:${scope.board_id}`}
          tasks={tasks.data ?? []}
          catalog={catalog.data ?? emptyCatalog}
          userId={user?.id}
          admin={scope.can_dispatch}
          canManageColumns={scope.can_manage}
          workspaceId={workspace?.id}
          loading={authLoading || tasks.isLoading || catalog.isLoading}
          error={contextError || (tasks.error || catalog.error)?.message}
          onRetry={() => {
            retryContext();
            void tasks.refetch();
            void catalog.refetch();
          }}
          canPersist={Boolean(
            scope.can_write &&
              user &&
              catalog.data &&
              !authLoading &&
              !contextError,
          )}
          onSave={async (v, key, previous) => {
            update(await savePersonalTask(scope.board_id, key, v, previous));
          }}
          onMove={async (t, s) => {
            update(await moveTask(scope.board_id, t, s));
          }}
          onDelete={async (t, request) => {
            const key = access.key("tasks", "tasks");
            await client.cancelQueries({ queryKey: key });
            await removeTask(scope.board_id, t, request);
            if (access.isCurrent(token)) {
              client.setQueryData<Task[]>(key, (old) =>
                old?.filter((row) => row.id !== t.id),
              );
              update(t);
            }
          }}
          onRestore={async (t, request) => {
            const key = access.key("tasks", "tasks");
            await client.cancelQueries({ queryKey: key });
            const restored = await restoreTask(scope.board_id, t.id, request);
            if (access.isCurrent(token)) {
              client.setQueryData<Task[]>(key, (old) => [
                ...(old ?? []).filter((row) => row.id !== t.id),
                { ...restored, can_edit: true },
              ]);
              update(t);
            }
          }}
          onColumn={async (id, name, create) => {
            try {
              const saved = await saveTaskColumn(scope, id, name, create);
              if (access.isCurrent(token))
                await client.invalidateQueries({
                  queryKey: access.key("tasks", "task-catalog"),
                });
              return saved;
            } finally {
              if (access.isCurrent(token)) access.retry();
            }
          }}
          onRemoveColumn={async (id, destination) => {
            try {
              const saved = await removeTaskColumn(scope, catalog.data?.stages ?? [], id, destination);
              if (access.isCurrent(token)) {
                client.setQueryData<TaskCatalog>([...access.key("tasks", "task-catalog"), "personal"],
                  (current) => current ? { ...current, stages: saved } : current);
              }
            } finally {
              if (access.isCurrent(token)) {
                await Promise.allSettled([
                  client.invalidateQueries({ queryKey: access.key("tasks", "task-catalog") }),
                  client.invalidateQueries({ queryKey: access.key("tasks", "tasks") }),
                  client.invalidateQueries({ queryKey: access.key("tasks", "task-count") }),
                  access.retry(),
                ]);
              }
            }
          }}
        />
      )}
    </div>
  );
}
export function TaskBadge({ children }: { children: React.ReactNode }) {
  return <span className="task-badge">{children}</span>;
}
export function TaskAttachments({
  workspaceId,
  taskId,
  draftId,
  onRemove,
}: {
  workspaceId?: string;
  taskId?: string;
  draftId?: string;
  onRemove?: (file: TaskAttachment) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const access = useBusinessAccess();
  const query = useQuery({
    queryKey: [
      ...access.key("tasks", "task-attachments"),
      workspaceId,
      taskId,
      draftId,
    ],
    queryFn: ({ signal }) =>
      listTaskAttachments(workspaceId!, taskId, draftId, signal),
    refetchInterval: 15000,
    enabled: Boolean(workspaceId && (taskId || draftId)),
    retry: false,
  });
  return (
    <div className="task-files">
      <h3>Anexos</h3>
      {query.isLoading && workspaceId ? (
        <p className="task-help">Carregando anexos...</p>
      ) : query.isError ? (
        <button
          type="button"
          className="task-link"
          onClick={() => void query.refetch()}
        >
          Não foi possível carregar. Tentar novamente
        </button>
      ) : !query.data?.length ? (
        <p className="task-help">Nenhum anexo vinculado.</p>
      ) : (
        query.data.map((a) => (
          <div key={a.id}>
          <button
            key={a.id}
            type="button"
            className="task-attachment"
            disabled={Boolean(busy)}
            onClick={async () => {
              setBusy(a.id);
              setError("");
              try {
                const url = await taskAttachmentUrl(a);
                const link = document.createElement("a");
                link.href = url;
                link.download = a.name;
                link.rel = "noopener";
                link.click();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            <span>{a.name}</span>
            <small>
              {a.mime_type} · {Math.ceil(a.size_bytes / 1024)} KB
              {busy === a.id ? " · abrindo..." : ""}
            </small>
          </button>
          {onRemove && !a.task_id && <button type="button" className="task-link" aria-label={`Remover anexo ${a.name}`} disabled={Boolean(busy)} onClick={async()=>{
            setBusy(a.id);setError('');
            try{await onRemove(a);await query.refetch();}catch(e){setError((e as Error).message);}finally{setBusy('');}
          }}>Remover anexo</button>}
          </div>
        ))
      )}
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function TasksWorkspace({
  tasks,
  catalog,
  userId,
  workspaceId,
  admin = false,
  loading = false,
  error,
  canPersist = false,
  onRetry,
  onSave,
  onMove,
  onDelete,
  onRestore,
  onColumn,
  onRemoveColumn,
  canManageColumns = false,
}: {
  tasks: Task[];
  catalog: TaskCatalog;
  userId?: string;
  workspaceId?: string;
  admin?: boolean;
  loading?: boolean;
  error?: string;
  canPersist?: boolean;
  onRetry?: () => void;
  onSave?: (v: TaskValues, key: string, previous?: Task) => Promise<void>;
  onMove?: (t: Task, stage: string) => Promise<void>;
  onDelete?: (t: Task, request: string) => Promise<void>;
  onRestore?: (t: Task, request: string) => Promise<void>;
  onColumn?: (
    id: string,
    name: string,
    create: boolean,
  ) => Promise<TaskStageRow | void>;
  onRemoveColumn?: (id: string, destination: string) => Promise<void>;
  canManageColumns?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState("kanban");
  const [filters, setFilters] = useState<TaskFilters>(defaultTaskFilters);
  const [editor, setEditor] = useState<{
    task?: Task;
    stage: string;
    trigger?: HTMLElement | null;
  } | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<{ task: Task; request: string }[]>([]);
  const [failedRemoval, setFailedRemoval] = useState<Task | null>(null);
  const requests = useRef(new Map<string, string>());
  const [trashOver, setTrashOver] = useState(false),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const inFlight = useRef(false);
  const [operationError, setOperationError] = useState("");
  const [dragging, setDragging] = useState("");
  const stages = catalog.stages;
  const formCatalog = { ...catalog, stages };
  const liveTasks = tasks.filter((t) => !t.deleted_at && !hiddenIds.has(t.id));
  const selected = selectTasks(liveTasks, filters, catalog, userId);
  const columns = stages.filter(
    (s) => !s.archived || selected.some((t) => t.stage_id === s.id),
  );
  const first = stages.find((s) => !s.archived)?.id ?? "todo";
  const completion = stages.find((s) => s.base_status === "done")?.id;
  const reopen = stages.find(
    (s) => !s.archived && !["done", "canceled"].includes(s.base_status),
  )?.id;
  const open = (
    task: Task | undefined,
    stage = first,
    trigger?: HTMLElement,
  ) => {
    setOperationError("");
    setEditor({ task, stage, trigger });
  };
  const close = () => {
    setEditor(null);
    if (params.has("task")) {
      const next = new URLSearchParams(params);
      next.delete("task");
      setParams(next, { replace: true });
    }
  };
  const directId = params.get("task");
  useEffect(() => {
    const task = tasks.find((t) => t.id === directId);
    if (task)
      setEditor((current) =>
        current?.task?.id === task.id
          ? current
          : { task, stage: task.stage_id },
      );
  }, [directId, tasks]);
  const changeStage = async (t: Task, stage: string) => {
    if (
      inFlight.current ||
      t.stage_id === stage ||
      !canPersist ||
      !canEdit(t, userId, admin)
    )
      return;
    inFlight.current = true;
    setBusy(t.id);
    setOperationError("");
    try {
      await onMove?.(t, stage);
    } catch (e) {
      setOperationError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy("");
      setDragging("");
    }
  };
  const remove = async (task: Task) => {
    if (
      inFlight.current ||
      !onDelete ||
      !canPersist ||
      !canEdit(task, userId, admin)
    )
      return;
    inFlight.current = true;
    setBusy(task.id);
    setDragging("");
    setTrashOver(false);
    setOperationError("");
    setFailedRemoval(null);
    const request = requests.current.get(task.id) ?? crypto.randomUUID();
    requests.current.set(task.id, request);
    setHiddenIds((ids) => new Set(ids).add(task.id));
    try {
      await onDelete(task, request);
      setRemoved((items) => [
        ...items.filter((i) => i.task.id !== task.id),
        { task, request },
      ]);
    } catch (e) {
      setHiddenIds((ids) => {
        const next = new Set(ids);
        next.delete(task.id);
        return next;
      });
      setOperationError((e as Error).message);
      setFailedRemoval(task);
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  };
  const undo = async (item: { task: Task; request: string }) => {
    if (inFlight.current || !onRestore) return;
    inFlight.current = true;
    setBusy(item.task.id);
    setOperationError("");
    try {
      await onRestore(item.task, item.request);
      setHiddenIds((ids) => {
        const next = new Set(ids);
        next.delete(item.task.id);
        return next;
      });
      setRemoved((items) => items.filter((i) => i !== item));
      requests.current.delete(item.task.id);
    } catch (e) {
      setOperationError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  };
  const stageName = (t: Task) =>
    stages.find((s) => s.id === t.stage_id)?.name ?? "Etapa preservada";
  const card = (t: Task) => (
    <article
      key={t.id}
      className="task-card"
      draggable={canPersist && canEdit(t, userId, admin) && !busy}
      onDragStart={(e) => {
        if (inFlight.current) {
          e.preventDefault();
          return;
        }
        e.dataTransfer?.setData("application/x-kortex-task", t.id);
        setDragging(t.id);
      }}
      onDragEnd={() => {
        setDragging("");
        setTrashOver(false);
      }}
      aria-busy={busy === t.id}
    >
      <div className="task-card-badges">
        <TaskBadge>{priorityLabels[t.priority]}</TaskBadge>
        {t.project && <TaskBadge>{t.project}</TaskBadge>}
      </div>
      <button
        className="task-card-title"
        onClick={(e) => open(t, t.stage_id, e.currentTarget)}
      >
        {t.title}
      </button>
      {(t.company_id || t.operational_code) && (
        <p className="task-card-context">
          {[
            catalog.companies.find((c) => c.id === t.company_id)?.name,
            t.operational_code,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <p className="task-card-description">
        {t.description || "Sem descrição"}
      </p>
      <div className={`task-card-meta ${overdue(t) ? "task-overdue" : ""}`}>
        <span>
          <CalendarDays size={15} />
          {formatTaskDate(t.due_date)}
        </span>
        <span title={personLabel(t.assigned_to, catalog.people, userId)}>
          {personLabel(t.assigned_to, catalog.people, userId)}
        </span>
      </div>
      <footer>
        {canPersist && canEdit(t, userId, admin) && (
          <button
            aria-label={`Remover tarefa ${t.title}`}
            disabled={Boolean(busy)}
            onClick={() => void remove(t)}
          >
            <Trash2 size={16} />
          </button>
        )}
        <button
          aria-label={`${canEdit(t, userId, admin) ? "Editar" : "Consultar"} tarefa ${t.title}`}
          onClick={(e) => open(t, t.stage_id, e.currentTarget)}
        >
          <Pencil size={16} />
        </button>
      </footer>
    </article>
  );
  const apply = (key: keyof TaskFilters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  return (
    <div className="tasks-theme tasks-workspace">
      <h1 className="sr-only">Tarefas</h1>
      <header className="tasks-header">
        <div className="tasks-toolbar">
          <div className="tasks-search">
            <Search size={17} />
            <input
              aria-label="Buscar tarefas"
              placeholder="Buscar tarefas..."
              value={filters.query}
              onChange={(e) => apply("query", e.target.value)}
            />
          </div>
          <button
            className={`task-button task-trash ${dragging ? "task-trash-active" : ""} ${trashOver ? "task-trash-over" : ""}`}
            aria-label="Lixeira de tarefas"
            title={
              trashOver
                ? "Solte para remover"
                : "Arraste uma tarefa para remover"
            }
            onClick={() =>
              setNotice(
                "Arraste uma tarefa até a lixeira ou use Remover tarefa no card.",
              )
            }
            onDragOver={(e) => {
              if (dragging && canPersist && !busy) {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                setTrashOver(true);
              }
            }}
            onDragLeave={() => setTrashOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const task = liveTasks.find((t) => t.id === dragging);
              if (task) void remove(task);
              setDragging("");
              setTrashOver(false);
            }}
          >
            <Trash2 size={18} />
            <span className="sr-only" aria-live="polite">
              {trashOver ? "Solte para remover" : ""}
            </span>
          </button>
          <TaskFiltersDialog
            filters={filters}
            stages={stages}
            onApply={(draft) =>
              setFilters((current) => ({ ...current, ...draft }))
            }
          />
          <button
            className="task-button task-cyan task-new"
            onClick={(e) => open(undefined, first, e.currentTarget)}
          >
            <Plus size={17} />
            Nova tarefa
          </button>
        </div>
        <div className="tasks-view-row">
          <div role="tablist" aria-label="Visualizações de tarefas">
            {[
              ["kanban", "Kanban", Grid2X2],
              ["list", "Lista", List],
              ["timeline", "Timeline", Clock3],
              ["checklist", "Checklist", CheckSquare],
            ].map(([id, label, Icon]) => (
              <button
                key={String(id)}
                role="tab"
                tabIndex={view === id ? 0 : -1}
                aria-selected={view === id}
                onKeyDown={(event) => {
                  const tabs = Array.from(
                    event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]',
                    ),
                  );
                  const index = tabs.indexOf(event.currentTarget);
                  let next = index;
                  if (event.key === "ArrowRight")
                    next = (index + 1) % tabs.length;
                  else if (event.key === "ArrowLeft")
                    next = (index + tabs.length - 1) % tabs.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = tabs.length - 1;
                  else return;
                  event.preventDefault();
                  tabs[next].click();
                  tabs[next].focus();
                }}
                onClick={() => setView(String(id))}
              >
                <Icon size={17} />
                {String(label)}
              </button>
            ))}
          </div>
        </div>
      </header>
      {operationError && (
        <p className="task-error task-banner" role="alert">
          {operationError}
        </p>
      )}
      {loading ? (
        <div className="task-empty">
          <Loader2 className="animate-spin" size={24} />
          Carregando tarefas...
        </div>
      ) : error ? (
        <div className="task-empty">
          <p role="alert">{error}</p>
          <button className="task-button" onClick={onRetry}>
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          {directId && !tasks.some((t) => t.id === directId) && (
            <p className="task-help task-banner">
              Esta tarefa não está disponível no seu contexto.
            </p>
          )}
          {view === "kanban" ? (
            <>
              {!selected.length && (
                <p className="task-board-empty" role="status">
                  {liveTasks.length
                    ? "Nenhuma tarefa corresponde à busca ou aos filtros."
                    : "Nenhuma tarefa disponível."}
                </p>
              )}
              <TaskKanban
                columns={columns}
                tasks={selected}
                dragging={dragging}
                canManage={canManageColumns}
                renderCard={card}
                onNew={(stage, trigger) => open(undefined, stage, trigger)}
                onMove={(task, stage) => void changeStage(task, stage)}
                onColumn={onColumn}
                onRemoveColumn={onRemoveColumn && (async (id, destination) => {
                  if (inFlight.current || !canManageColumns || !onRemoveColumn)
                    throw new Error("Aguarde a operação atual antes de remover a coluna.");
                  inFlight.current = true;
                  setBusy(`column:${id}`);
                  setDragging("");
                  try {
                    await onRemoveColumn(id, destination);
                    setFilters((current) => current.stage === id ? { ...current, stage: "" } : current);
                  } finally {
                    inFlight.current = false;
                    setBusy("");
                  }
                })}
              />
            </>
          ) : !selected.length ? (
            <div className="task-empty">
              <CheckSquare size={28} />
              <p>
                {tasks.length
                  ? "Nenhuma tarefa corresponde à busca ou aos filtros."
                  : "Nenhuma tarefa disponível."}
              </p>
              <button
                className="task-button"
                onClick={() => setFilters(defaultTaskFilters)}
              >
                Limpar busca e filtros
              </button>
            </div>
          ) : view === "list" ? (
            <div className="task-table-scroll">
              <table className="task-table">
                <thead>
                  <tr>
                    {[
                      "Tarefa e contexto",
                      "Responsável",
                      "Etapa",
                      "Prioridade",
                      "Vencimento",
                      "Ações",
                    ].map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selected.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <button
                          className="task-list-title"
                          onClick={(e) => open(t, t.stage_id, e.currentTarget)}
                        >
                          {t.title}
                        </button>
                        <small>
                          {[
                            catalog.companies.find((c) => c.id === t.company_id)
                              ?.name,
                            t.operational_code,
                            t.operator,
                            t.project,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Tarefa sem contexto corporativo"}
                        </small>
                      </td>
                      <td>
                        {personLabel(t.assigned_to, catalog.people, userId)}
                      </td>
                      <td>
                        <TaskBadge>{stageName(t)}</TaskBadge>
                      </td>
                      <td>
                        <TaskBadge>{priorityLabels[t.priority]}</TaskBadge>
                      </td>
                      <td className={overdue(t) ? "task-overdue" : ""}>
                        {formatTaskDate(t.due_date)}
                      </td>
                      <td>
                        <button
                          aria-label={`Editar tarefa ${t.title}`}
                          onClick={(e) => open(t, t.stage_id, e.currentTarget)}
                        >
                          <Pencil size={16} />
                        </button>
                        {canPersist && canEdit(t, userId, admin) && (
                          <button
                            aria-label={`Remover tarefa ${t.title}`}
                            onClick={() => void remove(t)}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : view === "timeline" ? (
            <div className="task-timeline">
              {Array.from(
                new Set(selected.map((t) => dateKey(t.due_date) || "9999")),
              )
                .sort()
                .map((day) => (
                  <section key={day}>
                    <h2>
                      <CalendarDays size={17} />
                      {day === "9999" ? "Sem vencimento" : formatTaskDate(day)}
                    </h2>
                    <div>
                      {selected
                        .filter((t) => (dateKey(t.due_date) || "9999") === day)
                        .map(card)}
                    </div>
                  </section>
                ))}
            </div>
          ) : (
            <div className="task-checklist">
              {selected.map((t) => (
                <label key={t.id}>
                  <input
                    type="checkbox"
                    checked={t.status === "done"}
                    disabled={
                      !canPersist ||
                      !canEdit(t, userId, admin) ||
                      t.status === "canceled" ||
                      Boolean(busy) ||
                      !completion ||
                      !reopen
                    }
                    onChange={(e) =>
                      void changeStage(
                        t,
                        e.target.checked ? completion! : reopen!,
                      )
                    }
                  />
                  <span>
                    <strong>{t.title}</strong>
                    <small>
                      {stageName(t)} · {priorityLabels[t.priority]} ·{" "}
                      {formatTaskDate(t.due_date)} ·{" "}
                      {personLabel(t.assigned_to, catalog.people, userId)}
                    </small>
                  </span>
                  <button
                    type="button"
                    aria-label={`Editar tarefa ${t.title}`}
                    onClick={(e) => {
                      e.preventDefault();
                      open(t, t.stage_id, e.currentTarget);
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                </label>
              ))}
            </div>
          )}
          <footer className="tasks-count">
            {selected.length} de {liveTasks.length} tarefas autorizadas
          </footer>
        </>
      )}
      {editor && (
        <TaskFormDialog
          initial={taskValues(editor.task, editor.stage)}
          catalog={formCatalog}
          title={editor.task ? "Detalhes da tarefa" : "Nova tarefa"}
          submitLabel={editor.task ? "Salvar alterações" : "Criar tarefa"}
          returnFocus={editor.trigger}
          onClose={close}
          disabledReason={
            !canPersist
              ? "Entre na sua conta para salvar a tarefa."
              : editor.task && !canEdit(editor.task, userId, admin)
                ? "Você pode consultar esta tarefa; a edição depende de atribuição ou permissão administrativa."
                : undefined
          }
          onSave={async (v, key) => {
            await onSave?.(v, key, editor.task);
          }}
        >
          {editor.task && (
            <TaskAttachments
              workspaceId={workspaceId}
              taskId={editor.task.id}
            />
          )}
        </TaskFormDialog>
      )}
      {notice && (
        <p className="task-help" role="status">
          {notice}
        </p>
      )}
      {failedRemoval && (
        <div className="task-help">
          <button
            className="task-link"
            disabled={Boolean(busy)}
            onClick={() => void remove(failedRemoval)}
          >
            Tentar remoção novamente
          </button>
        </div>
      )}
      {removed.map((item) => (
        <div className="task-undo" role="status" key={item.task.id}>
          <span>Tarefa removida · {item.task.title}</span>
          <button
            className="task-link"
            disabled={Boolean(busy) || !onRestore}
            onClick={() => void undo(item)}
          >
            Desfazer
          </button>
        </div>
      ))}
    </div>
  );
}
