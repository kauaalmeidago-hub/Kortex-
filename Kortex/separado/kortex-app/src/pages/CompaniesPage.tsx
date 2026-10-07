import { FormEvent, useMemo, useState } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  Grid2X2,
  List,
  Mail,
  Phone,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

type Company = {
  id: string;
  name: string;
  cnpj: string;
  phone: string;
  email: string;
  project: "PF" | "PME" | "CCT";
  product: string;
  operator: string;
  responsibleContact?: string;
};

const initialCompanies: Company[] = [
  {
    id: "1",
    name: "RM Books",
    cnpj: "12.456.789/0001-40",
    phone: "(31) 98765-4321",
    email: "financeiro@rmbooks.com.br",
    project: "PME",
    product: "Saúde + Odonto",
    operator: "Hapvida",
    responsibleContact: "Mariana Costa",
  },
  {
    id: "2",
    name: "Confins Transportes",
    cnpj: "28.089.450/0001-56",
    phone: "(31) 97654-3210",
    email: "beneficios@confinstransportes.com.br",
    project: "PME",
    product: "Saúde Empresarial",
    operator: "Hapvida",
    responsibleContact: "João Ferreira",
  },
  {
    id: "3",
    name: "Cafeteria Noroeste",
    cnpj: "41.220.188/0001-22",
    phone: "(31) 96543-2109",
    email: "adm@cafeterianoroeste.com.br",
    project: "PF",
    product: "Odonto",
    operator: "NDI",
    responsibleContact: "Amanda Morais",
  },
  {
    id: "4",
    name: "Horizonte Benefícios",
    cnpj: "08.441.908/0001-17",
    phone: "(31) 95432-1098",
    email: "operacional@horizontebeneficios.com.br",
    project: "CCT",
    product: "Vida",
    operator: "NDI",
    responsibleContact: "Juliana Costa",
  },
  {
    id: "5",
    name: "Mercado Central Saúde",
    cnpj: "63.287.110/0001-88",
    phone: "(31) 94321-0987",
    email: "contato@mercadocentralsaude.com.br",
    project: "PME",
    product: "Saúde",
    operator: "Hapvida",
    responsibleContact: "Rafael Almeida",
  },
  {
    id: "6",
    name: "Prime Odonto Empresarial",
    cnpj: "50.901.337/0001-91",
    phone: "(31) 93210-9876",
    email: "cadastro@primeodonto.com.br",
    project: "CCT",
    product: "Odonto",
    operator: "NDI",
  },
  {
    id: "7",
    name: "Dantas Almeida",
    cnpj: "17.654.223/0001-08",
    phone: "(31) 92109-8765",
    email: "relacionamento@dantasalmeida.com.br",
    project: "PME",
    product: "Saúde + Odonto",
    operator: "Hapvida",
    responsibleContact: "Carlos Lima",
  },
  {
    id: "8",
    name: "Scuzatec Comercial",
    cnpj: "91.247.008/0001-66",
    phone: "(31) 91098-7654",
    email: "rh@scuzatec.com.br",
    project: "PF",
    product: "Saúde",
    operator: "NDI",
  },
];

