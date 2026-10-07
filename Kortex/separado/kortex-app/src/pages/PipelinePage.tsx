import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Filter,
  LayoutGrid,
  List,
  Mail,
  Phone,
  Plus,
  Search,
  UserRound,
  X,
} from "lucide-react";
import LeadWorkspaceModal, { NewLeadPayload } from "@/components/leads/LeadWorkspaceModal";
import { Lead, leads, pipelines } from "@/data/mockData";
import { cn } from "@/lib/utils";

type PipelineView = "kanban" | "list";
type SortMode = "recent" | "name" | "stage";

type PipelineFilters = {
  withCompany: boolean;
  withTag: boolean;
};

type PipelineRouteState = {
  pipelineState?: Partial<{
    view: PipelineView;
    query: string;
    tagFilter: string;
    sortMode: SortMode;
    filters: PipelineFilters;
  }>;
};

const emptyFilters: PipelineFilters = {
  withCompany: false,
  withTag: false,
};

const pipelineControl =
  "inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border/80 bg-background/75 px-3 text-[13px] font-medium text-muted-foreground shadow-sm shadow-black/0 transition-colors hover:border-primary/30 hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const pipelineControlActive =
  "border-primary/40 bg-primary/10 text-primary hover:border-primary/50 hover:bg-primary/20 hover:text-primary";

const pipelineSelect =
  "h-9 rounded-xl border border-border/80 bg-background/75 px-3 text-[13px] font-medium text-foreground outline-none transition-colors hover:border-primary/30 focus:border-primary/60 focus:ring-2 focus:ring-primary/20";

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function resolvePipeline(pipelineId?: string) {
  const found = pipelines.find((item) => item.id === pipelineId);
  if (found) return found;

  if (pipelineId === "relacionamento") {
    const base = pipelines.find((item) => item.id === "atendimento-luisa") || pipelines[0];
    return { ...base, id: "relacionamento", name: "Relacionamento" };
  }

  return pipelines[0];
}

function leadEmail(lead: Lead) {
  return lead.email || (lead.contact?.includes("@") ? lead.contact : "");
}

function leadPhone(lead: Lead) {
  return lead.phone || "";
}

function leadResponsible(lead: Lead) {
  return lead.responsible || "";
}

function leadTasksLabel(lead: Lead) {
  const count = lead.tasksCount || 0;
  return count ? `${count} tarefa${count === 1 ? "" : "s"}` : "Sem tarefas";
}

function sortLeads(items: Lead[], sortMode: SortMode, stages: string[]) {
  const next = [...items];
  if (sortMode === "name") {
    return next.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }
  if (sortMode === "stage") {
    return next.sort((a, b) => stages.indexOf(a.stage) - stages.indexOf(b.stage));
  }
  return next;
}

