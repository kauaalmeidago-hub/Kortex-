import { useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDown,
  Building2,
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  List,
  Mail,
  Phone,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CompanyAvatar,
  CompanyField,
  CompanyFields,
  CompanyPhoto,
} from "@/components/companies/CompanyForm";
import {
  distinct,
  formatCnpj,
  formatPhone,
  matchesCompany,
  offeringSummary,
  parseOfferings,
  type Company,
} from "@/features/companies/model";
import { listCompanies } from "@/features/companies/service";
import { useCompanyEditor } from "@/features/companies/useCompanyEditor";
import "./CompaniesPage.css";

export default function CompaniesPage() {
  const { workspace, user, loading } = useAuth();
  const query = useQuery({
    queryKey: ["companies", workspace?.id, user?.id],
    queryFn: () => listCompanies(workspace!.id),
    enabled: Boolean(workspace && user),
    staleTime: 60_000,
  });
  return (
    <CompaniesDirectory
      key={`${workspace?.id ?? "guest"}:${user?.id ?? "guest"}`}
      companies={query.data ?? []}
      workspaceId={workspace?.id}
      userId={user?.id}
      loading={loading || (Boolean(workspace && user) && query.isLoading)}
      error={query.isError ? (query.error as Error).message : ""}
      onRetry={() => void query.refetch()}
    />
  );
}
export function CompaniesDirectory({
  companies,
  workspaceId,
  userId,
  loading = false,
  error = "",
  onRetry,
}: {
  companies: Company[];
  workspaceId?: string;
  userId?: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState({
    project: "",
    product: "",
    operator: "",
  });
  const q = params.get("q") ?? "";
  const view = params.get("view") === "grid" ? "grid" : "list";
  const project = params.get("project") ?? "";
  const product = params.get("product") ?? "";
  const operator = params.get("operator") ?? "";
  const sort = params.get("sort") === "cnpj" ? "cnpj" : "name";
  const desc = params.get("direction") === "desc";
  const size = [10, 20, 50].includes(Number(params.get("size")))
    ? Number(params.get("size"))
    : 10;
  const results = useMemo(
    () =>
      companies
        .filter((c) => matchesCompany(c, q, project, product, operator))
        .sort(
          (a, b) =>
            (a[sort] ?? "").localeCompare(b[sort] ?? "", "pt-BR", {
              sensitivity: "base",
            }) * (desc ? -1 : 1),
        ),
    [companies, q, project, product, operator, sort, desc],
  );
  const pages = Math.max(1, Math.ceil(results.length / size));
  const page = Math.min(
    pages,
    Math.max(1, Math.floor(Number(params.get("page")) || 1)),
  );
  const shown = results.slice((page - 1) * size, page * size);
  const update = (changes: Record<string, string>, reset = true) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) =>
      v ? next.set(k, v) : next.delete(k),
    );
    if (reset) next.delete("page");
    setParams(next, { replace: true });
  };
  const url = (id: string) =>
    `/companies/${encodeURIComponent(id)}${location.search ? `?return=${encodeURIComponent(location.search)}` : ""}`;
  const rowClick = (e: MouseEvent, id: string) => {
    if (!(e.target as HTMLElement).closest("a,button,input")) navigate(url(id));
  };
  const filterOptions = {
    project: distinct(companies.map((c) => c.project ?? "")),
    product: distinct(
      companies.flatMap((c) =>
        parseOfferings(c.offerings).map((o) => o.product),
      ),
    ),
    operator: distinct(
      companies.flatMap((c) =>
        parseOfferings(c.offerings).map((o) => o.operator),
      ),
    ),
  };
  const active = [project, product, operator].filter(Boolean).length;
  const empty = (
    <div className="company-empty">
      <Building2 size={32} strokeWidth={1.2} />
      <p>
        {loading
          ? "Carregando empresas..."
          : error
            ? "Não foi possível carregar as empresas"
            : q || active
              ? "Nenhuma empresa encontrada"
              : "Nenhuma empresa cadastrada"}
      </p>
      <span>
        {error ||
          (!workspaceId || !userId
            ? "Entre em um workspace para consultar e cadastrar suas empresas."
            : q || active
              ? "Ajuste a pesquisa ou os filtros."
              : "Adicione uma empresa para organizar seus contatos e produtos.")}
      </span>
      {error && (
        <button type="button" className="company-button" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
  return (
    <div className="companies-theme companies-directory">
      <h1 className="sr-only">Empresas</h1>
      <div
        className="companies-toolbar"
        role="toolbar"
        aria-label="Controles de Empresas"
      >
        <div className="companies-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Buscar empresa por nome ou CNPJ"
            placeholder="Buscar empresa por nome ou CNPJ..."
            value={q}
            onChange={(e) => update({ q: e.target.value })}
          />
        </div>
        <div
          className="companies-view-toggle"
          role="group"
          aria-label="Visualização das empresas"
        >
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => update({ view: "list" }, false)}
          >
            <List size={17} />
            Lista
          </button>
          <button
            type="button"
            aria-pressed={view === "grid"}
            onClick={() => update({ view: "grid" }, false)}
          >
            <Grid2X2 size={17} />
            Grid
          </button>
        </div>
        <Popover
          open={filterOpen}
          onOpenChange={(open) => {
            setFilterOpen(open);
            if (open) setDraft({ project, product, operator });
          }}
        >
          <PopoverTrigger asChild>
            <button type="button" className="company-button">
              <SlidersHorizontal size={17} />
              Filtros
              {active > 0 && <span className="company-count">{active}</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            collisionPadding={16}
            className="companies-theme companies-filters"
          >
            <h2 className="text-sm font-semibold">Filtros</h2>
            {(
              [
                ["project", "Projeto"],
                ["product", "Produto"],
                ["operator", "Operadora"],
              ] as const
            ).map(([key, label]) => (
              <CompanyField key={key} label={label}>
                <select
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                >
                  <option value="">Todos</option>
                  {distinct([...filterOptions[key], draft[key]])
                    .sort()
                    .map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                </select>
              </CompanyField>
            ))}
            <div className="company-actions">
              <button
                type="button"
                className="company-button"
                onClick={() => {
                  setDraft({ project: "", product: "", operator: "" });
                  update({ project: "", product: "", operator: "" });
                }}
              >
                Limpar
              </button>
              <button
                type="button"
                className="company-button company-primary"
                onClick={() => {
                  update(draft);
                  setFilterOpen(false);
                }}
              >
                Aplicar filtros
              </button>
            </div>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          className="company-button company-cyan"
          ref={addTrigger}
          onClick={() => setAddOpen(true)}
        >
          <Plus size={16} />
          Adicionar empresa
        </button>
      </div>
      <div className="companies-results" aria-busy={loading}>
        {view === "list" ? (
          <div
            className="companies-table-scroll scrollbar-thin"
            role="region"
            aria-label="Lista de empresas"
          >
            <table className="companies-table">
              <caption className="sr-only">Empresas do workspace</caption>
              <thead>
                <tr>
                  {[
                    "Empresa",
                    "CNPJ",
                    "Telefone",
                    "E-mail",
                    "Projeto",
                    "Produto",
                    "Operadora",
                  ].map((label, index) => (
                    <th
                      key={label}
                      aria-sort={
                        index < 2 && sort === (index ? "cnpj" : "name")
                          ? desc
                            ? "descending"
                            : "ascending"
                          : undefined
                      }
                    >
                      {index < 2 ? (
                        <button
                          type="button"
                          onClick={() =>
                            update({
                              sort: index ? "cnpj" : "name",
                              direction:
                                sort === (index ? "cnpj" : "name") && !desc
                                  ? "desc"
                                  : "asc",
                            })
                          }
                        >
                          {label}
                          <ArrowUpDown size={13} />
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loading &&
                  !error &&
                  shown.map((company) => (
                    <tr
                      key={company.id}
                      onClick={(e) => rowClick(e, company.id)}
                    >
                      <td>
                        <div className="company-name-cell">
                          <CompanyAvatar
                            name={company.name}
                            image={company.avatarUrl}
                          />
                          <Link to={url(company.id)} title={company.name}>
                            {company.name}
                          </Link>
                        </div>
                      </td>
                      <td>{formatCnpj(company.cnpj) || "—"}</td>
                      <td>
                        {company.phone ? (
                          <a
                            href={`tel:${company.phone.replace(/[^\d+]/g, "")}`}
                          >
                            {formatPhone(company.phone)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {company.email ? (
                          <a
                            className="company-truncate"
                            href={`mailto:${company.email}`}
                            title={company.email}
                          >
                            {company.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {company.project ? (
                          <span className="company-badge">
                            {company.project}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <span
                          className="company-truncate"
                          title={offeringSummary(company, "product")}
                        >
                          {offeringSummary(company, "product") || "—"}
                        </span>
                      </td>
                      <td>
                        <span
                          className="company-truncate"
                          title={offeringSummary(company, "operator")}
                        >
                          {offeringSummary(company, "operator") || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {(loading || error || !shown.length) && empty}
          </div>
        ) : !loading && !error && shown.length > 0 ? (
          <div className="companies-grid">
            {shown.map((company) => (
              <article
                key={company.id}
                className="company-card"
                onClick={(e) => rowClick(e, company.id)}
              >
                <header>
                  <CompanyAvatar
                    name={company.name}
                    image={company.avatarUrl}
                    size="card"
                  />
                  <div>
                    <h2>
                      <Link to={url(company.id)}>{company.name}</Link>
                    </h2>
                    <p>{formatCnpj(company.cnpj) || "CNPJ não informado"}</p>
                  </div>
                </header>
                <div className="company-card-contact">
                  <Phone size={16} />
                  {company.phone ? (
                    <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`}>
                      {formatPhone(company.phone)}
                    </a>
                  ) : (
                    <span>Telefone não informado</span>
                  )}
                </div>
                <div className="company-card-contact">
                  <Mail size={16} />
                  {company.email ? (
                    <a href={`mailto:${company.email}`} title={company.email}>
                      {company.email}
                    </a>
                  ) : (
                    <span>E-mail não informado</span>
                  )}
                </div>
                <div className="company-card-classification">
                  <span>{company.project || "Projeto não informado"}</span>
                  <span>
                    {offeringSummary(company, "operator") ||
                      "Operadora não informada"}
                  </span>
                </div>
                <p className="company-card-product">
                  {offeringSummary(company, "product") ||
                    "Produto não informado"}
                </p>
              </article>
            ))}
          </div>
        ) : (
          empty
        )}
      </div>
      <footer className="companies-pagination">
        <span>
          {results.length
            ? `Mostrando ${(page - 1) * size + 1} a ${Math.min(page * size, results.length)} de ${results.length} empresas`
            : "0 empresas exibidas"}
        </span>
        <nav aria-label="Paginação das empresas">
          <button
            type="button"
            className="company-icon-button"
            aria-label="Página anterior"
            disabled={page === 1}
            onClick={() => update({ page: String(page - 1) }, false)}
          >
            <ChevronLeft size={17} />
          </button>
          <span aria-live="polite">
            {page} de {pages}
          </span>
          <button
            type="button"
            className="company-icon-button"
            aria-label="Próxima página"
            disabled={page === pages}
            onClick={() => update({ page: String(page + 1) }, false)}
          >
            <ChevronRight size={17} />
          </button>
          <select
            aria-label="Empresas por página"
            value={size}
            onChange={(e) => update({ size: e.target.value })}
          >
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
        </nav>
      </footer>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent
          className="companies-theme company-create-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            addTrigger.current?.focus();
          }}
        >
          <DialogTitle>Adicionar empresa</DialogTitle>
          <DialogDescription>
            Preencha os dados usados no perfil, na Lista e no Grid. Apenas
            Empresa é obrigatória.
          </DialogDescription>
          <DialogClose asChild>
            <button
              type="button"
              className="company-dialog-close"
              aria-label="Fechar cadastro de empresa"
            >
              <X size={18} />
            </button>
          </DialogClose>
          <CreateCompany
            workspaceId={workspaceId}
            userId={userId}
            onCancel={() => setAddOpen(false)}
            onSaved={(company) => {
              setAddOpen(false);
              navigate(url(company.id));
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
function CreateCompany({
  workspaceId,
  userId,
  onCancel,
  onSaved,
}: {
  workspaceId?: string;
  userId?: string;
  onCancel: () => void;
  onSaved: (company: Company) => void;
}) {
  const editor = useCompanyEditor(workspaceId, userId);
  return (
    <form
      className="company-create-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const saved = await editor.save();
        if (saved) onSaved(saved);
      }}
    >
      <div className="company-create-body scrollbar-thin">
        <CompanyPhoto
          name={editor.values.name}
          image={editor.imageUrl}
          onChange={editor.chooseImage}
          onRemove={editor.removeImage}
          disabled={editor.saving}
        />
        <CompanyFields
          values={editor.values}
          onChange={editor.setValues}
          disabled={editor.saving}
        />
        {(!workspaceId || !userId) && (
          <p className="company-feedback">
            Entre em um workspace para salvar o cadastro.
          </p>
        )}
        {editor.error && (
          <p role="alert" className="company-feedback company-error">
            {editor.error}
          </p>
        )}
      </div>
      <footer className="company-actions">
        <button
          type="button"
          className="company-button"
          onClick={onCancel}
          disabled={editor.saving}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="company-button company-cyan"
          disabled={editor.saving || !workspaceId || !userId}
        >
          {editor.saving ? "Salvando..." : "Salvar empresa"}
        </button>
      </footer>
    </form>
  );
}
