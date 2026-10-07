import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  GripVertical,
  MoreVertical,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SettingsLayout from "@/components/SettingsLayout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TASK_STAGE_COLORS,
  TaskStage,
  TaskStageColor,
  getStoredTaskStages,
  resetTaskStages,
  saveTaskStages,
} from "@/lib/taskStages";
import { cn } from "@/lib/utils";

const colorOptions = Object.entries(TASK_STAGE_COLORS) as Array<
  [TaskStageColor, (typeof TASK_STAGE_COLORS)[TaskStageColor]]
>;

function cloneStages(stages: TaskStage[]) {
  return stages.map(stage => ({ ...stage }));
}

function createStageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `custom_${crypto.randomUUID()}`;
  }

  return `custom_${Date.now()}`;
}

export default function TaskStagesSettingsPage() {
  const navigate = useNavigate();
  const [savedStages, setSavedStages] = useState<TaskStage[]>(() => getStoredTaskStages());
  const [draftStages, setDraftStages] = useState<TaskStage[]>(() => getStoredTaskStages());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  const isDirty = useMemo(
    () => JSON.stringify(savedStages) !== JSON.stringify(draftStages),
    [draftStages, savedStages],
  );

  const updateStage = (stageId: string, nextStage: Partial<TaskStage>) => {
    setDraftStages(current =>
      current.map(stage => (stage.id === stageId ? { ...stage, ...nextStage } : stage)),
    );
    setFeedback("");
  };

  const addStage = () => {
    const id = createStageId();
    setDraftStages(current => [...current, { id, name: "Nova etapa", color: "blue" }]);
    setEditingId(id);
    setFeedback("");
  };

  const removeStage = (stageId: string) => {
    setDraftStages(current => (current.length > 1 ? current.filter(stage => stage.id !== stageId) : current));
    setFeedback("");
  };

  const moveStage = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;

    setDraftStages(current => {
      const fromIndex = current.findIndex(stage => stage.id === draggingId);
      const toIndex = current.findIndex(stage => stage.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return current;

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setFeedback("");
  };

  const saveChanges = () => {
    const saved = saveTaskStages(draftStages);
    setSavedStages(cloneStages(saved));
    setDraftStages(cloneStages(saved));
    setEditingId(null);
    setFeedback("Alterações salvas.");
  };

  const cancelChanges = () => {
    setDraftStages(cloneStages(savedStages));
    setEditingId(null);
    setFeedback("Alterações descartadas.");
  };

  const restoreDefault = () => {
    const restored = resetTaskStages();
    setSavedStages(cloneStages(restored));
    setDraftStages(cloneStages(restored));
    setEditingId(null);
    setFeedback("Padrão restaurado.");
  };

  return (
    <SettingsLayout>
    <div className="h-full overflow-auto bg-background px-4 py-4 text-foreground scrollbar-thin sm:px-5 sm:py-5">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#64748b]">
              <button
                type="button"
                onClick={() => navigate("/settings")}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[#1d4ed8] transition hover:bg-blue-50"
              >
                <ArrowLeft size={16} />
                Configurações
              </button>
              <span>/</span>
              <span>Área de trabalho</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-[#06122a]">Etapas das tarefas</h1>
            <p className="mt-2 text-base text-[#64748b]">Organize as etapas utilizadas no quadro de tarefas.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="border-[#bfd1ea] bg-white text-[#0f3f96] hover:bg-blue-50"
            onClick={() => navigate("/tasks")}
          >
            Ver Board
          </Button>
        </div>

        <section className="rounded-2xl border border-[#d7e3f4] bg-white p-6 shadow-[0_18px_60px_rgba(15,63,150,0.08)]">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#08152f]">Colunas atuais</h2>
              <p className="mt-1 text-sm text-[#6b7c98]">Arraste os cards para definir a ordem do Board.</p>
            </div>
            <Button
              type="button"
              onClick={addStage}
              className="bg-[#0866ff] text-white shadow-[0_10px_24px_rgba(8,102,255,0.2)] hover:bg-[#0057de]"
            >
              <Plus size={16} />
              Adicionar etapa
            </Button>
          </div>

          <div className="flex flex-wrap gap-3">
            {draftStages.map(stage => {
              const color = TASK_STAGE_COLORS[stage.color];
              const isEditing = editingId === stage.id;

              return (
                <div
                  key={stage.id}
                  draggable
                  onDragStart={() => setDraggingId(stage.id)}
                  onDragEnd={() => setDraggingId(null)}
                  onDragOver={event => event.preventDefault()}
                  onDrop={() => moveStage(stage.id)}
                  className={cn(
                    "group flex min-h-[54px] min-w-[250px] flex-1 items-center gap-3 rounded-xl border bg-white px-3.5 py-3 shadow-sm transition",
                    color.border,
                    draggingId === stage.id && "scale-[0.98] opacity-60",
                  )}
                >
                  <GripVertical className="h-5 w-5 shrink-0 cursor-grab text-[#90a4c4]" />
                  <span className={cn("h-3 w-3 shrink-0 rounded-full", color.dot)} />

                  {isEditing ? (
                    <Input
                      autoFocus
                      value={stage.name}
                      onChange={event => updateStage(stage.id, { name: event.target.value })}
                      onBlur={() => {
                        if (!stage.name.trim()) updateStage(stage.id, { name: "Nova etapa" });
                        setEditingId(null);
                      }}
                      onKeyDown={event => {
                        if (event.key === "Enter") setEditingId(null);
                        if (event.key === "Escape") {
                          setDraftStages(cloneStages(savedStages));
                          setEditingId(null);
                        }
                      }}
                      className="h-9 border-[#c7d7ee] bg-white text-sm font-semibold text-[#06122a] focus-visible:ring-[#0866ff]"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#13233f]">{stage.name}</span>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-[#64748b] transition hover:bg-[#f1f6ff] hover:text-[#0f3f96]"
                        aria-label={`Opções da etapa ${stage.name}`}
                      >
                        <MoreVertical size={17} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => setEditingId(stage.id)}>Renomear</DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Alterar cor</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-40">
                          {colorOptions.map(([colorKey, option]) => (
                            <DropdownMenuItem key={colorKey} onClick={() => updateStage(stage.id, { color: colorKey })}>
                              <span className={cn("mr-2 h-2.5 w-2.5 rounded-full", option.dot)} />
                              {option.label}
                              {stage.color === colorKey && <Check className="ml-auto h-4 w-4" />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => removeStage(stage.id)}
                        disabled={draftStages.length <= 1}
                        className="text-red-600 focus:text-red-700"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#d7e3f4] bg-white px-5 py-4 shadow-sm">
          <div className="text-sm font-medium text-[#64748b]">
            {feedback || (isDirty ? "Existem alterações não salvas." : "Configuração sincronizada com o Board.")}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={restoreDefault}
              className="text-[#0f3f96] hover:bg-blue-50 hover:text-[#0b3a8f]"
            >
              <RotateCcw size={16} />
              Restaurar padrão
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={cancelChanges}
              disabled={!isDirty}
              className="border-[#c7d7ee] bg-white text-[#41516c]"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={saveChanges}
              disabled={!isDirty}
              className="bg-[#0866ff] text-white hover:bg-[#0057de]"
            >
              <Save size={16} />
              Salvar alterações
            </Button>
          </div>
        </div>
      </div>
    </div>
    </SettingsLayout>
  );
}
