import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  ClipboardList,
  Check,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskField } from "@/components/tasks/TaskFormDialog";
import { useBusinessAccess } from "@/features/access/BusinessAccess";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
import {
  pipelineColumnCount,
  removePipelineColumn,
  restorePipelineColumn,
  savePipelineColumn,
  type LeadRow,
  type PipelineStage,
} from "./service";
import { pipelinePosition, recordHref, savePipelinePosition } from "./navigation";

const currency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value,
  );
export default function PipelineBoard({
  scope,
  stages,
  leads,
  filtered,
  financial,
  moving,
  onMove,
  onChanged,
  onAddRecord,
  returnTo,
  positionKey,
}: {
  scope: BusinessContext;
  stages: PipelineStage[];
  leads: LeadRow[];
  filtered: LeadRow[];
  financial: boolean;
  moving: string;
  onMove: (id: string, stage: string) => Promise<void>;
  onChanged: () => Promise<void>;
  onAddRecord: (stage: string) => void;
  returnTo?: string;
  positionKey?: string;
}) {
  const access = useBusinessAccess();
  const navigate = useNavigate();
  const board = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const suppressClick = useRef(false);
  const [editing, setEditing] = useState<PipelineStage | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [removing, setRemoving] = useState<{
    stage: PipelineStage;
    request: string;
  } | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [destination, setDestination] = useState("");
  const [undo, setUndo] = useState<{ request: string; name: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState("");
  const [over, setOver] = useState("");
  const [reveal, setReveal] = useState("");
  useLayoutEffect(() => {
    if (board.current && positionKey) {
      const p = pipelinePosition(positionKey);
      board.current.scrollLeft = p.left;
      board.current.scrollTop = p.top;
      board.current.querySelectorAll<HTMLElement>("[data-column-scroll]").forEach(column => {
        column.scrollTop = pipelinePosition(`${positionKey}:column:${column.dataset.columnScroll}`).top;
      });
    }
  }, [positionKey]);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (!reveal || !stages.some((s) => s.id === reveal)) return;
    board.current
      ?.querySelector<HTMLElement>(`[data-stage-id="${reveal}"]`)
      ?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    setReveal("");
  }, [stages, reveal]);
  useEffect(() => {
    if (!removing) return;
    let active = true;
    const token = access.token;
    void pipelineColumnCount(scope, removing.stage.id)
      .then((n) => {
        if (active && access.isCurrent(token)) {
          setCount(n);
          setDestination(
            n > 0
              ? ""
              : (stages.find((s) => s.id !== removing.stage.id)?.id ?? ""),
          );
        }
      })
      .catch((e) => {
        if (active && access.isCurrent(token)) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
    // Count is revalidated by the removal transaction; never use filtered.length.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removing, scope.board_id]);
  const act = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const token = access.token;
    try {
      await operation();
    } catch (e) {
      if (access.isCurrent(token)) {
        setError((e as Error).message);
        await onChanged();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const rename = (stage: PipelineStage) => {
    setEditing(stage);
    setTitle(stage.name);
    setError("");
  };
  const validName = (name: string) => {
    if (!name.trim() || name.trim().length > 80) {
      setError("Informe um título de 1 a 80 caracteres.");
      return false;
    }
    return true;
  };
  const saveTitle = () => {
    if (!editing || !validName(title)) return;
    const token = access.token;
    void act(async () => {
      await savePipelineColumn(scope, editing.id, title);
      if (!access.isCurrent(token)) return;
      setEditing(null);
      setNotice("Título salvo.");
      await onChanged();
    });
  };
  const dragged = leads.find((l) => l.id === dragging);
  return (
    <>
      {(notice || error || busy || moving || undo) && (
        <div className="pipeline-feedback">
          {error && !removing && !creating && (
            <p role="alert" className="task-error">
              {error}
            </p>
          )}
          <p role="status">
            {busy
              ? "Salvando etapa..."
              : moving
                ? "Movendo registro..."
                : notice}
          </p>
          {undo && (
            <button
              className="task-link"
              disabled={busy || Boolean(moving)}
              onClick={() => {
                const token = access.token;
                void act(async () => {
                  await restorePipelineColumn(scope, undo.request);
                  if (!access.isCurrent(token)) return;
                  setUndo(null);
                  setNotice("Etapa restaurada.");
                  await onChanged();
                });
              }}
            >
              <Undo2 size={15} />
              Desfazer remoção de {undo.name}
            </button>
          )}
        </div>
      )}
      <div
        className="pipeline-board"
        ref={board}
        aria-label="Etapas da pipeline"
        tabIndex={0}
        onScroll={(e) => {
          if (positionKey) savePipelinePosition(positionKey, e.currentTarget.scrollLeft, e.currentTarget.scrollTop);
        }}
        onDragOver={(e) => {
          if (!dragging || !board.current) return;
          const r = board.current.getBoundingClientRect();
          if (e.clientX < r.left + 56) board.current.scrollLeft -= 20;
          if (e.clientX > r.right - 56) board.current.scrollLeft += 20;
        }}
      >
        {stages.map((stage) => {
          const rows = filtered.filter((l) => l.stage_id === stage.id);
          const isEditing = editing?.id === stage.id;
          const dropTarget =
            over === stage.id && dragged?.stage_id !== stage.id;
          return (
            <section
              key={stage.id}
              data-stage-id={stage.id}
              className={`pipeline-column${dropTarget ? " pipeline-column--over" : ""}`}
              aria-label={`Etapa ${stage.name}`}
              onDragOver={(e) => {
                if (dragging && !moving && !busy) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOver(stage.id);
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setOver("");
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOver("");
                if (dragging && dragged?.stage_id !== stage.id && !busy)
                  void onMove(dragging, stage.id);
                setDragging("");
              }}
            >
              <header className="pipeline-column-header">
                {isEditing ? (
                  <form
                    className="pipeline-title-editor"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveTitle();
                    }}
                  >
                    <input
                      ref={input}
                      aria-label={`Título de ${stage.name}`}
                      value={title}
                      maxLength={80}
                      disabled={busy}
                      onChange={(e) => setTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape" && !busy) {
                          e.preventDefault();
                          setEditing(null);
                          setError("");
                        }
                      }}
                    />
                    <button aria-label="Salvar título" disabled={busy}>
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancelar edição do título"
                      disabled={busy}
                      onClick={() => {
                        setEditing(null);
                        setError("");
                      }}
                    >
                      <X size={16} />
                    </button>
                    <small>
                      Enter salva · Esc cancela. Sair mantém a edição.
                    </small>
                  </form>
                ) : (
                  <>
                    <h2
                      className="pipeline-stage-title"
                      onDoubleClick={() => {
                        if (scope.can_manage && !busy && !moving) rename(stage);
                      }}
                      title={stage.name}
                    >
                      {stage.name}
                    </h2>
                    <span
                      className="pipeline-stage-count"
                      aria-label={`${rows.length} registros`}
                    >
                      {rows.length}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="pipeline-icon"
                          aria-label={`Ações da etapa ${stage.name}`}
                          disabled={busy || Boolean(moving)}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {scope.can_manage && (
                          <DropdownMenuItem onSelect={() => rename(stage)}>
                            <Pencil size={14} />
                            Renomear
                          </DropdownMenuItem>
                        )}
                        {scope.can_write && (
                          <DropdownMenuItem
                            onSelect={() => onAddRecord(stage.id)}
                          >
                            <Plus size={14} />
                            Adição rápida
                          </DropdownMenuItem>
                        )}
                        {scope.can_manage && (
                          <DropdownMenuItem
                            disabled={stages.length === 1}
                            onSelect={() => {
                              setCount(null);
                              setError("");
                              setDestination(
                                stages.find((s) => s.id !== stage.id)?.id ?? "",
                              );
                              setRemoving({
                                stage,
                                request: crypto.randomUUID(),
                              });
                            }}
                          >
                            <Trash2 size={14} />
                            Remover etapa
                          </DropdownMenuItem>
                        )}
                        {!scope.can_manage && !scope.can_write && (
                          <DropdownMenuItem disabled>
                            Somente leitura
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
                {financial && (
                  <span className="pipeline-stage-total">
                    {currency(
                      rows.reduce((n, l) => n + Number(l.value ?? 0), 0),
                    )}
                  </span>
                )}
              </header>
              {scope.can_write && <button className="pipeline-quick-add" disabled={busy || Boolean(moving)}
                onClick={() => onAddRecord(stage.id)}><Plus size={20} />Adição rápida</button>}
              <div className="pipeline-column-cards" data-column-scroll={stage.id} onScroll={e => {
                if (positionKey) savePipelinePosition(`${positionKey}:column:${stage.id}`, 0, e.currentTarget.scrollTop);
              }}>
                {rows.map((lead) => (
                  <article
                    key={lead.id}
                    className={`pipeline-card${moving === lead.id ? " pipeline-card--moving" : ""}${dragging === lead.id ? " pipeline-card--dragging" : ""}`}
                    onClick={e=>{if(!(e.target as Element).closest('a,button,input,select,[role="menuitem"]')&&!suppressClick.current)navigate(recordHref(lead.id,returnTo));}}
                    draggable={Boolean(
                      lead.can_edit && !moving && !busy && !editing,
                    )}
                    onDragStart={(e) => {
                      setDragging(lead.id);
                      suppressClick.current = true;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", lead.id);
                    }}
                    onDragEnd={() => {
                      setDragging("");
                      setOver("");
                      setTimeout(() => {
                        suppressClick.current = false;
                      }, 0);
                    }}
                    onClickCapture={(e) => {
                      if (suppressClick.current) {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                  >
                    <DropdownMenu><DropdownMenuTrigger asChild><button className="pipeline-icon pipeline-card-menu" aria-label={`Ações de ${lead.title}`} onClick={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()}><MoreHorizontal size={18}/></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link to={recordHref(lead.id,returnTo)}>Abrir ficha</Link></DropdownMenuItem>{lead.can_edit&&stages.filter(s=>s.id!==lead.stage_id).map(s=><DropdownMenuItem key={s.id} disabled={busy||Boolean(moving)} onSelect={()=>void onMove(lead.id,s.id)}>Mover para {s.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
                    <Link
                      className="pipeline-card-title"
                      to={recordHref(lead.id, returnTo)}
                      draggable={false}
                    >
                      {lead.title}
                    </Link>
                    {lead.company && lead.company.name !== lead.title && <p className="pipeline-card-context">{lead.company.name}</p>}
                    {lead.description && (
                      <p className="pipeline-card-context">
                        {lead.description}
                      </p>
                    )}
                    {lead.tags?.some(tag => !["ativo", "pendente", "novo"].includes(tag.trim().toLocaleLowerCase("pt-BR"))) && <div className="pipeline-card-tags">
                      {lead.tags.filter(tag => !["ativo", "pendente", "novo"].includes(tag.trim().toLocaleLowerCase("pt-BR"))).map(tag => <span key={tag}>{tag}</span>)}
                    </div>}
                    <div className="pipeline-card-assignment">
                      <span className="pipeline-assignee-avatar" aria-hidden="true">{lead.assignee?.avatar_url ? <img src={lead.assignee.avatar_url} alt="" /> : (lead.assignee?.full_name || "?").trim().split(/\s+/).slice(0, 2).map(n => n[0]).join("")}</span>
                      <span>{lead.assignee?.full_name || (lead.assigned_to ? "Responsável indisponível" : "Sem responsável")}</span>
                      {lead.task_count !== undefined && <small title="Tarefas visíveis vinculadas ao registro">{lead.task_count ? `${lead.task_count} tarefa${lead.task_count === 1 ? "" : "s"}` : "Sem tarefas"}</small>}
                    </div>
                    <footer>
                      <div className="pipeline-card-meta">
                        {lead.expected_close_date && (
                          <span>
                            <CalendarDays size={13} />
                            {new Intl.DateTimeFormat("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                            }).format(
                              new Date(lead.expected_close_date + "T12:00:00"),
                            )}
                          </span>
                        )}
                        {financial && (
                          <span>{currency(Number(lead.value ?? 0))}</span>
                        )}
                      </div>
                    </footer>
                  </article>
                ))}
                {dropTarget && (
                  <div
                    className="pipeline-drop-placeholder"
                    aria-label={`Soltar em ${stage.name}`}
                  >
                    {dragged?.title}
                  </div>
                )}
                {!rows.length && !dropTarget && (
                  <div className="pipeline-column-empty">
                    <ClipboardList size={40} strokeWidth={1.4} aria-hidden="true" />
                    <p>{filtered.length !== leads.length ? "Nenhum resultado nesta coluna." : "Nenhum item nesta coluna."}</p>
                    <span>{filtered.length !== leads.length ? "Ajuste a busca ou os filtros para ver outros itens." : "Arraste um item para cá ou adicione um novo."}</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
        {scope.can_manage && (
          <button
            className="pipeline-add-stage"
            disabled={busy || Boolean(moving) || stages.length >= 30}
            onClick={() => {
              setCreating(crypto.randomUUID());
              setCreateName("");
              setError("");
            }}
          >
            <span><Plus size={27} /></span>
            Adicionar coluna
          </button>
        )}
      </div>
      {creating && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setCreating(null);
          }}
        >
          <DialogContent className="tasks-theme pipeline-stage-dialog">
            <button
              type="button"
              className="pipeline-stage-close"
              aria-label="Fechar criação de etapa"
              disabled={busy}
              onClick={() => setCreating(null)}
            >
              <X size={17} />
            </button>
            <DialogTitle>Adicionar etapa</DialogTitle>
            <DialogDescription>
              A etapa será criada no final desta pipeline. Até 80 caracteres.
            </DialogDescription>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!validName(createName)) return;
                const token = access.token;
                void act(async () => {
                  await savePipelineColumn(scope, creating, createName, true);
                  if (!access.isCurrent(token)) return;
                  setReveal(creating);
                  setCreating(null);
                  setNotice("Etapa criada.");
                  await onChanged();
                });
              }}
            >
              <TaskField label="Nome da etapa">
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={createName}
                  disabled={busy}
                  onChange={(e) => setCreateName(e.target.value)}
                />
              </TaskField>
              {error && (
                <p role="alert" className="task-error">
                  {error}
                </p>
              )}
              <div className="task-actions">
                <button
                  type="button"
                  className="task-button"
                  disabled={busy}
                  onClick={() => setCreating(null)}
                >
                  Cancelar
                </button>
                <button className="task-button task-cyan" disabled={busy}>
                  {busy ? "Criando..." : "Criar etapa"}
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setRemoving(null);
          }}
        >
          <DialogContent className="tasks-theme pipeline-stage-dialog">
            <button
              type="button"
              className="pipeline-stage-close"
              aria-label="Fechar remoção de etapa"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              <X size={17} />
            </button>
            <DialogTitle>Remover {removing.stage.name}</DialogTitle>
            <DialogDescription>
              {count === null
                ? "Conferindo os registros desta etapa..."
                : count
                  ? `${count} registro(s) serão movidos para o destino escolhido, incluindo os ocultos pelo filtro.`
                  : "Esta etapa está vazia. Você poderá desfazer a remoção."}
            </DialogDescription>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const token = access.token;
                void act(async () => {
                  const r = await removePipelineColumn(
                    scope,
                    removing.stage.id,
                    destination,
                    removing.request,
                  );
                  if (!access.isCurrent(token)) return;
                  setUndo(
                    r.undoable
                      ? { request: removing.request, name: removing.stage.name }
                      : null,
                  );
                  setRemoving(null);
                  setNotice(
                    r.count
                      ? `Etapa removida. ${r.count} registro(s) movidos.`
                      : "Etapa removida.",
                  );
                  await onChanged();
                });
              }}
            >
              {count === null && !error && (
                <Loader2
                  className="animate-spin"
                  aria-label="Conferindo registros"
                />
              )}
              {count !== null && count > 0 && (
                <TaskField label="Mover os registros para">
                  <select
                    required
                    value={destination}
                    disabled={busy}
                    onChange={(e) => setDestination(e.target.value)}
                  >
                    <option value="" disabled>
                      Selecione uma etapa
                    </option>
                    {stages
                      .filter((s) => s.id !== removing.stage.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </TaskField>
              )}
              {error && (
                <p role="alert" className="task-error">
                  {error}
                </p>
              )}
              <div className="task-actions">
                <button
                  type="button"
                  className="task-button"
                  disabled={busy}
                  onClick={() => setRemoving(null)}
                >
                  Cancelar
                </button>
                <button
                  className="task-button"
                  disabled={busy || count === null || !destination}
                >
                  <Trash2 size={15} />
                  {busy ? "Removendo..." : "Remover etapa"}
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
