import type { Database } from "@/integrations/supabase/types";
import type { Company } from "@/features/companies/model";
import type {
  TaskPerson,
  TaskSector,
  TaskSectorMember,
  TaskStageRow,
} from "@/integrations/supabase/taskTypes";

export type Task = Database["public"]["Tables"]["tasks"]["Row"] & {
  can_edit?: boolean;
};
export type Priority = Task["priority"];
export type TaskValues = {
  board_id?: string;
  title: string;
  description: string;
  company_id: string;
  operational_code: string;
  operator: string;
  project: string;
  sector_id: string;
  assigned_to: string;
  due_date: string;
  priority: Priority;
  stage_id: string;
};
export type TaskCatalog = {
  boards?: import("@/integrations/supabase/businessTypes").BusinessContext[];
  companies: Company[];
  people: TaskPerson[];
  sectors: TaskSector[];
  members: TaskSectorMember[];
  stages: TaskStageRow[];
};
export const priorityLabels = { high: "Alta", medium: "Média", low: "Baixa" };
export const emptyCatalog: TaskCatalog = {
  companies: [],
  people: [],
  sectors: [],
  members: [],
  stages: [],
};
export function dateKey(value?: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return todayKey(new Date(value));
}
export function todayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)?.value)
    .join("-");
}
export function formatTaskDate(value?: string | null) {
  const key = dateKey(value);
  if (!key) return "Sem vencimento";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(key + "T12:00:00Z"));
}
export function overdue(task: Task, today = todayKey()) {
  return Boolean(
    task.due_date &&
      !["done", "canceled"].includes(task.status) &&
      dateKey(task.due_date) < today,
  );
}
export function taskValues(
  task?: Partial<TaskValues> | Task | null,
  stage = "todo",
): TaskValues {
  return {
    board_id:
      "board_id" in (task ?? {})
        ? ((task as Task).board_id ?? undefined)
        : undefined,
    title: task?.title ?? "",
    description: task?.description ?? "",
    company_id: task?.company_id ?? "",
    operational_code: task?.operational_code ?? "",
    operator: task?.operator ?? "",
    project: task?.project ?? "",
    sector_id: task?.sector_id ?? "",
    assigned_to: task?.assigned_to ?? "",
    due_date: dateKey(task?.due_date),
    priority: task?.priority ?? "medium",
    stage_id: task?.stage_id ?? stage,
  };
}
export function validateTask(
  v: TaskValues,
  catalog: TaskCatalog,
  admin = false,
): string | null {
  if (!v.title.trim()) return "Informe o título da tarefa.";
  if (v.title.length > 240) return "O título deve ter até 240 caracteres.";
  if (!["high", "medium", "low"].includes(v.priority))
    return "Selecione uma prioridade válida.";
  if (v.description.length > 500)
    return "Revise a descrição: o limite é de 500 caracteres. O conteúdo foi preservado.";
  if (!catalog.stages.some((s) => s.id === v.stage_id))
    return "Selecione uma etapa disponível.";
  if (
    v.due_date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(v.due_date) ||
      Number.isNaN(new Date(v.due_date + "T12:00:00Z").getTime()) ||
      new Date(v.due_date + "T12:00:00Z").toISOString().slice(0, 10) !==
        v.due_date)
  )
    return "Informe uma data de vencimento válida.";
  const company = catalog.companies.find((c) => c.id === v.company_id);
  if (v.company_id && !company)
    return "Selecione uma empresa disponível neste workspace.";
  const companies = company ? [company] : catalog.companies;
  if (
    v.operator &&
    !companies.some(
      (c) =>
        Array.isArray(c.offerings) &&
        c.offerings.some(
          (o) =>
            o &&
            typeof o === "object" &&
            !Array.isArray(o) &&
            o.operator === v.operator,
        ),
    )
  )
    return "A operadora não corresponde ao contexto selecionado. Confira o vínculo.";
  if (v.project && !companies.some((c) => c.project === v.project))
    return "O projeto não corresponde ao contexto selecionado. Confira o vínculo.";
  if (admin) {
    if (
      catalog.boards?.length &&
      !catalog.boards.some(
        (b) =>
          b.board_id === v.board_id &&
          b.sector_id === v.sector_id &&
          b.can_dispatch,
      )
    )
      return "Selecione um quadro de destino autorizado.";
    if (
      catalog.boards?.length &&
      !catalog.stages.some(
        (s) => s.id === v.stage_id && s.board_id === v.board_id,
      )
    )
      return "Selecione uma etapa do quadro de destino.";
    if (!catalog.sectors.some((s) => s.id === v.sector_id && s.active))
      return "Selecione o setor de destino.";
    if (
      v.assigned_to &&
      (!catalog.people.some((p) => p.user_id === v.assigned_to) ||
        !catalog.members.some(
          (m) => m.sector_id === v.sector_id && m.user_id === v.assigned_to,
        ))
    )
      return "O responsável precisa ser um integrante ativo do setor selecionado.";
  }
  return null;
}
export function personLabel(
  id: string | null,
  people: TaskPerson[],
  userId?: string,
) {
  if (!id) return "Sem responsável";
  if (id === userId) return "Você";
  const p = people.find((p) => p.user_id === id);
  return p?.full_name || p?.email || "Integrante indisponível";
}
export function canEdit(task: Task, userId?: string, admin = false) {
  if (typeof task.can_edit === "boolean")
    return Boolean(userId && task.can_edit);
  return Boolean(
    userId &&
      (admin ||
        task.assigned_to === userId ||
        (!task.assigned_to && !task.sector_id && task.created_by === userId)),
  );
}
export type TaskFilters = {
  query: string;
  stage: string;
  priority: string;
  date: string;
  company: string;
  operator: string;
  project: string;
  sector: string;
};
export const defaultTaskFilters: TaskFilters = {
  query: "",
  stage: "",
  priority: "",
  date: "",
  company: "",
  operator: "",
  project: "",
  sector: "",
};
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
export function selectTasks(
  tasks: Task[],
  f: TaskFilters,
  catalog: TaskCatalog,
  userId?: string,
  today = todayKey(),
) {
  const result = tasks.filter((t) => {
    if (t.deleted_at) return false;
    const text = normalize(
      [
        t.title,
        t.description,
        t.operational_code,
        t.operator,
        t.project,
        catalog.companies.find((c) => c.id === t.company_id)?.name,
        personLabel(t.assigned_to, catalog.people, userId),
      ].join(" "),
    );
    return (
      (!f.query || text.includes(normalize(f.query))) &&
      (!f.stage || t.stage_id === f.stage) &&
      (!f.priority || t.priority === f.priority) &&
      (!f.company || t.company_id === f.company) &&
      (!f.operator || t.operator === f.operator) &&
      (!f.project || t.project === f.project) &&
      (!f.sector || t.sector_id === f.sector) &&
      (!f.date ||
        (f.date === "overdue" && overdue(t, today)) ||
        (f.date === "today" && dateKey(t.due_date) === today) ||
        (f.date === "upcoming" &&
          Boolean(
            t.due_date &&
              dateKey(t.due_date) >= today &&
              dateKey(t.due_date) <=
                new Date(
                  new Date(today + "T12:00:00Z").getTime() + 7 * 86400000,
                )
                  .toISOString()
                  .slice(0, 10) &&
              !["done", "canceled"].includes(t.status),
          )) ||
        (f.date === "none" && !t.due_date))
    );
  });
  // Authorization is enforced by the query/RLS. Keep received and sector-queue
  // tasks in this dataset, with one deterministic internal order for every view.
  return result.sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
  );
}