export default function PipelinePage() {
  const { pipelineId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const pipeline = resolvePipeline(pipelineId);
  const initialRouteState = (location.state as PipelineRouteState | null)?.pipelineState;
  const [boardLeads, setBoardLeads] = useState<Lead[]>(leads);
  const [query, setQuery] = useState(initialRouteState?.query || "");
  const [view, setView] = useState<PipelineView>(initialRouteState?.view || "kanban");
  const [tagFilter, setTagFilter] = useState(initialRouteState?.tagFilter || "all");
  const [sortMode, setSortMode] = useState<SortMode>(initialRouteState?.sortMode || "recent");
  const [filters, setFilters] = useState<PipelineFilters>(initialRouteState?.filters || emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [showNewLead, setShowNewLead] = useState(false);
  const [newLeadStage, setNewLeadStage] = useState(pipeline.stages[0]);
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set());
  const filterMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setNewLeadStage((current) => (pipeline.stages.includes(current) ? current : pipeline.stages[0]));
  }, [pipeline.stages]);

  useEffect(() => {
    if (!showFilters) return undefined;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!filterMenuRef.current?.contains(event.target as Node)) setShowFilters(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowFilters(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showFilters]);

  const aliases = useMemo(
    () => (pipeline.id === "relacionamento" ? ["relacionamento", "atendimento-luisa"] : [pipeline.id]),
    [pipeline.id],
  );

  const allPipelineLeads = useMemo(() => boardLeads.filter((lead) => aliases.includes(lead.pipeline)), [aliases, boardLeads]);

  const tagOptions = useMemo(
    () => Array.from(new Set(allPipelineLeads.flatMap((lead) => lead.tags || []))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [allPipelineLeads],
  );

  const pipelineLeads = useMemo(() => {
    const normalized = normalize(query.trim());
    const filtered = allPipelineLeads.filter((lead) => {
      const matchesQuery =
        !normalized ||
        normalize(lead.name).includes(normalized) ||
        normalize(lead.company || "").includes(normalized) ||
        normalize(lead.contact || "").includes(normalized) ||
        normalize(leadEmail(lead)).includes(normalized) ||
        normalize(leadPhone(lead)).includes(normalized);

      const matchesTag = tagFilter === "all" || (lead.tags || []).includes(tagFilter);
      const matchesFilters =
        (!filters.withCompany || Boolean(lead.company)) &&
        (!filters.withTag || Boolean(lead.tags?.length));

      return matchesQuery && matchesTag && matchesFilters;
    });

    return sortLeads(filtered, sortMode, pipeline.stages);
  }, [allPipelineLeads, filters, pipeline.stages, query, sortMode, tagFilter]);

  const totalValue = pipelineLeads.reduce((sum, lead) => sum + lead.value, 0);
  const hasFilters = filters.withCompany || filters.withTag || tagFilter !== "all" || Boolean(query);

  const getLeadsForStage = (stage: string) => pipelineLeads.filter((lead) => lead.stage === stage);

  const openNewLead = (stage = pipeline.stages[0]) => {
    setNewLeadStage(stage);
    setShowNewLead(true);
  };

  const currentPipelineState = {
    view,
    query,
    tagFilter,
    sortMode,
    filters,
  };

  const openLead = (lead: Lead) => {
    navigate(`/leads/${lead.id}`, {
      state: {
        lead,
        returnTo: `${location.pathname}${location.search}`,
        pipelineState: currentPipelineState,
      },
    });
  };

  const handleCreateLead = (payload: NewLeadPayload) => {
    const newLead: Lead = {
      id: crypto.randomUUID(),
      name: payload.title,
      contact: payload.contact,
      company: payload.company,
      email: payload.email,
      phone: payload.phone,
      value: 0,
      date: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date()),
      tags: payload.source ? [payload.source] : ["Novo lead"],
      stage: newLeadStage,
      pipeline: pipeline.id,
    };

    setBoardLeads((current) => [newLead, ...current]);
    setShowNewLead(false);
    openLead(newLead);
  };

  const toggleStage = (stage: string) => {
    setCollapsedStages((current) => {
      const next = new Set(current);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  const clearSelection = () => {
    setFilters(emptyFilters);
    setTagFilter("all");
    setQuery("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background p-3 text-foreground">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <header className="shrink-0 border-b border-border p-3 [font-family:Inter,system-ui,-apple-system,sans-serif]">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative min-w-[220px] flex-1 xl:max-w-[340px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 w-full rounded-xl border border-input/90 bg-background/75 pl-9 pr-3 text-[13px] font-normal outline-none transition-colors placeholder:text-muted-foreground hover:border-primary/30 focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                placeholder="Buscar leads..."
                type="search"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
                className={pipelineSelect}
                aria-label="Filtrar por tags"
              >
                <option value="all">Todas as tags</option>
                {tagOptions.map((tag) => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>

              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className={pipelineSelect}
                aria-label="Ordenar leads"
              >
                <option value="recent">Recentes</option>
                <option value="name">Nome A-Z</option>
                <option value="stage">Etapa</option>
              </select>

              <div ref={filterMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowFilters((current) => !current)}
                  className={cn(
                    pipelineControl,
                    filters.withCompany || filters.withTag
                      ? pipelineControlActive
                      : "hover:text-foreground",
                  )}
                  aria-pressed={filters.withCompany || filters.withTag}
                >
                  <Filter className="h-3.5 w-3.5" />
                  Filtros
                </button>
                {showFilters && (
                  <div className="absolute right-0 top-10 z-20 w-60 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-xl">
                    {[
                      ["withCompany", "Somente com empresa"],
                      ["withTag", "Somente com tag"],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setFilters((current) => ({ ...current, [key]: !current[key as keyof PipelineFilters] }))}
                        className="flex h-9 w-full items-center justify-between rounded-lg px-3 text-left text-[13px] font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        {label}
                        <span className={cn("h-4 w-4 rounded border", filters[key as keyof PipelineFilters] && "border-primary bg-primary")} />
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setFilters(emptyFilters)}
                      className="mt-1 h-8 w-full rounded-lg border border-border text-[13px] font-medium transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      Limpar filtros
                    </button>
                  </div>
                )}
              </div>

              <div className="inline-flex h-9 rounded-xl border border-border/80 bg-background/60 p-1 shadow-sm" role="group" aria-label="Alternar visualização do pipeline">
                <button
                  type="button"
                  onClick={() => setView("kanban")}
                  aria-pressed={view === "kanban"}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    view === "kanban" ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/25" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Kanban
                </button>
                <button
                  type="button"
                  onClick={() => setView("list")}
                  aria-pressed={view === "list"}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    view === "list" ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/25" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  <List className="h-3.5 w-3.5" />
                  Lista
                </button>
              </div>

              <span className="min-w-[60px] text-center text-[13px] font-semibold text-muted-foreground">
                {pipelineLeads.length} leads
              </span>

              <button
                type="button"
                onClick={() => openNewLead(pipeline.stages[0])}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-sm shadow-primary/20 transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Plus className="h-3.5 w-3.5" />
                Novo lead
              </button>
            </div>
          </div>
        </header>

        {view === "kanban" ? (
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            <div className="h-full overflow-x-auto overflow-y-hidden pb-2 scrollbar-thin">
              <div className="flex h-full min-w-max gap-3">
                {pipeline.stages.map((stage, index) => {
                  const stageLeads = getLeadsForStage(stage);
                  return (
                    <section key={stage} className="flex w-[292px] min-w-[292px] flex-col border-r border-border pr-3 last:border-r-0">
                      <div className="mb-3 flex items-center gap-2">
                        <div role="heading" aria-level={2} className="text-sm font-semibold uppercase leading-5 tracking-normal">
                          {stage}
                        </div>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{stageLeads.length}</span>
                      </div>
                      <div
                        className="mb-2 h-0.5 rounded-full"
                        style={{ backgroundColor: pipeline.stageColors[index] || "hsl(var(--primary))" }}
                      />
                      <button
                        type="button"
                        onClick={() => openNewLead(stage)}
                        className="mb-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/75 bg-background/50 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Adição rápida
                      </button>

                      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1 scrollbar-thin">
                        {stageLeads.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border bg-background/60 p-3 text-[13px] text-muted-foreground">
                            Nenhum lead nesta etapa.
                          </div>
                        ) : (
                          stageLeads.map((lead) => (
                            <article
                              key={lead.id}
                              tabIndex={0}
                              onClick={() => openLead(lead)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  openLead(lead);
                                }
                              }}
                              className="cursor-pointer rounded-lg border border-border bg-background p-2.5 shadow-sm transition hover:border-primary/60 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-primary/10"
                            >
                              <div className="mb-2 flex items-start justify-between gap-2">
                                <h3 className="line-clamp-2 text-[13px] font-semibold leading-4">{lead.name}</h3>
                                <ChevronsUpDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              </div>
                              {leadEmail(lead) && (
                                <p className="mt-1.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                                  <Mail className="h-3 w-3 shrink-0" />
                                  {leadEmail(lead)}
                                </p>
                              )}
                              <p className="mt-1.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                                <Phone className="h-3 w-3 shrink-0" />
                                {leadPhone(lead) || "Telefone não informado"}
                              </p>
                              {lead.tags?.[0] && (
                                <span className="mt-2 inline-flex rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                  {lead.tags[0]}
                                </span>
                              )}
                              <div className="mt-2.5 border-t border-border pt-2.5">
                                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                  <span className="inline-flex min-w-0 items-center gap-2">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                                      {initials(leadResponsible(lead) || lead.name) || <UserRound className="h-3 w-3" />}
                                    </span>
                                    <span className="truncate">{leadResponsible(lead) || "Responsável não informado"}</span>
                                  </span>
                                  <span className="font-medium">{leadTasksLabel(lead)}</span>
                                </div>
                                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <CalendarDays className="h-3 w-3" />
                                  {lead.date}
                                </p>
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-3 scrollbar-thin">
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[920px] text-[13px]">
                  <thead className="border-b border-border bg-muted/30 text-left text-[11px] font-bold text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">Contato</th>
                      <th className="px-4 py-2.5">Telefone</th>
                      <th className="px-4 py-2.5">Responsável</th>
                      <th className="px-4 py-2.5">Data</th>
                      <th className="px-4 py-2.5">Tarefas</th>
                      <th className="px-4 py-2.5 text-right">Abrir</th>
                    </tr>
                  </thead>
                  {pipeline.stages.map((stage) => {
                    const stageLeads = getLeadsForStage(stage);
                    const collapsed = collapsedStages.has(stage);
                    return (
                      <tbody key={stage} className="border-b border-border last:border-b-0">
                        <tr className="bg-muted/20">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="flex items-center justify-between gap-4">
                              <button
                                type="button"
                                onClick={() => toggleStage(stage)}
                                className="inline-flex items-center gap-2 text-left text-sm font-semibold uppercase text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                              >
                                <ChevronDown className={cn("h-4 w-4 transition", collapsed && "-rotate-90")} />
                                {stage}
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{stageLeads.length}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openNewLead(stage)}
                                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Adição rápida
                              </button>
                            </div>
                          </td>
                        </tr>
                        {!collapsed && stageLeads.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-5 text-center text-muted-foreground">
                              Nenhum lead nesta etapa.
                            </td>
                          </tr>
                        )}
                        {!collapsed && stageLeads.map((lead) => (
                          <tr
                            key={lead.id}
                            onClick={() => openLead(lead)}
                            className="cursor-pointer border-t border-border transition hover:bg-muted/30"
                          >
                            <td className="px-4 py-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                                  {initials(lead.name)}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="truncate font-semibold text-foreground">{lead.name}</p>
                                    {lead.tags?.[0] && (
                                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                        {lead.tags[0]}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{leadEmail(lead) || lead.company || "E-mail não informado"}</p>
                                </div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{leadPhone(lead) || "Não informado"}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-2 text-muted-foreground">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                                  {initials(leadResponsible(lead) || lead.name)}
                                </span>
                                {leadResponsible(lead) || "Não informado"}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{lead.date}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{leadTasksLabel(lead)}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openLead(lead);
                                }}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-primary"
                                aria-label={`Abrir ${lead.name}`}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    );
                  })}
                </table>
              </div>
            </div>
          </div>
        )}

        <footer className="shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Pipeline: <span className="font-semibold text-foreground">{pipeline.name}</span>
          <span className="mx-2">•</span>
          Valor filtrado: R$ {totalValue.toLocaleString("pt-BR")}
          {hasFilters && (
            <button type="button" onClick={clearSelection} className="ml-3 inline-flex items-center gap-1 font-semibold text-primary">
              <X className="h-3.5 w-3.5" />
              limpar seleção
            </button>
          )}
        </footer>
      </section>

      {showNewLead && (
        <LeadWorkspaceModal
          initialStage={newLeadStage}
          pipelineName={pipeline.name}
          onClose={() => setShowNewLead(false)}
          onCreate={handleCreateLead}
        />
      )}
    </div>
  );
}
