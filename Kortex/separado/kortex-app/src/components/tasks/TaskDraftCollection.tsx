import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  FileCheck2,
  Loader2,
  Pencil,
  UserRound,
} from "lucide-react";
import type { TaskDraft } from "@/integrations/supabase/taskTypes";
import {
  formatTaskDate,
  priorityLabels,
  taskValues,
  type TaskCatalog,
} from "@/features/tasks/model";
import {
  compactDueDate,
  draftIssue,
  draftRecipient,
  groupDrafts,
} from "@/features/tasks/draft-batches";
import { TaskAttachments } from "@/pages/TasksPage";
export default function TaskDraftCollection({
  drafts,
  catalog,
  workspaceId,
  busy,
  onEdit,
  onApprove,
  onDetailsChange,
}: {
  drafts: TaskDraft[];
  catalog: TaskCatalog;
  workspaceId?: string;
  busy: boolean;
  onEdit: (d: TaskDraft, trigger: HTMLElement) => void;
  onApprove: (drafts: TaskDraft[]) => Promise<void>;
  onDetailsChange?: (id: string, open: boolean) => void;
}) {
  const [details, setDetails] = useState(false),
    [selection, setSelection] = useState<Record<string, number>>({});
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false),
    root = useRef<HTMLElement>(null),
    summaryScroll = useRef(0);
  const restore = useRef(false);
  const previousHeight=useRef<number>();
  const animation=useRef<Animation>();
  const groups = groupDrafts(drafts, catalog);
  const presentationId = drafts[0]?.batch_id || "legacy";
  useEffect(() => {
    onDetailsChange?.(presentationId, details);
    return () => onDetailsChange?.(presentationId, false);
  }, [details, presentationId, onDetailsChange]);
  const reviewed = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    setSelection((previous) =>
      Object.fromEntries(
        Object.entries(previous)
          .filter(([id, version]) =>
            drafts.some(
              (d) =>
                d.id === id &&
                !d.confirmed_task_id &&
                (d.version === version ||
                  reviewed.current.get(id) === d.version ||
                  (reviewed.current.get(id) === version &&
                    d.version < version)),
            ),
          )
          .map(([id, v]) => [id, Math.max(reviewed.current.get(id) ?? v, v)]),
      ),
    );
  }, [drafts]);
  useEffect(() => {
    const listener = (event: Event) => {
      const d = (event as CustomEvent<TaskDraft>).detail;
      reviewed.current.set(d.id, d.version);
      setSelection((prev) =>
        prev[d.id] ? { ...prev, [d.id]: d.version } : prev,
      );
    };
    root.current?.addEventListener("draft-reviewed", listener);
    const el = root.current;
    return () => el?.removeEventListener("draft-reviewed", listener);
  }, []);
  useLayoutEffect(() => {
    const el=root.current;
    if(el && previousHeight.current !== undefined && el.animate && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches){
      animation.current?.cancel();
      animation.current=el.animate([{height:`${previousHeight.current}px`},{height:`${el.getBoundingClientRect().height}px`}],{duration:200,easing:"ease-out"});
    }
    previousHeight.current=undefined;
    if (restore.current) {
      const history = root.current?.closest(".task-admin-history");
      if (history) history.scrollTop = summaryScroll.current;
      restore.current = false;
    }
  }, [details]);
  useEffect(()=>()=>animation.current?.cancel(),[]);
  const chosen = drafts.filter(
    (d) => selection[d.id] === d.version && !d.confirmed_task_id,
  );
  const invalid = chosen.some((d) => draftIssue(d, catalog));
  const locked = busy || sending;
  const check = (d: TaskDraft) => (
    <input
      type="checkbox"
      aria-label={`Selecionar ${taskValues(d.payload as never).title || "rascunho"}`}
      checked={selection[d.id] === d.version && !d.confirmed_task_id}
      disabled={locked || !!d.confirmed_task_id}
      onChange={(e) => {
        setSelection((prev) => {
          const next = { ...prev };
          if (e.target.checked) next[d.id] = d.version;
          else delete next[d.id];
          return next;
        });
      }}
    />
  );
  const approve = async () => {
    if (sendingRef.current || locked || !chosen.length || invalid) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await onApprove(chosen);
    } catch {
      /* The owner displays the actual server error and keeps the selection. */
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };
  return (
    <section
      ref={root}
      className={`task-collection ${details ? "task-collection--details" : ""}`}
      aria-label="Resumo das tarefas"
    >
      <header className="task-collection-title">
        <FileCheck2 size={26} />
        <div>
          <h2>{details ? "Detalhes das tarefas" : "Resumo das tarefas"}</h2>
          <p>
            {drafts.length} {drafts.length === 1 ? "tarefa" : "tarefas"} ·{" "}
            {groups.length} {groups.length === 1 ? "setor" : "setores"}
          </p>
        </div>
      </header>
      <div className={details ? "task-sector-panels" : "task-summary-groups"}>
        {groups.map((group) => {
          const recipients = new Set(
            group.drafts.map((d) => draftRecipient(d, catalog)),
          );
          const same = recipients.size === 1;
          return (
            <section className="task-sector-group" key={group.id}>
              <header>
                <h3>{group.name}</h3>
                {same && (
                  <span className="task-recipient">
                    <UserRound size={16} />
                    {Array.from(recipients)[0]}
                  </span>
                )}
              </header>
              {group.drafts.map((d) => {
                const v = taskValues(d.payload as never),
                  issue = d.confirmed_task_id ? null : draftIssue(d, catalog);
                return details ? (
                  <article
                    className="task-detail-card"
                    key={d.id}
                    data-draft-id={d.id}
                  >
                    <header>
                      {check(d)}
                      <h4>
                        {String(d.position ?? drafts.indexOf(d) + 1).padStart(
                          2,
                          "0",
                        )}
                        . {v.title || "Rascunho a preencher"}
                      </h4>
                      {!d.confirmed_task_id && (
                        <button
                          className="task-icon"
                          aria-label={`Editar ${v.title || "rascunho"}`}
                          disabled={locked}
                          onClick={(e) => onEdit(d, e.currentTarget)}
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                    </header>
                    <dl>
                      {[
                        [
                          "Empresa",
                          catalog.companies.find((c) => c.id === v.company_id)
                            ?.name ||
                            (v.company_id
                              ? "Empresa indisponível"
                              : "Sem empresa"),
                        ],
                        ["Código", v.operational_code || "Não informado"],
                        ["Operadora", v.operator || "Não informada"],
                        ["Projeto", v.project || "Não informado"],
                        ["Responsável", draftRecipient(d, catalog)],
                        ["Prazo", formatTaskDate(v.due_date)],
                        [
                          "Etapa",
                          catalog.stages.find((s) => s.id === v.stage_id)
                            ?.name || "Etapa a revisar",
                        ],
                        ["Prioridade", priorityLabels[v.priority]],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                      <div className="task-detail-description">
                        <dt>Descrição</dt>
                        <dd>{v.description || "Sem descrição"}</dd>
                      </div>
                    </dl>
                    <TaskAttachments workspaceId={workspaceId} draftId={d.id} />
                    {issue && <p className="task-batch-issue">{issue}</p>}
                    {d.confirmed_task_id && (
                      <p className="task-batch-confirmed">
                        <Check size={14} />
                        Encaminhada
                      </p>
                    )}
                  </article>
                ) : (
                  <div
                    className="task-summary-item"
                    key={d.id}
                    data-draft-id={d.id}
                  >
                    <div className="task-summary-line">
                      {check(d)}
                      <button
                        className="task-summary-name"
                        disabled={locked || !!d.confirmed_task_id}
                        onClick={(e) => onEdit(d, e.currentTarget)}
                      >
                        {v.title || "Rascunho a preencher"}
                      </button>
                      {!same && (
                        <span className="task-row-recipient">
                          {draftRecipient(d, catalog)}
                        </span>
                      )}
                      <span className="task-summary-date">
                        <CalendarDays size={15} />
                        {compactDueDate(v.due_date)}
                      </span>
                      {d.confirmed_task_id && (
                        <span className="task-batch-confirmed">
                          <Check size={14} />
                          Encaminhada
                        </span>
                      )}
                    </div>
                    {issue && (
                      <button
                        className="task-batch-issue"
                        disabled={locked}
                        onClick={(e) => onEdit(d, e.currentTarget)}
                      >
                        {issue} Abrir revisão
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <footer>
        <button
          className="task-link"
          onClick={() => {
            previousHeight.current=root.current?.getBoundingClientRect().height;
            if (!details)
              summaryScroll.current =
                root.current?.closest(".task-admin-history")?.scrollTop ?? 0;
            else restore.current = true;
            setDetails((v) => !v);
          }}
        >
          {details ? "Voltar ao resumo" : "Ver detalhes das tarefas"}
          <ArrowRight size={16} />
        </button>
        <button
          className="task-button task-cyan"
          disabled={locked || !chosen.length || invalid}
          onClick={() => void approve()}
        >
          {sending ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Encaminhando...
            </>
          ) : (
            <>
              Aprovar e encaminhar{chosen.length ? ` (${chosen.length})` : ""}
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </footer>
    </section>
  );
}
