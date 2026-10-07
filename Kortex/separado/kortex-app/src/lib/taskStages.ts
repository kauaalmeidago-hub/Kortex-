export type TaskStageColor = "blue" | "yellow" | "green" | "emerald" | "red" | "purple" | "slate";

export interface TaskStage {
  id: string;
  name: string;
  color: TaskStageColor;
}

export const TASK_STAGE_STORAGE_KEY = "kortex.taskStages";
export const TASK_STAGE_EVENT = "kortex-task-stages-updated";

export const DEFAULT_TASK_STAGES: TaskStage[] = [
  { id: "todo", name: "A fazer", color: "blue" },
  { id: "in_progress", name: "Em andamento", color: "yellow" },
  { id: "review", name: "Em revisão", color: "blue" },
  { id: "done", name: "Concluídas", color: "emerald" },
];

export const TASK_STAGE_COLORS: Record<
  TaskStageColor,
  { label: string; dot: string; soft: string; border: string; text: string }
> = {
  blue: {
    label: "Azul",
    dot: "bg-blue-500",
    soft: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
  },
  yellow: {
    label: "Amarelo",
    dot: "bg-amber-400",
    soft: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
  },
  green: {
    label: "Verde",
    dot: "bg-green-500",
    soft: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
  },
  emerald: {
    label: "Verde Kortex",
    dot: "bg-emerald-500",
    soft: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
  },
  red: {
    label: "Vermelho",
    dot: "bg-red-500",
    soft: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
  },
  purple: {
    label: "Roxo",
    dot: "bg-violet-500",
    soft: "bg-violet-50",
    border: "border-violet-200",
    text: "text-violet-700",
  },
  slate: {
    label: "Cinza",
    dot: "bg-slate-400",
    soft: "bg-slate-50",
    border: "border-slate-200",
    text: "text-slate-700",
  },
};

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function cloneDefaultStages() {
  return DEFAULT_TASK_STAGES.map(stage => ({ ...stage }));
}

function sanitizeStages(value: unknown): TaskStage[] {
  if (!Array.isArray(value)) return cloneDefaultStages();

  const seen = new Set<string>();
  const stages = value.reduce<TaskStage[]>((acc, item) => {
    if (!item || typeof item !== "object") return acc;

    const stage = item as Partial<TaskStage>;
    const id = typeof stage.id === "string" ? stage.id.trim() : "";
    const name = typeof stage.name === "string" ? stage.name.trim() : "";
    const color = stage.color && TASK_STAGE_COLORS[stage.color] ? stage.color : "blue";

    if (!id || !name || seen.has(id)) return acc;

    seen.add(id);
    acc.push({ id, name, color });
    return acc;
  }, []);

  return stages.length ? stages : cloneDefaultStages();
}

export function getStoredTaskStages(): TaskStage[] {
  if (!canUseStorage()) return cloneDefaultStages();

  const raw = window.localStorage.getItem(TASK_STAGE_STORAGE_KEY);
  if (!raw) return cloneDefaultStages();

  try {
    return sanitizeStages(JSON.parse(raw));
  } catch {
    return cloneDefaultStages();
  }
}

export function saveTaskStages(stages: TaskStage[]) {
  const sanitized = sanitizeStages(stages);

  if (canUseStorage()) {
    window.localStorage.setItem(TASK_STAGE_STORAGE_KEY, JSON.stringify(sanitized));
    window.dispatchEvent(new CustomEvent(TASK_STAGE_EVENT, { detail: sanitized }));
  }

  return sanitized;
}

export function resetTaskStages() {
  return saveTaskStages(cloneDefaultStages());
}

export function subscribeTaskStages(listener: (stages: TaskStage[]) => void) {
  if (typeof window === "undefined") return () => undefined;

  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<TaskStage[]>).detail;
    listener(sanitizeStages(detail));
  };

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== TASK_STAGE_STORAGE_KEY) return;
    listener(getStoredTaskStages());
  };

  window.addEventListener(TASK_STAGE_EVENT, handleCustomEvent);
  window.addEventListener("storage", handleStorageEvent);

  return () => {
    window.removeEventListener(TASK_STAGE_EVENT, handleCustomEvent);
    window.removeEventListener("storage", handleStorageEvent);
  };
}
