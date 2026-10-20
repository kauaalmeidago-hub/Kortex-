import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreVertical, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TaskField } from "@/components/tasks/TaskFormDialog";
import type { Task, TaskCatalog } from "@/features/tasks/model";
import type { TaskStageRow } from "@/integrations/supabase/taskTypes";

export default function TaskKanban({
  columns,
  tasks,
  dragging,
  canManage,
  renderCard,
  onNew,
  onMove,
  onColumn,
  onRemoveColumn,
}: {
  columns: TaskCatalog["stages"];
  tasks: Task[];
  dragging: string;
  canManage: boolean;
  renderCard: (task: Task) => ReactNode;
  onNew: (stage: string, trigger: HTMLElement) => void;
  onMove: (task: Task, stage: string) => void;
  onColumn?: (
    id: string,
    name: string,
    create: boolean,
  ) => Promise<TaskStageRow | void>;
  onRemoveColumn?: (id: string, destination: string) => Promise<void>;
}) {
  const board = useRef<HTMLDivElement>(null),
    add = useRef<HTMLElement>(null),
    input = useRef<HTMLInputElement>(null);
  const pan = useRef<{
    x: number;
    y: number;
    scroll: number;
    atEnd: boolean;
    horizontal: boolean;
  } | null>(null);
  const armed = useRef(false),
    operation = useRef(false),
    request = useRef<string | null>(null),
    editing = useRef(false);
  const [showAdd, setShowAdd] = useState(false),
    [edit, setEdit] = useState<string | null>(null),
    [name, setName] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [hint, setHint] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [removalError, setRemovalError] = useState("");
  const removalTrigger = useRef<HTMLElement | null>(null);
  const removalColumn = columns.find((column) => column.id === removing);
  const destinations = columns.filter((column) => !column.archived && column.id !== removing);
  const startEdit = (id: string, title: string) => {
    if (!canManage || operation.current) return;
    editing.current = true;
    setName(title);
    setEdit(id);
    setError("");
  };
  useEffect(() => {
    if (edit) {
      input.current?.focus();
      input.current?.select();
    }
  }, [edit, columns]);
  useEffect(() => {
    if (showAdd) {
      add.current?.scrollIntoView?.({
        block: "nearest",
        inline: "end",
        behavior: "smooth",
      });
    }
  }, [showAdd]);
  const collapse = () => {
    setShowAdd(false);
    armed.current = false;
    setHint("");
  };
  const rename = async () => {
    if (!editing.current || operation.current || !edit) return;
    const value = name.trim(),
      column = columns.find((c) => c.id === edit);
    if (!value) {
      setError("Informe um nome para a coluna.");
      return;
    }
    editing.current = false;
    if (value === column?.name) {
      setEdit(null);
      return;
    }
    operation.current = true;
    setBusy(true);
    try {
      await onColumn?.(edit, value, false);
      setEdit(null);
    } catch (e) {
      setEdit(null);
      setError((e as Error).message);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="task-kanban-shell">
      {canManage && (
        <div className="task-board-tools">
          <span aria-live="polite">{hint}</span>
          <button
            className="task-link"
            disabled={busy || columns.length >= 30}
            onClick={() => {
              setShowAdd(true);
              setError("");
            }}
          >
            <Plus size={15} />
            Adicionar coluna
          </button>
        </div>
      )}
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
      <div
        ref={board}
        className="task-board"
        role="region"
        tabIndex={-1}
        aria-label="Quadro de tarefas"
        onKeyDown={(e) => {
          if (e.key === "Escape") collapse();
        }}
        onPointerDown={(e) => {
          if (
            dragging ||
            e.button !== 0 ||
            (e.target as HTMLElement).closest(
              "article,button,input,select,summary,a",
            )
          )
            return;
          pan.current = {
            x: e.clientX,
            y: e.clientY,
            scroll: e.currentTarget.scrollLeft,
            atEnd:
              e.currentTarget.scrollLeft >=
              e.currentTarget.scrollWidth - e.currentTarget.clientWidth - 4,
            horizontal: false,
          };
        }}
        onPointerMove={(e) => {
          const p = pan.current;
          if (!p || dragging) return;
          const dx = p.x - e.clientX,
            dy = p.y - e.clientY;
          if (
            !p.horizontal &&
            Math.abs(dx) > 10 &&
            Math.abs(dx) > Math.abs(dy) * 1.3
          ) {
            p.horizontal = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }
          if (p.horizontal) {
            e.preventDefault();
            e.currentTarget.scrollLeft = p.scroll + dx;
          }
        }}
        onPointerUp={(e) => {
          const p = pan.current;
          pan.current = null;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          if (
            !p ||
            !p.horizontal ||
            p.x - e.clientX < 60 ||
            dragging ||
            !canManage
          )
            return;
          const end =
            e.currentTarget.scrollLeft >=
            e.currentTarget.scrollWidth - e.currentTarget.clientWidth - 4;
          if (!end) return;
          if (armed.current && p.atEnd) {
            setShowAdd(true);
            setHint("");
          } else {
            armed.current = true;
            setHint("Arraste novamente para revelar a inclusão de coluna.");
          }
        }}
        onPointerCancel={() => {
          pan.current = null;
          armed.current = false;
        }}
        onPointerLeave={() => {
          if (!pan.current && !operation.current) collapse();
        }}
        onBlur={(e) => {
          if (
            showAdd &&
            !e.currentTarget.contains(e.relatedTarget as Node) &&
            !operation.current
          )
            collapse();
        }}
      >
        {columns.map((s) => (
          <section
            key={s.id}
            className="task-column"
            aria-label={`Coluna ${s.name}`}
            onDragOver={(e) => {
              if (dragging && !s.archived) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const task = tasks.find((t) => t.id === dragging);
              if (task && !s.archived) onMove(task, s.id);
            }}
          >
            <header>
              <h2>
                {edit === s.id ? (
                  <input
                    ref={input}
                    aria-label="Nome da coluna"
                    value={name}
                    maxLength={80}
                    disabled={busy}
                    onChange={(e) => setName(e.target.value)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={() => void rename()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void rename();
                      }
                      if (e.key === "Escape") {
                        editing.current = false;
                        setEdit(null);
                        setError("");
                      }
                    }}
                  />
                ) : (
                  <button
                    className="task-column-title"
                    disabled={!canManage}
                    aria-label={`Renomear coluna ${s.name}`}
                    title={
                      canManage
                        ? "Dois cliques para renomear; Enter ou F2 para editar"
                        : s.name
                    }
                    onDoubleClick={() => startEdit(s.id, s.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "F2") {
                        e.preventDefault();
                        startEdit(s.id, s.name);
                      }
                    }}
                  >
                    {s.name}
                  </button>
                )}
                <span>{tasks.filter((t) => t.stage_id === s.id).length}</span>
              </h2>
              <details className="task-column-menu" onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.currentTarget.removeAttribute("open");
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}>
                <summary aria-label={`Opções da etapa ${s.name}`}>
                  <MoreVertical size={17} />
                </summary>
                <div>
                  <button onClick={(e) => onNew(s.id, e.currentTarget)}>
                    Criar nesta etapa
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={(e) => {
                          e.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                          startEdit(s.id, s.name);
                        }}
                      >
                        Renomear coluna
                      </button>
                      <button
                        className="task-column-remove"
                        disabled={busy || !onRemoveColumn || !columns.some(column => column.id !== s.id && !column.archived)}
                        title={!columns.some(column => column.id !== s.id && !column.archived) ? "Mantenha pelo menos uma coluna ativa no quadro." : undefined}
                        onClick={(event) => {
                          const menu = event.currentTarget.closest("details");
                          removalTrigger.current = menu?.querySelector("summary") ?? null;
                          menu?.removeAttribute("open");
                          setDestination("");
                          setRemovalError("");
                          setRemoving(s.id);
                        }}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        Remover coluna
                      </button>
                    </>
                  )}
                </div>
              </details>
            </header>
            <div className="task-column-cards">
              {tasks.filter((t) => t.stage_id === s.id).map(renderCard)}
            </div>
            <button
              className="task-add-column"
              aria-label={`Nova tarefa na etapa ${s.name}`}
              onClick={(e) => onNew(s.id, e.currentTarget)}
            >
              <Plus size={18} />
              Nova tarefa
            </button>
          </section>
        ))}
        {showAdd && canManage && (
          <section
            ref={add}
            className="task-column task-column-placeholder"
            aria-label="Inclusão temporária de coluna"
          >
            <button
              aria-label="Criar coluna"
              disabled={busy}
              onClick={async () => {
                if (operation.current) return;
                operation.current = true;
                setBusy(true);
                setError("");
                const id = (request.current ??= crypto.randomUUID());
                try {
                  const saved = await onColumn?.(id, "Nova etapa", true);
                  request.current = null;
                  collapse();
                  editing.current = true;
                  setName(saved ? saved.name : "Nova etapa");
                  setEdit(saved ? saved.id : id);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  operation.current = false;
                  setBusy(false);
                }
              }}
            >
              <Plus size={28} />
              <span className="sr-only">
                {busy ? "Salvando coluna..." : "Adicionar nova etapa"}
              </span>
            </button>
          </section>
        )}
      </div>
      <Dialog open={Boolean(removing)} onOpenChange={(open) => { if (!open && !busy) setRemoving(null); }}>
        <DialogContent className="tasks-theme sm:max-w-md" onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (removalTrigger.current?.isConnected) removalTrigger.current.focus();
          else board.current?.focus();
        }}>
          <DialogTitle>Remover coluna</DialogTitle>
          <DialogDescription>
            {removalColumn ? `Remover “${removalColumn.name}” deste quadro?` : "Esta coluna não está mais disponível."}
            {" "}Todas as tarefas desta coluna, inclusive fora da busca ou dos filtros, serão transferidas para o destino escolhido. As tarefas serão preservadas.
          </DialogDescription>
          <form className="space-y-4" onSubmit={async (event) => {
            event.preventDefault();
            if (operation.current || !canManage || !removalColumn || !onRemoveColumn) return;
            if (!destinations.some(column => column.id === destination)) {
              setRemovalError("Selecione uma coluna de destino disponível neste quadro.");
              return;
            }
            operation.current = true;
            setBusy(true);
            setRemovalError("");
            try {
              await onRemoveColumn(removalColumn.id, destination);
              setRemoving(null);
            } catch (error) {
              setRemovalError((error as Error).message);
            } finally {
              operation.current = false;
              setBusy(false);
            }
          }}>
            <TaskField label="Mover tarefas para">
              <select required value={destination} disabled={busy} onChange={event => setDestination(event.target.value)}>
                <option value="">Selecione outra coluna deste quadro</option>
                {destinations.map(column => <option key={column.id} value={column.id}>{column.name}</option>)}
              </select>
            </TaskField>
            {removalError && <p className="task-error" role="alert">{removalError}</p>}
            <div className="task-actions">
              <button type="button" className="task-button" disabled={busy} onClick={() => setRemoving(null)}>Cancelar</button>
              <button type="submit" className="task-button task-column-remove" disabled={busy || !canManage || !removalColumn || !destination || !destinations.some(column => column.id === destination)}>
                <Trash2 size={15} aria-hidden="true" />{busy ? "Removendo..." : "Remover coluna"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
