import { useState } from "react";
import { Filter, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TaskField } from "./TaskFormDialog";
import { priorityLabels, type TaskFilters } from "@/features/tasks/model";
import type { TaskStageRow } from "@/integrations/supabase/taskTypes";

export default function TaskFiltersDialog({
  filters,
  stages,
  onApply,
}: {
  filters: TaskFilters;
  stages: TaskStageRow[];
  onApply: (draft: Pick<TaskFilters, "stage" | "priority" | "date">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    stage: filters.stage,
    priority: filters.priority,
    date: filters.date,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value)
          setDraft({
            stage: filters.stage,
            priority: filters.priority,
            date: filters.date,
          });
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <button className="task-button">
          <Filter size={16} />
          Filtros
          {(filters.stage || filters.priority || filters.date) && (
            <span className="task-filter-dot" />
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="tasks-theme task-filters-modal">
        <header>
          <DialogTitle>Filtrar tarefas</DialogTitle>
          <DialogClose asChild>
            <button aria-label="Fechar filtros">
              <X size={20} />
            </button>
          </DialogClose>
        </header>
        <DialogDescription className="sr-only">
          Combine etapa, prioridade e vencimento. As alterações são aplicadas ao
          confirmar.
        </DialogDescription>
        <div className="task-filters-body">
          <TaskField label="Etapa">
            <select
              autoFocus
              aria-label="Etapa"
              value={draft.stage}
              onChange={(e) =>
                setDraft((v) => ({ ...v, stage: e.target.value }))
              }
            >
              <option value="">Todas as etapas</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </TaskField>
          <TaskField label="Prioridade">
            <select
              aria-label="Prioridade"
              value={draft.priority}
              onChange={(e) =>
                setDraft((v) => ({ ...v, priority: e.target.value }))
              }
            >
              <option value="">Todas as prioridades</option>
              {Object.entries(priorityLabels).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </TaskField>
          <TaskField label="Vencimento">
            <select
              aria-label="Vencimento"
              value={draft.date}
              onChange={(e) =>
                setDraft((v) => ({ ...v, date: e.target.value }))
              }
            >
              <option value="">Qualquer período</option>
              <option value="overdue">Atrasadas</option>
              <option value="today">Hoje</option>
              <option value="upcoming">Próximos 7 dias</option>
              <option value="none">Sem vencimento</option>
            </select>
          </TaskField>
        </div>
        <footer className="task-actions">
          <button
            className="task-button"
            onClick={() => setDraft({ stage: "", priority: "", date: "" })}
          >
            Limpar filtros
          </button>
          <button
            className="task-button task-cyan"
            onClick={() => {
              onApply(draft);
              setOpen(false);
            }}
          >
            Aplicar filtros
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
