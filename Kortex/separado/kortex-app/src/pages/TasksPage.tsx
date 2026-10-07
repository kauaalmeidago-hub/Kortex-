import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  Clock3,
  Filter,
  Grid2X2,
  List,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];
type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];
type TaskStatus = Database["public"]["Enums"]["task_status"];
type TaskPriority = Database["public"]["Enums"]["task_priority"];
type ViewId = "kanban" | "list" | "timeline" | "checklist";
type StatusFilter = "all" | TaskStatus | "overdue";
type DateFilter = "all" | "overdue" | "today" | "upcoming" | "none";
type SortKey = "created_desc" | "due_asc" | "priority_desc" | "title_asc";

type TaskFormState = {
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
};

const statusLabels: Record<TaskStatus, string> = {
  todo: "A fazer",
  in_progress: "Em andamento",
  done: "Concluído",
  canceled: "Cancelado",
};

const statusStyles: Record<TaskStatus, { dot: string; pill: string; border: string }> = {
  todo: {
    dot: "bg-slate-500",
    pill: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    border: "border-slate-300 dark:border-slate-700",
  },
  in_progress: {
    dot: "bg-blue-500",
    pill: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200",
    border: "border-blue-300 dark:border-blue-900",
  },
  done: {
    dot: "bg-emerald-500",
    pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200",
    border: "border-emerald-300 dark:border-emerald-900",
  },
  canceled: {
    dot: "bg-red-500",
    pill: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200",
    border: "border-red-300 dark:border-red-900",
  },
};

const priorityLabels: Record<TaskPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};

const priorityStyles: Record<TaskPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200",
  high: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200",
};

const viewItems: Array<{ id: ViewId; label: string; icon: typeof Grid2X2 }> = [
  { id: "kanban", label: "Kanban / Board", icon: Grid2X2 },
  { id: "list", label: "Lista", icon: List },
  { id: "timeline", label: "Timeline", icon: Clock3 },
  { id: "checklist", label: "Checklist", icon: CheckSquare },
];

