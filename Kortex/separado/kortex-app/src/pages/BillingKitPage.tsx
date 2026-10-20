import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  filterBillingItems,
  paginateBillingItems,
  type BillingKitItem,
  type BillingFilters,
  type BillingSort,
  type Operator,
  type SortKey,
} from "@/utils/billingKitTable";
import BillingKoaPanel from "@/components/BillingKoaPanel";
import KoaBrand from "@/components/KoaBrand";
import { useKoaSidePanel } from "@/hooks/useKoaSidePanel";
import "./BillingKitPage.css";

type Company = { id: string; name: string };
// BillingKitSpec describes a future BILLING_KIT workflow. Neither automationApi nor
// the current database schema exposes billing orders. Never populate this with CRM
// companies, unrelated operations, local drafts, or demonstration records.
const billingItems: BillingKitItem[] = [];
const defaultFilters: BillingFilters = {
  operators: ["Hapvida", "NDI"],
  month: "all",
  year: "all",
  status: "all",
};
const requestTypes = [
  "Boleto mensal",
  "Relatório copart",
  "NFS",
  "Kit faturamento completo",
];
const months = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const unavailableMessage =
  "As solicitações de faturamento ainda não estão disponíveis. Nenhum pedido será enviado.";

async function loadCompanies(workspaceId: string): Promise<Company[]> {
  const companies: Company[] = [];
  // Existing workspace and RLS; paginate rather than truncating at the API limit.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from("companies")
      .select("id,name")
      .eq("workspace_id", workspaceId)
      .order("name")
      .order("id")
      .range(offset, offset + 499);
    if (error)
      throw new Error(
        "Não foi possível carregar as empresas. Tente novamente.",
      );
    companies.push(...(data ?? []));
    if (!data || data.length < 500) return companies;
  }
}