const products = ["Saúde", "Odonto", "Vida", "Saúde + Odonto"];
const operators = ["Hapvida", "NDI", "Unimed", "SulAmérica"];
const segments = ["Saúde", "Odonto", "Vida", "Saúde + Odonto"];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function BlueAvatar({ name }: { name: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0aa7ff] to-[#004ee8] text-xs font-bold text-white shadow-[0_6px_16px_rgba(0,91,255,0.18)]">
      {initials(name)}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5 text-[13px] font-semibold text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none transition",
        "placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10",
        props.className,
      ].filter(Boolean).join(" ")}
    />
  );
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={[
          "h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[13px] text-foreground outline-none transition",
          "focus:border-primary focus:ring-4 focus:ring-primary/10",
          props.className,
        ].filter(Boolean).join(" ")}
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function ModalShell({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center sm:p-5">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-shell-title"
        className={`flex max-h-[calc(100dvh-24px)] min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:max-h-[calc(100dvh-40px)] ${wide ? "w-full max-w-[min(1040px,calc(100vw-32px))]" : "w-full max-w-[min(780px,calc(100vw-32px))]"}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-5 border-b border-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="modal-shell-title" className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:border-primary hover:text-primary"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto scrollbar-thin">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    name: "",
    cnpj: "",
    phone: "",
    email: "",
    project: "",
    product: "",
    segment: "",
    operators: [] as string[],
  });

  const filteredCompanies = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const queryDigits = normalized.replace(/\D/g, "");
    return companies.filter((company) => {
      const matchesSearch =
        !normalized ||
        company.name.toLowerCase().includes(normalized) ||
        (queryDigits.length > 0 && company.cnpj.replace(/\D/g, "").includes(queryDigits));

      const matchesText =
        (!filters.name || company.name.toLowerCase().includes(filters.name.toLowerCase())) &&
        (!filters.cnpj || company.cnpj.replace(/\D/g, "").includes(filters.cnpj.replace(/\D/g, ""))) &&
        (!filters.phone || company.phone.replace(/\D/g, "").includes(filters.phone.replace(/\D/g, ""))) &&
        (!filters.email || company.email.toLowerCase().includes(filters.email.toLowerCase()));

      const matchesSelect =
        (!filters.project || company.project === filters.project) &&
        (!filters.product || company.product === filters.product) &&
        (!filters.segment || company.product === filters.segment) &&
        (filters.operators.length === 0 || filters.operators.includes(company.operator));

      return matchesSearch && matchesText && matchesSelect;
    });
  }, [companies, filters, query]);

  const handleAddCompany = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") || "").trim();
    if (!name) return;

    setCompanies((current) => [
      {
        id: crypto.randomUUID(),
        name,
        cnpj: String(data.get("cnpj") || ""),
        phone: String(data.get("phone") || ""),
        email: String(data.get("email") || ""),
        project: String(data.get("project") || "PME") as Company["project"],
        product: String(data.get("product") || "Saúde"),
        operator: String(data.get("operator") || "Hapvida"),
        responsibleContact: String(data.get("responsibleContact") || ""),
      },
      ...current,
    ]);
    setShowAddModal(false);
  };

  const toggleOperator = (operator: string) => {
    setFilters((current) => ({
      ...current,
      operators: current.operators.includes(operator)
        ? current.operators.filter((item) => item !== operator)
        : [...current.operators, operator],
    }));
  };

  return (
    <div className="h-full overflow-auto bg-background p-3 text-foreground scrollbar-thin sm:p-4 lg:p-5">
      <div className="mb-3 flex flex-col gap-1.5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary">Empresas cadastradas</p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight">Empresas</h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground lg:text-right">
          Base operacional de clientes adquiridos, contratos e produtos vinculados.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4">
        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
                placeholder="Buscar empresa por nome ou CNPJ..."
                type="search"
              />
            </div>
            <div className="flex h-10 shrink-0 rounded-xl border border-border bg-background p-1">
              <button
                type="button"
                onClick={() => setView("list")}
                className={`flex min-w-[82px] items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${view === "list" ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <List className="h-4 w-4" />
                Lista
              </button>
              <button
                type="button"
                onClick={() => setView("grid")}
                className={`flex min-w-[76px] items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${view === "grid" ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Grid2X2 className="h-4 w-4" />
                Grid
              </button>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-nowrap">
            <button
              type="button"
              onClick={() => setShowFilters(true)}
              className="flex h-10 min-w-[110px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-background px-4 text-sm font-semibold transition hover:border-primary hover:text-primary"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="flex h-10 min-w-[176px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Adicionar empresa
            </button>
          </div>
        </div>

        {view === "list" ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-background scrollbar-thin">
          <table className="w-full min-w-[1080px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Empresa</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">CNPJ</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Telefone</th>
                <th className="px-4 py-3 font-semibold">E-mail</th>
                <th className="px-4 py-3 font-semibold">Projeto</th>
                <th className="px-4 py-3 font-semibold">Produto</th>
                <th className="px-4 py-3 font-semibold">Operadora</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.map((company) => (
                <tr key={company.id} className="border-b border-border/70 transition last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <BlueAvatar name={company.name} />
                      <span className="max-w-[230px] truncate font-semibold text-foreground" title={company.name}>{company.name}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{company.cnpj}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{company.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground"><span className="block max-w-[250px] truncate" title={company.email}>{company.email}</span></td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                      {company.project}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{company.product}</td>
                  <td className="px-4 py-3 font-semibold text-foreground">{company.operator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredCompanies.map((company) => (
            <article key={company.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <BlueAvatar name={company.name} />
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold">{company.name}</h2>
                  <p className="text-xs text-muted-foreground">{company.cnpj}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-2.5 text-[13px]">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 text-primary" />
                  {company.phone}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 text-primary" />
                  <span className="truncate">{company.email}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <span className="rounded-lg bg-muted px-2 py-1.5 text-center font-semibold">{company.project}</span>
                  <span className="col-span-2 rounded-lg bg-muted px-2 py-1.5 text-center font-semibold">{company.operator}</span>
                </div>
                <span className="rounded-lg border border-primary/20 bg-primary/10 px-2 py-1.5 text-center font-semibold text-primary">
                  {company.product}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      {filteredCompanies.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-background p-8 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-3 text-base font-bold">Nenhuma empresa encontrada</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ajuste a busca ou limpe os filtros aplicados.</p>
        </div>
      )}
      </section>

      {showAddModal && (
        <ModalShell
          title="Adicionar empresa"
          description="Cadastre apenas dados essenciais do cliente adquirido."
          onClose={() => setShowAddModal(false)}
        >
          <form onSubmit={handleAddCompany}>
            <div className="grid gap-4 px-5 py-5 sm:px-6 lg:grid-cols-2">
              <Field label="Nome da empresa">
                <TextInput name="name" placeholder="Ex.: Confins Transportes" required />
              </Field>
              <Field label="CNPJ">
                <TextInput name="cnpj" placeholder="00.000.000/0000-00" required />
              </Field>
              <Field label="Telefone">
                <TextInput name="phone" placeholder="(00) 00000-0000" required />
              </Field>
              <Field label="E-mail">
                <TextInput name="email" placeholder="empresa@email.com" type="email" required />
              </Field>
              <Field label="Projeto">
                <SelectInput name="project" defaultValue="PME">
                  <option>PF</option>
                  <option>PME</option>
                  <option>CCT</option>
                </SelectInput>
              </Field>
              <Field label="Produto">
                <SelectInput name="product" defaultValue="Saúde">
                  {products.map((product) => (
                    <option key={product}>{product}</option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Operadora">
                <SelectInput name="operator" defaultValue="Hapvida">
                  {operators.map((operator) => (
                    <option key={operator}>{operator}</option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Contato responsável">
                <TextInput name="responsibleContact" placeholder="Opcional" />
              </Field>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="h-10 rounded-xl border border-border px-5 text-sm font-bold transition hover:border-muted-foreground"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="h-10 rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90"
              >
                Salvar empresa
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {showFilters && (
        <ModalShell
          title="Filtros"
          description="Refine a base por dados cadastrais, classificação e produto."
          onClose={() => setShowFilters(false)}
          wide
        >
          <div className="px-5 py-5 sm:px-6">
            <div className="grid gap-3 lg:grid-cols-4">
              <Field label="Nome da empresa">
                <TextInput value={filters.name} onChange={(event) => setFilters({ ...filters, name: event.target.value })} />
              </Field>
              <Field label="CNPJ">
                <TextInput value={filters.cnpj} onChange={(event) => setFilters({ ...filters, cnpj: event.target.value })} />
              </Field>
              <Field label="Telefone">
                <TextInput value={filters.phone} onChange={(event) => setFilters({ ...filters, phone: event.target.value })} />
              </Field>
              <Field label="E-mail">
                <TextInput value={filters.email} onChange={(event) => setFilters({ ...filters, email: event.target.value })} />
              </Field>
            </div>

            <div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-[1fr_1.3fr_1fr_1fr]">
              <div className="min-w-0">
                <p className="mb-2 text-[13px] font-bold">Classificação</p>
                <div className="grid grid-cols-3 gap-2">
                  {["PF", "PME", "CCT"].map((project) => (
                    <button
                      key={project}
                      type="button"
                      onClick={() => setFilters({ ...filters, project: filters.project === project ? "" : project })}
                      className={`h-9 rounded-lg border text-[13px] font-bold transition ${filters.project === project ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary"}`}
                    >
                      {project}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <p className="mb-2 text-[13px] font-bold">Operadora</p>
                <div className="grid grid-cols-2 gap-2">
                  {operators.map((operator) => (
                    <button
                      key={operator}
                      type="button"
                      onClick={() => toggleOperator(operator)}
                      className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-semibold transition ${filters.operators.includes(operator) ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:border-primary"}`}
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded border ${filters.operators.includes(operator) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                        {filters.operators.includes(operator) && <Check className="h-3 w-3" />}
                      </span>
                      {operator}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Segmento">
                <SelectInput value={filters.segment} onChange={(event) => setFilters({ ...filters, segment: event.target.value })}>
                  <option value="">Todos</option>
                  {segments.map((segment) => (
                    <option key={segment}>{segment}</option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Produto">
                <SelectInput value={filters.product} onChange={(event) => setFilters({ ...filters, product: event.target.value })}>
                  <option value="">Todos</option>
                  {products.map((product) => (
                    <option key={product}>{product}</option>
                  ))}
                </SelectInput>
              </Field>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              onClick={() => setFilters({ name: "", cnpj: "", phone: "", email: "", project: "", product: "", segment: "", operators: [] })}
              className="h-10 rounded-xl border border-border px-6 text-sm font-bold transition hover:border-muted-foreground"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => setShowFilters(false)}
              className="h-10 rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90"
            >
              Aplicar filtros
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
