import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Filter,
  LayoutGrid,
  List,
  Plus,
  Search,
  Settings,
  Settings2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  BusinessContextPicker,
  useBusinessAccess,
} from "@/features/access/BusinessAccess";
import { BoardMembersEditor } from "@/features/access/BoardMembersEditor";
import { ColumnsEditor } from "@/features/access/ColumnsEditor";
import { LeadEditor } from "@/features/pipeline/LeadEditor";
import PipelineBoard from "@/features/pipeline/PipelineBoard";
import { PipelineInitialState } from "./PipelineSetupPage";
import { pipelinePosition, recordHref, savePipelinePosition } from "@/features/pipeline/navigation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { moveLead, pipelineData } from "@/features/pipeline/service";



import { TaskField } from "@/components/tasks/TaskFormDialog";
import "./TasksPage.css";
import "./PipelinePage.css";

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value,
  );
export default function PipelinePage() {
  const access = useBusinessAccess();
  const { user, workspace } = useAuth();
  const { pipelineId } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const scope = access.selected("pipeline");
  const taskScope = access.selected("tasks");
  const currentWorkspace = scope?.workspace_id ?? workspace?.id ?? taskScope?.workspace_id;
  const currentSector = scope?.sector_id ?? (taskScope?.workspace_id === currentWorkspace ? taskScope.sector_id : undefined);
  const available = access.contexts.filter(c => c.kind === "pipeline" && (!currentWorkspace || c.workspace_id === currentWorkspace) && (!currentSector || c.sector_id === currentSector));
  const routeScope = access.contexts.find(
    (c) => c.kind === "pipeline" && c.pipeline_id === pipelineId,
  );
  useEffect(() => {
    const target = routeScope ?? (!pipelineId && !scope && available.length === 1 ? available[0] : null);
    if (target && scope?.board_id !== target.board_id) access.select(target);
  }, [access, routeScope, scope, pipelineId, available]);
  const valid = Boolean(
    scope && (!pipelineId || scope.pipeline_id === pipelineId),
  );
  const data = useQuery({
    queryKey: access.key("pipeline", "pipeline-data"),
    enabled: valid,
    retry: false,
    refetchInterval: 15000,
    queryFn: ({ signal }) => pipelineData(scope!, signal),
  });
  const query = params.get("q") ?? "";
  const view = params.get("view") === "list" ? "list" : "kanban";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const size = [10,25,50].includes(Number(params.get("size"))) ? Number(params.get("size")) : 25;
  const update = (values: Record<string, string>) => setParams(current => {
    const next = new URLSearchParams(current);
    for (const [key,value] of Object.entries(values)) {
      if (value) next.set(key,value); else next.delete(key);
    }
    return next;
  }, { replace: true });
  const returnTo = `/pipeline/${scope?.pipeline_id ?? ""}${location.search}`;
  const newPipeline = () => {
    const search = new URLSearchParams();
    if (scope) { search.set("sector", scope.sector_id); search.set("return", returnTo); }
    navigate(`/pipeline/new${search.size ? `?${search}` : ""}`);
  };
  const positionKey = `${user?.id}:${scope?.board_id}:${location.search}`;
  const listRef = useRef<HTMLDivElement>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  const [initialStage, setInitialStage] = useState<string | null>(null);
  const [quick, setQuick] = useState(false);
  const [moving, setMoving] = useState("");
  const moveLock = useRef(false);
  const ownerFilter = params.get("owner") === "mine" ? "mine" : "all";
  const dateFilter = ["dated","undated","overdue"].includes(params.get("date") ?? "") ? params.get("date")! : "all";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftOwner, setDraftOwner] = useState(ownerFilter);
  const [draftDate, setDraftDate] = useState(dateFilter);
  const financial =
    scope?.sector_name.toLocaleLowerCase("pt-BR").includes("comercial") ??
    false;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setInitialStage(null);
    setColumnsOpen(false);
    setMembersOpen(false);
    setError("");
    setMoving("");
  }, [scope?.board_id, user?.id]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = pipelinePosition(positionKey).top;
  }, [positionKey, view, data.isLoading]);
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("pt-BR");
    const today = new Date().toLocaleDateString("en-CA");
    return (data.data?.leads ?? []).filter((l) => {
      const matchesText =
        !text ||
        `${l.title} ${l.description ?? ""} ${l.company?.name ?? ""} ${l.contact?.full_name ?? ""} ${l.email ?? l.contact?.email ?? l.company?.email ?? ""} ${l.phone ?? l.contact?.phone ?? l.company?.phone ?? ""} ${l.project ?? ""} ${l.city ?? ""} ${(l.tags ?? []).join(" ")}`
          .toLocaleLowerCase("pt-BR")
          .includes(text);
      const matchesOwner = ownerFilter === "all" || l.assigned_to === user?.id;
      const due = l.expected_close_date;
      const matchesDate =
        dateFilter === "all" ||
        (dateFilter === "dated" && Boolean(due)) ||
        (dateFilter === "undated" && !due) ||
        (dateFilter === "overdue" && Boolean(due && due < today));
      return matchesText && matchesOwner && matchesDate;
    });
  }, [data.data, query, ownerFilter, dateFilter, user?.id]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / size));
  const currentPage = Math.min(page, totalPages);
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({
        queryKey: access.key("pipeline", "pipeline-data"),
      }),
      access.retry(),
    ]);
  };
  const changeStage = async (id: string, stage: string) => {
    const lead = data.data?.leads.find((l) => l.id === id);
    if (
      !scope ||
      !lead?.can_edit ||
      moveLock.current ||
      !data.data?.stages.some((s) => s.id === stage) ||
      lead.stage_id === stage
    )
      return;
    const token = access.token;
    moveLock.current = true;
    setBusy(true);
    setMoving(id);
    setError("");
    try {
      const position =
        Math.max(
          -1,
          ...data.data.leads
            .filter((l) => l.stage_id === stage)
            .map((l) => l.position),
        ) + 1;
      await moveLead(scope, lead, stage, position);
      if (access.isCurrent(token)) await refresh();
    } catch (e) {
      if (access.isCurrent(token)) {
        setError((e as Error).message);
        await data.refetch();
      }
    } finally {
      moveLock.current = false;
      setBusy(false);
      setMoving("");
    }
  };
  return (
    <div className="tasks-theme pipeline-workspace">
      <div className="pipeline-context">
        {(access.loading || access.error || !valid && available.length > 0) && <BusinessContextPicker
          kind="pipeline"
          onSelect={(c) => navigate(`/pipeline/${c.pipeline_id}`)}
        />}
        {access.contexts.length > 0 && !valid && (
          <button
            className="task-button pipeline-new-board"
            onClick={() => newPipeline()}
          >
            <Plus size={16} />
            Nova pipeline
          </button>
        )}
      </div>
      {!pipelineId && !valid && !access.loading && !access.error && available.length === 0 && (
        <PipelineInitialState workspaceId={currentWorkspace} sectorId={currentSector} cancelled={params.get("setup") === "cancelled"} />
      )}
      {pipelineId && !access.loading && !access.error && !routeScope ? (
        <p role="alert" className="task-empty">
          Registro indisponível para esta conta.
        </p>
      ) : (
        valid &&
        scope && (
          <>
            <div className="pipeline-toolbar">
              {access.contexts.filter(c=>c.kind==="pipeline").length>1 && <select className="pipeline-compact-picker" aria-label="Pipeline ativa" value={scope.board_id} onChange={e=>{const next=access.contexts.find(c=>c.kind==="pipeline"&&c.board_id===e.target.value);if(next){access.select(next);navigate(`/pipeline/${next.pipeline_id}`);}}}>{access.contexts.filter(c=>c.kind==="pipeline").map(c=><option key={c.board_id} value={c.board_id}>{c.board_name} · {c.sector_name}{new Set(access.contexts.filter(c=>c.kind==="pipeline").map(c=>c.workspace_id)).size>1?` · ${c.workspace_name??c.workspace_id.slice(-6)}`:""}</option>)}</select>}
              <div className="pipeline-search">
                <Search size={16} />
                <input
                  aria-label="Buscar registros"
                  placeholder="Buscar nesta pipeline..."
                  value={query}
                  onChange={(e) => {
                    update({ q: e.target.value, page: "" });
                  }}
                />
              </div>
              <Popover open={filtersOpen} onOpenChange={(open) => {
                setFiltersOpen(open);
                if (open) { setDraftOwner(ownerFilter); setDraftDate(dateFilter); }
              }}>
                <PopoverTrigger asChild>
                  <button
                    className="task-button"
                    aria-label="Filtros da pipeline"
                  >
                    <Filter size={15} />
                    Filtros
                    {(ownerFilter !== "all" || dateFilter !== "all") && (
                      <span className="pipeline-filter-count">
                        {Number(ownerFilter !== "all") +
                          Number(dateFilter !== "all")}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="tasks-theme pipeline-filter-popover"
                >
                  <h2>Filtrar registros</h2>
                  <TaskField label="Responsável">
                    <select
                      value={draftOwner}
                      onChange={(e) => {
                        setDraftOwner(e.target.value);
                      }}
                    >
                      <option value="all">Todos</option>
                      <option value="mine">Atribuídos a mim</option>
                    </select>
                  </TaskField>
                  <TaskField label="Previsão">
                    <select
                      value={draftDate}
                      onChange={(e) => {
                        setDraftDate(e.target.value);
                      }}
                    >
                      <option value="all">Todas</option>
                      <option value="overdue">Em atraso</option>
                      <option value="dated">Com previsão</option>
                      <option value="undated">Sem previsão</option>
                    </select>
                  </TaskField>
                  <div className="task-actions"><button
                    className="task-link"
                    onClick={() => {
                      setDraftOwner("all"); setDraftDate("all");
                      update({ owner: "", date: "", page: "" });
                      setFiltersOpen(false);
                    }}
                  >
                    Limpar filtros
                  </button>
                  <button className="task-button task-cyan" onClick={() => {
                    update({ owner: draftOwner === "all" ? "" : draftOwner, date: draftDate === "all" ? "" : draftDate, page: "" });
                    setFiltersOpen(false);
                  }}>Aplicar filtros</button></div>
                </PopoverContent>
              </Popover>
              <div
                className="pipeline-views"
                role="group"
                aria-label="Visualização da pipeline"
              >
                <button
                  aria-label="Kanban"
                  aria-pressed={view === "kanban"}
                  onClick={() => update({view: ""})}
                >
                  <LayoutGrid size={17} />
                  Kanban
                </button>
                <button
                  aria-label="Lista"
                  aria-pressed={view === "list"}
                  onClick={() => update({view: "list"})}
                >
                  <List size={17} />
                  Lista
                </button>
              </div>
              {financial && <div className="pipeline-summary" aria-live="polite">
                <span>{money(filtered.reduce((sum,l) => sum + Number(l.value ?? 0),0))}</span>
              </div>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="task-button pipeline-icon"
                    aria-label="Configurações da pipeline"
                    title="Configurações da pipeline"
                  >
                    <Settings size={18} className="shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {scope.can_manage && (
                    <DropdownMenuItem onSelect={() => setMembersOpen(true)}>
                      Participantes
                    </DropdownMenuItem>
                  )}
                  {scope.can_manage && (
                    <DropdownMenuItem
                      disabled={!data.data || busy}
                      onSelect={() => setColumnsOpen(true)}
                    >
                      <Settings2 size={15} />
                      Gerenciar etapas
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => newPipeline()}>
                    Nova pipeline
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                className="task-button task-cyan"
                disabled={!scope.can_write || !data.data?.stages.length || busy}
                onClick={() => { setQuick(false); setInitialStage(data.data?.stages[0]?.id ?? ""); }}
              >
                <Plus size={16} />
                Novo
              </button>
            </div>
            {(error || data.error) && (
              <div className="p-4" role="alert">
                <p className="task-error">{error || data.error?.message}</p>
                <button
                  className="task-button mt-2"
                  onClick={() => void data.refetch()}
                >
                  Tentar novamente
                </button>
              </div>
            )}
            {data.isLoading ? (
              <p className="task-empty" role="status">
                Carregando pipeline...
              </p>
            ) : (
              data.data &&
              !data.isError && (
                <>
                  {view === "kanban" ? (
                    <PipelineBoard
                      key={scope.board_id}
                      scope={scope}
                      stages={data.data.stages}
                      leads={data.data.leads}
                      filtered={filtered}
                      financial={financial}
                      moving={moving}
                      onMove={changeStage}
                      onChanged={refresh}
                      onAddRecord={stage => { setQuick(true); setInitialStage(stage); }}
                      returnTo={returnTo}
                      positionKey={positionKey}
                    />
                  ) : (
                    <div className="pipeline-list" ref={listRef} onScroll={e => savePipelinePosition(positionKey, 0, e.currentTarget.scrollTop)}>
                      <table className="w-full min-w-[650px] rounded-xl border border-border bg-card text-left text-sm">
                        <thead className="bg-muted/50 text-muted-foreground">
                          <tr>
                            {[
                              "Registro",
                              "Etapa",
                              ...(financial ? ["Valor"] : []),
                              "Previsão",
                              "Visibilidade",
                            ].map((t) => (
                              <th className="p-3 font-medium" key={t}>
                                {t}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filtered
                            .slice((currentPage - 1) * size, currentPage * size)
                            .map((l) => (
                              <tr key={l.id} className="border-t border-border">
                                <td className="max-w-xs truncate p-3">
                                  <Link
                                    className="hover:text-primary"
                                    to={recordHref(l.id, returnTo)}
                                  >
                                    {l.title}
                                  </Link>
                                </td>
                                <td className="p-3">
                                  {
                                    data.data!.stages.find(
                                      (s) => s.id === l.stage_id,
                                    )?.name
                                  }
                                </td>
                                {financial && (
                                  <td className="p-3">{money(l.value ?? 0)}</td>
                                )}
                                <td className="p-3">
                                  {l.expected_close_date
                                    ? new Intl.DateTimeFormat("pt-BR").format(
                                        new Date(
                                          l.expected_close_date + "T12:00:00",
                                        ),
                                      )
                                    : "Sem previsão"}
                                </td>
                                <td className="p-3">
                                  {l.visibility === "personal"
                                    ? "Pessoal"
                                    : "Compartilhado"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {!filtered.length && (
                        <p className="task-empty">
                          {query || ownerFilter !== "all" || dateFilter !== "all"
                            ? "Nenhum resultado para esta busca e filtros."
                            : "Nenhum registro cadastrado nesta pipeline."}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center justify-end gap-3 py-4 text-[13px]">
                        <button
                          className="task-button"
                          disabled={currentPage === 1}
                          onClick={() => update({page: String(currentPage - 1)})}
                        >
                          Anterior
                        </button>
                        <span>
                          {currentPage} de {totalPages}
                        </span>
                        <button
                          className="task-button"
                          disabled={currentPage === totalPages}
                          onClick={() => update({page: String(currentPage + 1)})}
                        >
                          Próxima
                        </button>
                        <select
                          aria-label="Leads por página"
                          value={size}
                          onChange={(e) => {
                            update({size: e.target.value, page: ""});
                          }}
                        >
                          {[10, 25, 50].map((s) => (
                            <option key={s} value={s}>
                              {s} por página
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )
            )}
            {membersOpen && (
              <BoardMembersEditor
                scope={scope}
                onClose={() => setMembersOpen(false)}
              />
            )}
            {columnsOpen && data.data && (
              <ColumnsEditor
                scope={scope}
                columns={data.data.stages}
                onClose={() => setColumnsOpen(false)}
                onSaved={refresh}
              />
            )}
            {initialStage !== null && user && data.data && (
              <LeadEditor
                key={`${user.id}:${scope.board_id}`}
                scope={scope}
                stages={data.data.stages}
                userId={user.id}
                initialStage={initialStage}
                quick={quick}
                onClose={() => setInitialStage(null)}
                onSaved={refresh}
              />
            )}
          </>
        )
      )}

    </div>
  );
}