export default function BillingKitPage() {
  const { workspace, user, loading: authLoading } = useAuth();
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<"filters" | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const manualTriggerRef = useRef<HTMLButtonElement>(null);
  const koaTriggerRef = useRef<HTMLButtonElement>(null);
  const koaFocusRef = useRef<HTMLInputElement>(null);
  const koaPanel = useKoaSidePanel(
    koaTriggerRef,
    koaFocusRef,
    !manualOpen && !panel,
  );
  const [detail, setDetail] = useState<BillingKitItem>();
  const [filters, setFilters] = useState(defaultFilters);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [sort, setSort] = useState<BillingSort>({
    key: "updatedAt",
    direction: "desc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [operator, setOperator] = useState("");
  const [competence, setCompetence] = useState("");
  const [requestType, setRequestType] = useState(requestTypes[0]);
  const companiesQuery = useQuery({
    queryKey: ["billing-kit-companies", workspace?.id, user?.id],
    queryFn: () => loadCompanies(workspace!.id),
    enabled: Boolean(workspace && user && (manualOpen || koaPanel.hasOpened)),
  });
  const companies = companiesQuery.data ?? [];
  const selectedCompanyId = companies.some(
    (company) => company.id === selectedCompany,
  )
    ? selectedCompany
    : "";
  const years = useMemo(
    () =>
      [
        ...new Set(billingItems.map((item) => item.competence.split("/")[1])),
      ].sort((a, b) => Number(b) - Number(a)),
    [],
  );
  const filteredItems = useMemo(
    () => filterBillingItems(billingItems, query, filters, sort),
    [query, filters, sort],
  );
  const pagination = paginateBillingItems(filteredItems, page, pageSize);
  const activeFilters =
    Number(filters.operators.length !== 2) +
    Number(filters.month !== "all") +
    Number(filters.year !== "all") +
    Number(filters.status !== "all");
  const hasSearch = Boolean(query.trim() || activeFilters);
  const changeSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
    setPage(1);
  };
  const companyState =
    authLoading || companiesQuery.isLoading
      ? "loading"
      : !user || !workspace
        ? "session"
        : companiesQuery.isError
          ? "error"
          : companies.length
            ? "ready"
            : "empty";
  const companyFeedback = (
    <CompanyFeedback
      state={companyState}
      onRetry={() => void companiesQuery.refetch()}
    />
  );

  return (
    <div className="billing-kit relative flex h-full min-h-0 min-w-0 overflow-hidden bg-background font-sans text-sm text-foreground">
      <h1 className="sr-only">Kit Faturamento</h1>
      <div className="billing-kit-list flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 sm:p-5">
        <div
          className="billing-kit-toolbar flex shrink-0 flex-wrap items-center gap-3"
          role="toolbar"
          aria-label="Controles do Kit Faturamento"
        >
          <div className="billing-kit-search relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-primary"
              strokeWidth={1.6}
            />
            <input
              type="search"
              aria-label="Buscar empresa"
              placeholder="Buscar empresa..."
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              className="billing-kit-control w-full rounded-xl border border-input bg-card pl-10 pr-10 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setPage(1);
                }}
                aria-label="Limpar busca"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {/* The original asset keeps its identity and visible mark near 32px. */}
          <button
            ref={koaTriggerRef}
            type="button"
            onClick={() => {
              setPanel(null);
              koaPanel.open();
            }}
            className="billing-kit-koa-trigger flex shrink-0 items-center justify-center rounded-lg bg-transparent p-0 transition hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Abrir chat do KOA"
            aria-expanded={koaPanel.phase === "open"}
            aria-controls="billing-koa-panel"
            title="Abrir KOA"
          >
            <KoaBrand
              size={48}
              className="h-12 w-12 max-w-none shrink-0 object-contain koa-symbol-motion"
            />
          </button>
          <Popover
            open={panel === "filters"}
            onOpenChange={(open) => {
              setPanel(open ? "filters" : null);
              if (open) setDraftFilters(filters);
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "billing-kit-control inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-input bg-card px-4 text-sm font-medium text-primary transition hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  activeFilters > 0 && "border-primary/50 bg-accent/40",
                )}
              >
                <Filter className="h-[18px] w-[18px]" strokeWidth={1.6} />
                Filtros
                {activeFilters > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] text-primary-foreground">
                    {activeFilters}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              collisionPadding={16}
              className="billing-kit billing-kit-filters flex w-[min(340px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl p-0 font-sans text-sm"
            >
              <PanelHeader title="Filtros" onClose={() => setPanel(null)} />
              <div className="min-h-0 space-y-5 overflow-auto px-4 py-4">
                <fieldset>
                  <legend className="mb-2 font-medium">Operadora</legend>
                  <div className="flex gap-5">
                    {(["Hapvida", "NDI"] as Operator[]).map((value) => (
                      <label
                        key={value}
                        className="inline-flex items-center gap-2"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={draftFilters.operators.includes(value)}
                          onChange={(event) =>
                            setDraftFilters((current) => ({
                              ...current,
                              operators: event.target.checked
                                ? [...current.operators, value]
                                : current.operators.filter(
                                    (operator) => operator !== value,
                                  ),
                            }))
                          }
                        />
                        {value}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 font-medium">Competência</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <SelectBox
                      label="Mês"
                      value={draftFilters.month}
                      onChange={(value) =>
                        setDraftFilters((current) => ({
                          ...current,
                          month: value,
                        }))
                      }
                      options={[
                        { value: "all", label: "Todos os meses" },
                        ...months.map((label, index) => ({
                          value: String(index + 1).padStart(2, "0"),
                          label,
                        })),
                      ]}
                    />
                    <SelectBox
                      label="Ano"
                      value={draftFilters.year}
                      onChange={(value) =>
                        setDraftFilters((current) => ({
                          ...current,
                          year: value,
                        }))
                      }
                      options={[
                        { value: "all", label: "Todos os anos" },
                        ...years.map((year) => ({ value: year, label: year })),
                      ]}
                    />
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 font-medium">Status do kit</legend>
                  <div className="space-y-2">
                    {[
                      ["all", "Todos"],
                      ["available", "Disponíveis"],
                      ["pending", "Pendentes"],
                      ["processing", "Em processamento"],
                    ].map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          name="billing-status"
                          value={value}
                          checked={draftFilters.status === value}
                          onChange={() =>
                            setDraftFilters((current) => ({
                              ...current,
                              status: value as BillingFilters["status"],
                            }))
                          }
                          className="h-4 w-4 accent-primary"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-border p-4">
                <button
                  type="button"
                  onClick={() => setDraftFilters(defaultFilters)}
                  className="h-10 rounded-lg border border-input hover:bg-secondary"
                >
                  Limpar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilters(draftFilters);
                    setPage(1);
                    setPanel(null);
                  }}
                  className="h-10 rounded-lg bg-primary font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Aplicar filtros
                </button>
              </div>
            </PopoverContent>
          </Popover>
          <button
            ref={manualTriggerRef}
            type="button"
            onClick={() => {
              setPanel(null);
              setManualOpen(true);
              setSelectedCompany("");
              setOperator("");
              setCompetence("");
              setRequestType(requestTypes[0]);
            }}
            className="billing-kit-new-request billing-kit-control inline-flex shrink-0 items-center justify-center rounded-xl text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" strokeWidth={1.6} />
            Novo pedido
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
          <div
            className="billing-kit-table-scroll min-h-0 flex-1 overflow-auto scrollbar-thin"
            role="region"
            aria-label="Tabela de pedidos de faturamento"
            tabIndex={0}
          >
            <table
              className={cn(
                "w-full min-w-[920px] table-fixed text-left text-sm",
                !pagination.items.length && "h-full",
              )}
            >
              <caption className="sr-only">
                Pedidos de Kit Faturamento por empresa, operadora e competência
              </caption>
              <colgroup>
                <col className="w-[34%]" />
                <col className="w-[18%]" />
                <col className="w-[16%]" />
                <col className="w-[22%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-secondary">
                <tr className="h-12 border-b border-border">
                  <SortableHeader
                    label="Empresa"
                    sortKey="company"
                    sort={sort}
                    onSort={changeSort}
                  />
                  <SortableHeader
                    label="Operadora"
                    sortKey="operator"
                    sort={sort}
                    onSort={changeSort}
                  />
                  <SortableHeader
                    label="Competência"
                    sortKey="competence"
                    sort={sort}
                    onSort={changeSort}
                  />
                  <SortableHeader
                    label="Última atualização"
                    sortKey="updatedAt"
                    sort={sort}
                    onSort={changeSort}
                  />
                  <th scope="col" className="px-4 font-medium">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagination.items.map((item) => (
                  <tr
                    key={item.id}
                    className="h-[68px] border-b border-border last:border-0 hover:bg-secondary/40"
                  >
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <CompanyAvatar name={item.company} />
                        <div className="min-w-0">
                          <p
                            className="truncate font-medium"
                            title={item.company}
                          >
                            {item.company}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {statusLabel(item.status)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4">
                      <span className="inline-flex rounded-full bg-secondary px-3 py-1.5">
                        {item.operator}
                      </span>
                    </td>
                    <td className="px-4 tabular-nums">{item.competence}</td>
                    <td className="px-4 tabular-nums">{item.updatedAt}</td>
                    <td className="px-4">
                      <button
                        type="button"
                        onClick={() => setDetail(item)}
                        aria-label={`Consultar pedido de ${item.company}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-input text-primary hover:bg-accent"
                      >
                        <Eye className="h-4 w-4" strokeWidth={1.5} />
                      </button>
                    </td>
                  </tr>
                ))}
                {!pagination.items.length && (
                  <tr>
                    <td colSpan={5} className="p-0 align-middle">
                      <div className="billing-kit-empty px-6 py-8 text-center">
                        <img
                          src="/brand/billing-empty-folder-transparent.png"
                          alt=""
                          aria-hidden="true"
                          className="billing-kit-empty-folder mx-auto mb-4 object-contain"
                        />
                        <p className="font-medium">
                          {hasSearch
                            ? "Nenhum pedido encontrado"
                            : "Nenhum pedido carregado"}
                        </p>
                        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                          {hasSearch
                            ? "Não há pedidos carregados para esta busca e os filtros selecionados."
                            : "O histórico de faturamento estará disponível aqui quando os pedidos estiverem conectados."}
                        </p>
                        {hasSearch && (
                          <button
                            type="button"
                            onClick={() => {
                              setQuery("");
                              setFilters(defaultFilters);
                              setPage(1);
                            }}
                            className="mt-4 text-[13px] font-medium text-primary hover:underline"
                          >
                            Limpar busca e filtros
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px]">
            <span className="text-muted-foreground" aria-live="polite">
              {filteredItems.length
                ? `Mostrando ${pagination.first} a ${pagination.last} de ${filteredItems.length} pedidos`
                : "0 pedidos exibidos"}
            </span>
            <nav
              aria-label="Paginação dos pedidos"
              className="ml-auto flex flex-wrap items-center gap-1.5"
            >
              <button
                type="button"
                disabled={pagination.page === 1}
                onClick={() => setPage(pagination.page - 1)}
                className="billing-kit-page-button"
                aria-label="Página anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pagination.pages.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  disabled={!filteredItems.length}
                  onClick={() => setPage(pageNumber)}
                  aria-label={`Página ${pageNumber}`}
                  aria-current={
                    pagination.page === pageNumber ? "page" : undefined
                  }
                  className={cn(
                    "billing-kit-page-button",
                    pagination.page === pageNumber &&
                      "border-primary/50 bg-accent text-primary",
                  )}
                >
                  {pageNumber}
                </button>
              ))}
              <button
                type="button"
                disabled={
                  !filteredItems.length ||
                  pagination.page === pagination.totalPages
                }
                onClick={() => setPage(pagination.page + 1)}
                className="billing-kit-page-button"
                aria-label="Próxima página"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="relative ml-1">
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                  aria-label="Itens por página"
                  className="h-9 appearance-none rounded-lg border border-input bg-card pl-3 pr-8 text-[13px] text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                >
                  {[10, 20, 50].map((size) => (
                    <option key={size} value={size}>
                      {size} por página
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
              </span>
            </nav>
          </div>
        </div>
      </div>
      {koaPanel.hasOpened && (
        <BillingKoaPanel
          key={`${workspace?.id ?? "guest"}:${user?.id ?? "guest"}`}
          phase={koaPanel.phase}
          onClose={koaPanel.close}
          focusRef={koaFocusRef}
          companies={companies}
          companyState={companyState}
          companyFeedback={companyFeedback}
        />
      )}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent
          className="billing-kit billing-kit-manual-modal rounded-2xl font-sans text-sm"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            manualTriggerRef.current?.focus();
          }}
        >
          <header className="shrink-0 px-6 pb-5 pt-6">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="text-base font-semibold">
                Novo pedido manual
              </DialogTitle>
              <DialogClose asChild>
                <button
                  type="button"
                  aria-label="Fechar pedido manual"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <X className="h-[18px] w-[18px]" strokeWidth={1.5} />
                </button>
              </DialogClose>
            </div>
            <DialogDescription className="mt-2 text-[13px] leading-relaxed">
              {unavailableMessage}
            </DialogDescription>
          </header>
          <div className="billing-kit-manual-body min-h-0 flex-1 overflow-y-auto px-6 pb-6 scrollbar-thin">
            <div className="space-y-4">
              {companyFeedback}
              <SelectBox
                label="Empresa"
                value={selectedCompanyId}
                disabled={companyState !== "ready"}
                onChange={setSelectedCompany}
                options={[
                  { value: "", label: "Selecione uma empresa" },
                  ...companies.map((company) => ({
                    value: company.id,
                    label: company.name,
                  })),
                ]}
              />
              <SelectBox
                label="Operadora"
                value={operator}
                onChange={setOperator}
                options={[
                  { value: "", label: "Selecione a operadora" },
                  { value: "Hapvida", label: "Hapvida" },
                  { value: "NDI", label: "NDI" },
                ]}
              />
              <label className="block space-y-1.5 font-medium">
                <span>Competência</span>
                <input
                  type="text"
                  placeholder="MM/AAAA"
                  inputMode="numeric"
                  maxLength={7}
                  value={competence}
                  onChange={(event) => setCompetence(event.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm font-normal outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>
              <fieldset>
                <legend className="mb-2 font-medium">Tipo de pedido</legend>
                <div className="billing-kit-request-types grid gap-3">
                  {requestTypes.map((type) => (
                    <label
                      key={type}
                      className={cn(
                        "billing-kit-request-card relative flex min-h-[68px] cursor-pointer items-center gap-3 rounded-lg border border-input bg-card px-3 py-3 transition hover:border-primary/50",
                        requestType === type && "border-primary bg-accent/70",
                      )}
                    >
                      <input
                        type="radio"
                        name="billing-manual-request-type"
                        value={type}
                        checked={requestType === type}
                        onChange={() => setRequestType(type)}
                        className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
                      />
                      <img
                        src="/brand/billing-request-folder-flat.png"
                        alt=""
                        aria-hidden="true"
                        className="h-7 w-7 shrink-0 object-contain"
                      />
                      <span className="min-w-0 text-sm leading-5">{type}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
          <footer className="flex shrink-0 justify-end gap-3 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={() => setManualOpen(false)}
              className="h-10 rounded-lg border border-input px-4 hover:bg-secondary"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled
              className="h-10 rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
            >
              Solicitar pedido
            </button>
          </footer>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetail(undefined);
        }}
      >
        <DialogContent className="billing-kit w-[calc(100%-2rem)] rounded-2xl font-sans text-sm">
          <DialogTitle>Detalhes do pedido</DialogTitle>
          <DialogDescription>
            Informações do registro selecionado.
          </DialogDescription>
          {detail && (
            <dl className="grid grid-cols-2 gap-3">
              <dt>Empresa</dt>
              <dd className="break-words">{detail.company}</dd>
              <dt>Operadora</dt>
              <dd>{detail.operator}</dd>
              <dt>Competência</dt>
              <dd>{detail.competence}</dd>
              <dt>Última atualização</dt>
              <dd>{detail.updatedAt}</dd>
              <dt>Status</dt>
              <dd>{statusLabel(detail.status)}</dd>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: BillingSort;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = active
    ? sort.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <th
      scope="col"
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      className="px-4 font-medium"
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-2 whitespace-nowrap rounded py-1 font-medium text-foreground outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
      >
        {label}
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active ? "text-primary" : "text-muted-foreground",
          )}
          strokeWidth={1.5}
        />
      </button>
    </th>
  );
}
function PanelHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
      <h2 className="font-semibold">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Fechar ${title}`}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
function SelectBox({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0 space-y-1.5 font-medium">
      <span>{label}</span>
      <span className="relative block">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full min-w-0 appearance-none truncate rounded-lg border border-input bg-card pl-3 pr-8 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.5}
        />
      </span>
    </label>
  );
}
function CompanyAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-foreground"
    >
      {initials}
    </span>
  );
}
function statusLabel(status: BillingKitItem["status"]) {
  return {
    available: "Disponível",
    pending: "Pendente",
    processing: "Em processamento",
  }[status];
}
function CompanyFeedback({
  state,
  onRetry,
}: {
  state: string;
  onRetry: () => void;
}) {
  // Hide the workspace notice visually; the company query and submit gating
  // still require the authenticated workspace above.
  if (state === "ready" || state === "session") return null;
  return (
    <p
      role={state === "error" ? "alert" : "status"}
      className="rounded-lg bg-secondary px-3 py-3 text-[13px] leading-relaxed text-muted-foreground"
    >
      {state === "loading" ? (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando empresas...
        </span>
      ) : state === "error" ? (
        <>
          Não foi possível carregar as empresas.
          <button
            type="button"
            onClick={onRetry}
            className="ml-2 text-primary hover:underline"
          >
            Tentar novamente
          </button>
        </>
      ) : (
        "Nenhuma empresa cadastrada neste workspace."
      )}
    </p>
  );
}