const emptyForm: TaskFormState = {
  title: "",
  description: "",
  assignedTo: "",
  dueDate: "",
  priority: "medium",
  status: "todo",
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function toDateKey(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function isOverdue(task: TaskRow) {
  const due = toDateKey(task.due_date);
  return Boolean(due && due < todayKey() && task.status !== "done" && task.status !== "canceled");
}

function isToday(task: TaskRow) {
  return toDateKey(task.due_date) === todayKey();
}

function isUpcoming(task: TaskRow) {
  const due = toDateKey(task.due_date);
  return Boolean(due && due >= todayKey() && task.status !== "done" && task.status !== "canceled");
}

function formatDate(value: string | null) {
  const dateKey = toDateKey(value);
  if (!dateKey) return "Sem vencimento";

  const date = new Date(`${dateKey}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function assignedLabel(task: TaskRow, currentUserEmail?: string | null, currentUserId?: string | null) {
  if (!task.assigned_to) return "Sem responsável";
  if (currentUserId && task.assigned_to === currentUserId) return currentUserEmail || "Você";
  return task.assigned_to.slice(0, 8);
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getFormFromTask(task: TaskRow): TaskFormState {
  return {
    title: task.title,
    description: task.description || "",
    assignedTo: task.assigned_to || "",
    dueDate: toDateKey(task.due_date),
    priority: task.priority,
    status: task.status,
  };
}

function localTaskFromForm(form: TaskFormState, existing?: TaskRow | null, createdBy?: string | null): TaskRow {
  const now = new Date().toISOString();
  return {
    id: existing?.id || crypto.randomUUID(),
    workspace_id: existing?.workspace_id || "frontend-workspace",
    created_by: existing?.created_by || createdBy || null,
    created_at: existing?.created_at || now,
    updated_at: now,
    title: form.title.trim(),
    description: form.description.trim() || null,
    assigned_to: form.assignedTo.trim() || null,
    due_date: form.dueDate || null,
    priority: form.priority,
    status: form.status,
    completed_at: form.status === "done" ? existing?.completed_at || now : null,
    contact_id: existing?.contact_id || null,
    lead_id: existing?.lead_id || null,
  };
}

function EmptyState({
  title,
  description,
  onCreate,
  canCreate,
  actionLabel,
}: {
  title: string;
  description: string;
  onCreate: () => void;
  canCreate: boolean;
  actionLabel?: string;
}) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <CheckSquare className="h-6 w-6" />
      </div>
      <p className="mt-4 text-sm font-bold text-foreground">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
        {actionLabel || "Nova tarefa"}
      </button>
    </div>
  );
}

function TaskPill({ status }: { status: TaskStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", statusStyles[status].pill)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", statusStyles[status].dot)} />
      {statusLabels[status]}
    </span>
  );
}

function PriorityPill({ priority }: { priority: TaskPriority }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", priorityStyles[priority])}>
      {priorityLabels[priority]}
    </span>
  );
}

function ToolbarButton({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-foreground hover:border-primary/50 hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

export default function TasksPage() {
  const { user, workspace } = useAuth();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [activeView, setActiveView] = useState<ViewId>("kanban");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | TaskPriority>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created_desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null);
  const [form, setForm] = useState<TaskFormState>(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoadError("");
    setOperationError("");

    if (!workspace?.id) {
      setTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false });

    if (error) {
      setLoadError(error.message);
      setTasks([]);
    } else {
      setTasks(data || []);
    }

    setLoading(false);
  }, [workspace?.id]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const filteredTasks = useMemo(() => {
    const term = normalize(searchTerm.trim());

    const filtered = tasks.filter((task) => {
      const matchesSearch = !term
        || normalize(task.title).includes(term)
        || normalize(task.description || "").includes(term)
        || normalize(task.assigned_to || "").includes(term);
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "overdue" ? isOverdue(task) : task.status === statusFilter);
      const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
      const matchesDate = dateFilter === "all"
        || (dateFilter === "overdue" && isOverdue(task))
        || (dateFilter === "today" && isToday(task))
        || (dateFilter === "upcoming" && isUpcoming(task))
        || (dateFilter === "none" && !task.due_date);

      return matchesSearch && matchesStatus && matchesPriority && matchesDate;
    });

    return [...filtered].sort((a, b) => {
      if (sortKey === "title_asc") return a.title.localeCompare(b.title, "pt-BR");
      if (sortKey === "priority_desc") {
        const weight: Record<TaskPriority, number> = { high: 3, medium: 2, low: 1 };
        return weight[b.priority] - weight[a.priority] || a.title.localeCompare(b.title, "pt-BR");
      }
      if (sortKey === "due_asc") {
        const aDate = toDateKey(a.due_date) || "9999-12-31";
        const bDate = toDateKey(b.due_date) || "9999-12-31";
        return aDate.localeCompare(bDate) || a.title.localeCompare(b.title, "pt-BR");
      }
      return b.created_at.localeCompare(a.created_at);
    });
  }, [dateFilter, priorityFilter, searchTerm, sortKey, statusFilter, tasks]);

  const hasActiveFilters = Boolean(searchTerm || statusFilter !== "all" || priorityFilter !== "all" || dateFilter !== "all");

  const clearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setDateFilter("all");
  };

  const openNewTask = (status: TaskStatus = "todo") => {
    setEditingTask(null);
    setForm({ ...emptyForm, status });
    setFormErrors({});
    setOperationError("");
    setModalOpen(true);
  };

  const openTask = (task: TaskRow) => {
    setEditingTask(task);
    setForm(getFormFromTask(task));
    setFormErrors({});
    setOperationError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingTask(null);
    setForm(emptyForm);
    setFormErrors({});
  };

  const resetModal = () => {
    setModalOpen(false);
    setEditingTask(null);
    setForm(emptyForm);
    setFormErrors({});
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.title.trim()) nextErrors.title = "Informe o título da tarefa.";
    if (form.assignedTo.trim() && form.assignedTo.trim().length < 8) {
      nextErrors.assignedTo = "Use um identificador de responsável válido ou deixe em branco.";
    }
    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOperationError("");

    if (!validateForm()) return;
    setSaving(true);

    if (!workspace?.id) {
      const localTask = localTaskFromForm(form, editingTask, user?.id || null);
      setTasks((current) => {
        if (editingTask) return current.map((task) => (task.id === localTask.id ? localTask : task));
        return [localTask, ...current];
      });
      resetModal();
      setSaving(false);
      return;
    }

    const payload: TaskInsert | TaskUpdate = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      assigned_to: form.assignedTo.trim() || null,
      due_date: form.dueDate || null,
      priority: form.priority,
      status: form.status,
      completed_at: form.status === "done" ? new Date().toISOString() : null,
      workspace_id: workspace.id,
      updated_at: new Date().toISOString(),
    };

    if (editingTask) {
      const { data, error } = await supabase
        .from("tasks")
        .update(payload)
        .eq("id", editingTask.id)
        .select("*")
        .single();

      if (error) {
        setOperationError(error.message);
      } else if (data) {
        setTasks((current) => current.map((task) => (task.id === data.id ? data : task)));
        resetModal();
      }
    } else {
      const insertPayload: TaskInsert = {
        ...(payload as TaskInsert),
        workspace_id: workspace.id,
        created_by: user?.id || null,
      };
      const { data, error } = await supabase
        .from("tasks")
        .insert(insertPayload)
        .select("*")
        .single();

      if (error) {
        setOperationError(error.message);
      } else if (data) {
        setTasks((current) => [data, ...current]);
        resetModal();
      }
    }

    setSaving(false);
  };

  const updateTaskStatus = async (task: TaskRow, nextStatus: TaskStatus) => {
    if (!workspace?.id) {
      const completedAt = nextStatus === "done" ? new Date().toISOString() : null;
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? { ...item, status: nextStatus, completed_at: completedAt, updated_at: new Date().toISOString() }
            : item,
        ),
      );
      return true;
    }

    const previousTasks = tasks;
    const completedAt = nextStatus === "done" ? new Date().toISOString() : null;
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? { ...item, status: nextStatus, completed_at: completedAt, updated_at: new Date().toISOString() }
          : item,
      ),
    );

    const { error } = await supabase
      .from("tasks")
      .update({ status: nextStatus, completed_at: completedAt, updated_at: new Date().toISOString() })
      .eq("id", task.id);

    if (error) {
      setTasks(previousTasks);
      setOperationError(error.message);
      return false;
    }

    return true;
  };

  const deleteTask = async () => {
    if (!editingTask) return;
    setSaving(true);
    setOperationError("");

    if (!workspace?.id) {
      setTasks((current) => current.filter((task) => task.id !== editingTask.id));
      resetModal();
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("tasks").delete().eq("id", editingTask.id);
    if (error) {
      setOperationError(error.message);
    } else {
      setTasks((current) => current.filter((task) => task.id !== editingTask.id));
      resetModal();
    }

    setSaving(false);
  };

  const handleDropOnStatus = async (status: TaskStatus) => {
    if (!draggingTaskId) return;
    const task = tasks.find((item) => item.id === draggingTaskId);
    setDraggingTaskId(null);
    if (!task || task.status === status) return;
    await updateTaskStatus(task, status);
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Carregando tarefas...
        </div>
      );
    }

    if (loadError) {
      return (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Não foi possível carregar tarefas: {loadError}
        </div>
      );
    }

    if (!tasks.length) {
      return (
        <EmptyState
          title="Nenhuma tarefa encontrada"
          description="Crie uma tarefa para começar a preencher Kanban, Lista, Timeline e Checklist."
          onCreate={() => openNewTask()}
          canCreate
        />
      );
    }

    if (!filteredTasks.length) {
      return (
        <EmptyState
          title="Nenhuma tarefa corresponde aos filtros"
          description="Ajuste busca, status, prioridade ou data para visualizar tarefas reais existentes."
          onCreate={clearFilters}
          canCreate
          actionLabel="Limpar filtros"
        />
      );
    }

    if (activeView === "list") return <ListView tasks={filteredTasks} openTask={openTask} updateTaskStatus={updateTaskStatus} user={user} />;
    if (activeView === "timeline") return <TimelineView tasks={filteredTasks} openTask={openTask} user={user} />;
    if (activeView === "checklist") return <ChecklistView tasks={filteredTasks} updateTaskStatus={updateTaskStatus} openTask={openTask} />;
    return <KanbanView tasks={filteredTasks} openTask={openTask} openNewTask={openNewTask} updateTaskStatus={updateTaskStatus} draggingTaskId={draggingTaskId} setDraggingTaskId={setDraggingTaskId} onDrop={handleDropOnStatus} user={user} />;
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="shrink-0 border-b border-border bg-card px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative min-w-[220px] flex-1 xl:max-w-[520px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar tarefas..."
                className="h-10 w-full rounded-xl border border-input bg-background pl-10 pr-10 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <ToolbarButton onClick={() => setFiltersOpen((current) => !current)} active={filtersOpen || hasActiveFilters}>
              <Filter className="h-4 w-4" />
              Filtros
            </ToolbarButton>

            <label className="relative hidden sm:block">
              <span className="sr-only">Ordenar tarefas</span>
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className="h-10 appearance-none rounded-xl border border-border bg-card px-3 pr-9 text-sm font-semibold text-foreground outline-none transition hover:border-primary/50 focus:border-primary focus:ring-4 focus:ring-primary/10"
              >
                <option value="created_desc">Recentes</option>
                <option value="due_asc">Vencimento</option>
                <option value="priority_desc">Prioridade</option>
                <option value="title_asc">Nome</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </label>
          </div>

          <button
            type="button"
            onClick={() => openNewTask()}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_24px_rgba(13,110,253,0.18)] transition hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Nova tarefa
          </button>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
          {viewItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition",
                  active
                    ? "bg-accent text-accent-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>

        {filtersOpen && (
          <div className="mt-3 grid gap-2 rounded-2xl border border-border bg-background p-3 md:grid-cols-4">
            <FilterSelect label="Etapa" value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)}>
              <option value="all">Todas</option>
              <option value="todo">A fazer</option>
              <option value="in_progress">Em andamento</option>
              <option value="done">Concluídas</option>
              <option value="canceled">Canceladas</option>
              <option value="overdue">Atrasadas</option>
            </FilterSelect>
            <FilterSelect label="Prioridade" value={priorityFilter} onChange={(value) => setPriorityFilter(value as "all" | TaskPriority)}>
              <option value="all">Todas</option>
              <option value="high">Alta</option>
              <option value="medium">Média</option>
              <option value="low">Baixa</option>
            </FilterSelect>
            <FilterSelect label="Data" value={dateFilter} onChange={(value) => setDateFilter(value as DateFilter)}>
              <option value="all">Todas</option>
              <option value="overdue">Atrasadas</option>
              <option value="today">Hoje</option>
              <option value="upcoming">Próximas</option>
              <option value="none">Sem vencimento</option>
            </FilterSelect>
            <div className="flex items-end">
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary"
              >
                <RotateCcw className="h-4 w-4" />
                Limpar
              </button>
            </div>
          </div>
        )}

        {operationError && (
          <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {operationError}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 scrollbar-thin sm:p-4">
        {renderBody()}
      </div>

      {modalOpen && (
        <TaskModal
          form={form}
          setForm={setForm}
          editingTask={editingTask}
          formErrors={formErrors}
          operationError={operationError}
          saving={saving}
          currentUserId={user?.id || ""}
          currentUserEmail={user?.email || ""}
          onSubmit={handleSubmitTask}
          onClose={closeModal}
          onDelete={deleteTask}
        />
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5 text-xs font-bold text-muted-foreground">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
      >
        {children}
      </select>
    </label>
  );
}

function TaskCard({
  task,
  openTask,
  updateTaskStatus,
  draggable,
  onDragStart,
  onDragEnd,
  user,
}: {
  task: TaskRow;
  openTask: (task: TaskRow) => void;
  updateTaskStatus: (task: TaskRow, status: TaskStatus) => Promise<boolean>;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  user: { id: string; email?: string } | null;
}) {
  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="group rounded-xl border border-border bg-card p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <button type="button" onClick={() => openTask(task)} className="block w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn("line-clamp-2 text-sm font-bold leading-5 text-foreground", task.status === "done" && "text-muted-foreground line-through")}>
              {task.title}
            </p>
            {task.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.description}</p>}
          </div>
          {isOverdue(task) && (
            <span className="shrink-0 rounded-full bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700 dark:bg-red-950/60 dark:text-red-200">
              Atrasada
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TaskPill status={task.status} />
          <PriorityPill priority={task.priority} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(task.due_date)}
          </span>
          <span className="truncate">
            {assignedLabel(task, user?.email, user?.id)}
          </span>
        </div>
      </button>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
        <select
          value={task.status}
          onChange={(event) => void updateTaskStatus(task, event.target.value as TaskStatus)}
          className="h-8 rounded-lg border border-input bg-background px-2 text-xs font-semibold text-foreground outline-none"
          aria-label={`Alterar etapa de ${task.title}`}
        >
          <option value="todo">A fazer</option>
          <option value="in_progress">Em andamento</option>
          <option value="done">Concluído</option>
          <option value="canceled">Cancelado</option>
        </select>
        <button
          type="button"
          onClick={() => openTask(task)}
          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
          aria-label={`Editar ${task.title}`}
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function KanbanView({
  tasks,
  openTask,
  openNewTask,
  updateTaskStatus,
  draggingTaskId,
  setDraggingTaskId,
  onDrop,
  user,
}: {
  tasks: TaskRow[];
  openTask: (task: TaskRow) => void;
  openNewTask: (status?: TaskStatus) => void;
  updateTaskStatus: (task: TaskRow, status: TaskStatus) => Promise<boolean>;
  draggingTaskId: string | null;
  setDraggingTaskId: (id: string | null) => void;
  onDrop: (status: TaskStatus) => Promise<void>;
  user: { id: string; email?: string } | null;
}) {
  const columns: Array<{ id: TaskStatus; title: string; tasks: TaskRow[] }> = (Object.keys(statusLabels) as TaskStatus[]).map((status) => ({
    id: status,
    title: statusLabels[status],
    tasks: tasks.filter((task) => task.status === status),
  }));

  return (
    <div className="flex min-h-[calc(100vh-220px)] gap-3 overflow-x-auto pb-2 scrollbar-thin">
      {columns.map((column) => (
        <section
          key={column.id}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => void onDrop(column.id)}
          className={cn(
            "flex min-w-[282px] max-w-[320px] flex-1 flex-col rounded-2xl border bg-muted/35",
            statusStyles[column.id].border,
            draggingTaskId && "ring-1 ring-primary/20",
          )}
        >
          <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", statusStyles[column.id].dot)} />
              <h2 className="truncate text-sm font-black text-foreground">{column.title}</h2>
              <span className="rounded-full bg-background px-2 py-0.5 text-xs font-bold text-muted-foreground">{column.tasks.length}</span>
            </div>
            <button
              type="button"
              onClick={() => openNewTask(column.id)}
              className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
              aria-label={`Adicionar tarefa em ${column.title}`}
            >
              <Plus className="h-4 w-4" />
            </button>
          </header>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 scrollbar-thin">
            {column.tasks.length ? (
              column.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  openTask={openTask}
                  updateTaskStatus={updateTaskStatus}
                  draggable
                  onDragStart={() => setDraggingTaskId(task.id)}
                  onDragEnd={() => setDraggingTaskId(null)}
                  user={user}
                />
              ))
            ) : (
              <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-dashed border-border bg-card px-3 text-center text-sm text-muted-foreground">
                Nenhuma tarefa nesta etapa.
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function ListView({
  tasks,
  openTask,
  updateTaskStatus,
  user,
}: {
  tasks: TaskRow[];
  openTask: (task: TaskRow) => void;
  updateTaskStatus: (task: TaskRow, status: TaskStatus) => Promise<boolean>;
  user: { id: string; email?: string } | null;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-muted/60 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Tarefa</th>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3">Responsável</th>
              <th className="px-4 py-3">Vencimento</th>
              <th className="px-4 py-3">Prioridade</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tasks.map((task) => (
              <tr key={task.id} className="transition hover:bg-muted/35">
                <td className="px-4 py-3">
                  <button type="button" onClick={() => openTask(task)} className="text-left">
                    <p className={cn("font-bold text-foreground", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</p>
                    {task.description && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{task.description}</p>}
                  </button>
                </td>
                <td className="px-4 py-3"><TaskPill status={task.status} /></td>
                <td className="px-4 py-3 text-muted-foreground">{assignedLabel(task, user?.email, user?.id)}</td>
                <td className={cn("px-4 py-3 text-muted-foreground", isOverdue(task) && "font-bold text-destructive")}>{formatDate(task.due_date)}</td>
                <td className="px-4 py-3"><PriorityPill priority={task.priority} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void updateTaskStatus(task, task.status === "done" ? "todo" : "done")}
                      className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                      aria-label={task.status === "done" ? "Reabrir tarefa" : "Concluir tarefa"}
                    >
                      <CheckSquare className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openTask(task)}
                      className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                      aria-label={`Editar ${task.title}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TimelineView({
  tasks,
  openTask,
  user,
}: {
  tasks: TaskRow[];
  openTask: (task: TaskRow) => void;
  user: { id: string; email?: string } | null;
}) {
  const grouped = tasks.reduce<Record<string, TaskRow[]>>((acc, task) => {
    const key = toDateKey(task.due_date) || "sem-data";
    acc[key] = [...(acc[key] || []), task];
    return acc;
  }, {});
  const keys = Object.keys(grouped).sort((a, b) => (a === "sem-data" ? 1 : b === "sem-data" ? -1 : a.localeCompare(b)));

  return (
    <div className="grid gap-3">
      {keys.map((key) => (
        <section key={key} className="rounded-2xl border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-black text-foreground">{key === "sem-data" ? "Sem data de vencimento" : formatDate(key)}</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{grouped[key].length} tarefas</span>
          </header>
          <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {grouped[key].map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => openTask(task)}
                className={cn(
                  "rounded-xl border bg-background p-3 text-left transition hover:border-primary/50",
                  isOverdue(task) ? "border-destructive/40" : "border-border",
                )}
              >
                <p className="text-sm font-bold text-foreground">{task.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{assignedLabel(task, user?.email, user?.id)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <TaskPill status={task.status} />
                  <PriorityPill priority={task.priority} />
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ChecklistView({
  tasks,
  updateTaskStatus,
  openTask,
}: {
  tasks: TaskRow[];
  updateTaskStatus: (task: TaskRow, status: TaskStatus) => Promise<boolean>;
  openTask: (task: TaskRow) => void;
}) {
  const done = tasks.filter((task) => task.status === "done").length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <span className="text-sm font-bold text-foreground">{done} de {tasks.length} concluídas</span>
        <div className="h-2 min-w-[180px] flex-1 rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-sm font-bold text-muted-foreground">{progress}%</span>
      </div>

      <div className="divide-y divide-border rounded-xl border border-border">
        {tasks.map((task) => (
          <div key={task.id} className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
            <label className="flex min-w-0 flex-1 items-center gap-3">
              <input
                type="checkbox"
                checked={task.status === "done"}
                onChange={(event) => void updateTaskStatus(task, event.target.checked ? "done" : "todo")}
                className="h-5 w-5 rounded border-input accent-blue-600"
              />
              <button type="button" onClick={() => openTask(task)} className="min-w-0 text-left">
                <p className={cn("truncate text-sm font-bold text-foreground", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(task.due_date)}</p>
              </button>
            </label>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <TaskPill status={task.status} />
              <PriorityPill priority={task.priority} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskModal({
  form,
  setForm,
  editingTask,
  formErrors,
  operationError,
  saving,
  currentUserId,
  currentUserEmail,
  onSubmit,
  onClose,
  onDelete,
}: {
  form: TaskFormState;
  setForm: (form: TaskFormState) => void;
  editingTask: TaskRow | null;
  formErrors: Record<string, string>;
  operationError: string;
  saving: boolean;
  currentUserId: string;
  currentUserEmail: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm">
      <div className="flex max-h-[calc(100dvh-24px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-black">{editingTask ? "Editar tarefa" : "Nova tarefa"}</h2>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground" aria-label="Fechar modal">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="min-h-0 overflow-y-auto scrollbar-thin">
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <ModalField label="Título da tarefa" error={formErrors.title}>
                <input
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  placeholder="Informe o título"
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </ModalField>
              <ModalField label="Descrição">
                <textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="Adicione detalhes da tarefa..."
                  className="min-h-[152px] w-full resize-y rounded-xl border border-input bg-background px-3 py-3 text-sm text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                  maxLength={500}
                />
                <div className="text-right text-xs text-muted-foreground">{form.description.length}/500</div>
              </ModalField>
            </div>

            <div className="grid gap-4 content-start">
              <ModalField label="Responsável" error={formErrors.assignedTo}>
                <select
                  value={form.assignedTo}
                  onChange={(event) => setForm({ ...form, assignedTo: event.target.value })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                >
                  <option value="">Sem responsável</option>
                  {currentUserId && <option value={currentUserId}>{currentUserEmail || "Você"}</option>}
                </select>
              </ModalField>
              <ModalField label="Data de vencimento">
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </ModalField>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <ModalField label="Prioridade">
                  <select
                    value={form.priority}
                    onChange={(event) => setForm({ ...form, priority: event.target.value as TaskPriority })}
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                  >
                    <option value="low">Baixa</option>
                    <option value="medium">Média</option>
                    <option value="high">Alta</option>
                  </select>
                </ModalField>
                <ModalField label="Etapa">
                  <select
                    value={form.status}
                    onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                  >
                    <option value="todo">A fazer</option>
                    <option value="in_progress">Em andamento</option>
                    <option value="done">Concluído</option>
                    <option value="canceled">Cancelado</option>
                  </select>
                </ModalField>
              </div>
            </div>
          </div>

          {operationError && (
            <div className="mx-4 mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {operationError}
            </div>
          )}

          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3">
            <div>
              {editingTask && (
                <button
                  type="button"
                  onClick={() => void onDelete()}
                  disabled={saving}
                  className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="h-10 rounded-xl border border-border px-4 text-sm font-bold text-foreground transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {editingTask ? "Salvar tarefa" : "Criar tarefa"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2 text-sm font-bold text-foreground">
      <span>{label}</span>
      {children}
      {error && <span className="flex items-center gap-1 text-xs font-semibold text-destructive"><AlertCircle className="h-3.5 w-3.5" />{error}</span>}
    </label>
  );
}
