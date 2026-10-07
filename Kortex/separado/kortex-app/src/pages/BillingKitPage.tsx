import { FormEvent, useMemo, useState } from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Filter,
  MoreVertical,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";

type KitAvailability = "download" | "request" | "track";

type BillingKitItem = {
  id: string;
  company: string;
  operator: "Hapvida" | "NDI";
  competence: string;
  pendingAction: string;
  updatedAt: string;
  action: KitAvailability;
};

const billingItems: BillingKitItem[] = [
  {
    id: "1",
    company: "RM Books",
    operator: "Hapvida",
    competence: "09/2026",
    pendingAction: "Kit faturamento completo disponível para download.",
    updatedAt: "17/06/2025",
    action: "download",
  },
  {
    id: "2",
    company: "Cafeteria Noroeste",
    operator: "NDI",
    competence: "09/2026",
    pendingAction: "Solicitar boleto mensal ao atendimento da operadora.",
    updatedAt: "16/06/2025",
    action: "request",
  },
  {
    id: "3",
    company: "Confins Transportes",
    operator: "Hapvida",
    competence: "08/2026",
    pendingAction: "Relatório de coparticipação disponível.",
    updatedAt: "15/06/2025",
    action: "download",
  },
  {
    id: "4",
    company: "Clínica Horizonte",
    operator: "NDI",
    competence: "08/2026",
    pendingAction: "Pedido manual enviado, aguardando retorno da operadora.",
    updatedAt: "15/06/2025",
    action: "track",
  },
  {
    id: "5",
    company: "Dantas Almeida",
    operator: "Hapvida",
    competence: "08/2026",
    pendingAction: "NFS pendente de solicitação.",
    updatedAt: "14/06/2025",
    action: "request",
  },
  {
    id: "6",
    company: "ERC Logística",
    operator: "Hapvida",
    competence: "07/2026",
    pendingAction: "Boleto mensal disponível para download.",
    updatedAt: "13/06/2025",
    action: "download",
  },
  {
    id: "7",
    company: "Mercado Central Saúde",
    operator: "NDI",
    competence: "07/2026",
    pendingAction: "Kit completo em processamento pela equipe.",
    updatedAt: "12/06/2025",
    action: "track",
  },
  {
    id: "8",
    company: "Prime Odonto Empresarial",
    operator: "NDI",
    competence: "07/2026",
    pendingAction: "Solicitar relatório de coparticipação.",
    updatedAt: "11/06/2025",
    action: "request",
  },
  {
    id: "9",
    company: "Scuzatec Comercial",
    operator: "Hapvida",
    competence: "07/2026",
    pendingAction: "Kit faturamento completo disponível.",
    updatedAt: "10/06/2025",
    action: "download",
  },
  {
    id: "10",
    company: "Horizonte Benefícios",
    operator: "Hapvida",
    competence: "07/2026",
    pendingAction: "Visualizar acompanhamento da solicitação.",
    updatedAt: "09/06/2025",
    action: "track",
  },
];

const requestTypes = [
  "Boleto mensal",
  "Relatório copart",
  "NFS",
  "Kit faturamento completo",
];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function OperatorLogo({ operator }: { operator: BillingKitItem["operator"] }) {
  if (operator === "Hapvida") {
    return (
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9">
          {Array.from({ length: 6 }).map((_, index) => (
            <span
              key={index}
              className="absolute left-1/2 top-1/2 h-4 w-2 origin-[50%_18px] rounded-full bg-[#ff6a00]"
              style={{ transform: `translate(-50%, -100%) rotate(${index * 60}deg)` }}
            />
          ))}
        </div>
        <span className="font-semibold text-slate-100">Hapvida</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#0aa7ff] to-[#004ee8] text-xs font-black text-white">
        N
      </div>
      <span className="font-semibold text-slate-100">NDI</span>
    </div>
  );
}

function ActionButton({ action }: { action: KitAvailability }) {
  const config = {
    download: { label: "Download", icon: Download, className: "border-blue-400/30 text-blue-100 hover:border-blue-300 hover:bg-blue-500/15" },
    request: { label: "Solicitar", icon: FileText, className: "border-slate-500/45 text-slate-100 hover:border-blue-300 hover:bg-blue-500/15" },
    track: { label: "Acompanhar", icon: Eye, className: "border-slate-500/45 text-slate-100 hover:border-blue-300 hover:bg-blue-500/15" },
  }[action];
  const Icon = config.icon;

  return (
    <button
      type="button"
      className={`inline-flex h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${config.className}`}
    >
      <Icon className="h-5 w-5" />
      <span className="hidden 2xl:inline">{config.label}</span>
    </button>
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
    <label className="space-y-2 text-sm font-semibold text-slate-100">
      <span>{label}</span>
      {children}
    </label>
  );
}

function DarkSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className="h-12 w-full appearance-none rounded-xl border border-white/15 bg-slate-950/45 px-4 pr-10 text-sm text-slate-100 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/15"
      />
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-300" />
    </div>
  );
}

function ModalShell({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-6 backdrop-blur-sm">
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-blue-400/40 bg-[#031827] text-slate-100 shadow-[0_28px_90px_rgba(0,91,255,0.22)]">
        <div className="flex items-start justify-between gap-6 border-b border-white/10 px-8 py-6">
          <div>
            <h2 className="text-4xl font-black tracking-tight">{title}</h2>
            <p className="mt-2 text-lg text-slate-300">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 text-slate-200 transition hover:border-blue-300 hover:text-blue-200"
            aria-label="Fechar"
          >
            <X className="h-7 w-7" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function BillingKitPage() {
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showManualRequest, setShowManualRequest] = useState(false);
  const [filterOperators, setFilterOperators] = useState<BillingKitItem["operator"][]>(["Hapvida", "NDI"]);
  const [availability, setAvailability] = useState<"all" | KitAvailability>("all");
  const [selectedRequestType, setSelectedRequestType] = useState(requestTypes[0]);
  const [priorityRequest, setPriorityRequest] = useState(false);
  const [manualNotice, setManualNotice] = useState("");

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return billingItems.filter((item) => {
      const matchesSearch = !normalized || item.company.toLowerCase().includes(normalized);
      const matchesOperator = filterOperators.includes(item.operator);
      const matchesAvailability = availability === "all" || item.action === availability;
      return matchesSearch && matchesOperator && matchesAvailability;
    });
  }, [availability, filterOperators, query]);

  const toggleOperator = (operator: BillingKitItem["operator"]) => {
    setFilterOperators((current) =>
      current.includes(operator)
        ? current.filter((item) => item !== operator)
        : [...current, operator],
    );
  };

  const handleManualRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setManualNotice("Pedido não enviado: ainda não há endpoint, tabela ou fila configurada para criar pedidos manuais de faturamento.");
  };

  return (
    <div className="h-full overflow-auto bg-[#020c16] px-7 py-6 text-slate-100 scrollbar-thin">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_20%_10%,rgba(0,111,255,0.16),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(0,210,255,0.12),transparent_28%)]" />
      <div className="relative z-10">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-300">Operacional</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Kit faturamento</h1>
            <p className="mt-1 text-sm text-slate-400">
              Gere, acompanhe e baixe os arquivos de faturamento das empresas.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full min-w-[280px] xl:w-[360px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-blue-300" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-12 w-full rounded-xl border border-white/15 bg-slate-950/50 pl-12 pr-16 text-sm text-slate-100 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/15"
                placeholder="Buscar empresa..."
                type="search"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-white/10 px-2 py-1 text-xs text-slate-300">⌘ K</span>
            </div>
            <button
              type="button"
              onClick={() => setShowFilters(true)}
              className="flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-slate-950/45 px-4 text-sm font-bold transition hover:border-blue-400 hover:text-blue-200"
            >
              <Filter className="h-5 w-5" />
              Filtros
            </button>
            <button
              type="button"
              className="flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-slate-950/45 px-4 text-sm font-bold transition hover:border-blue-400 hover:text-blue-200"
            >
              <Download className="h-5 w-5" />
              Exportar
            </button>
            <button
              type="button"
              onClick={() => {
                setManualNotice("");
                setPriorityRequest(false);
                setShowManualRequest(true);
              }}
              className="flex h-12 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-[0_12px_30px_rgba(0,91,255,0.25)] transition hover:bg-blue-500"
            >
              <Plus className="h-5 w-5" />
              Novo pedido
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-blue-400/30 bg-slate-950/45 shadow-[0_20px_70px_rgba(0,0,0,0.22)]">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-sm text-slate-200">
                <th className="w-14 px-5 py-4">
                  <input type="checkbox" className="h-5 w-5 rounded border-white/30 bg-transparent" />
                </th>
                <th className="px-5 py-4 font-bold">Empresa</th>
                <th className="px-5 py-4 font-bold">Operadora</th>
                <th className="px-5 py-4 font-bold">Competência</th>
                <th className="px-5 py-4 font-bold">Pendência / Ação necessária</th>
                <th className="px-5 py-4 font-bold">Última atualização</th>
                <th className="px-5 py-4 font-bold">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className="border-b border-white/10 last:border-0 hover:bg-blue-500/5">
                  <td className="px-5 py-4">
                    <input type="checkbox" className="h-5 w-5 rounded border-white/30 bg-transparent" />
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#0aa7ff] to-[#004ee8] text-sm font-black text-white">
                        {initials(item.company)}
                      </div>
                      <span className="font-semibold">{item.company}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <OperatorLogo operator={item.operator} />
                  </td>
                  <td className="px-5 py-4 text-slate-200">{item.competence}</td>
                  <td className="max-w-[360px] px-5 py-4 text-slate-300">{item.pendingAction}</td>
                  <td className="px-5 py-4 text-slate-300">{item.updatedAt}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <ActionButton action={item.action} />
                      <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/10">
                        <MoreVertical className="h-5 w-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 px-5 py-4 text-sm text-slate-300">
            <span>Mostrando 1 a {filteredItems.length} de {billingItems.length} empresas</span>
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((page) => (
                <button
                  key={page}
                  type="button"
                  className={`flex h-10 w-10 items-center justify-center rounded-lg border ${page === 1 ? "border-blue-400 bg-blue-500/15 text-blue-200" : "border-white/10"}`}
                >
                  {page}
                </button>
              ))}
              <span className="px-2">...</span>
              <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10">25</button>
              <button type="button" className="h-10 rounded-lg border border-white/10 px-4">10 por página</button>
            </div>
          </div>
        </div>
      </div>

      {showFilters && (
        <ModalShell title="Filtros" description="Visualize itens disponíveis, pendentes ou em acompanhamento." onClose={() => setShowFilters(false)}>
          <div className="grid gap-8 px-8 py-7 md:grid-cols-[1fr_1.4fr]">
            <div>
              <div className="mb-4 flex items-center gap-3">
                <Filter className="h-6 w-6 text-blue-300" />
                <h3 className="text-xl font-bold">Operadora</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["Hapvida", "NDI"] as BillingKitItem["operator"][]).map((operator) => (
                  <button
                    key={operator}
                    type="button"
                    onClick={() => toggleOperator(operator)}
                    className={`flex h-14 items-center gap-3 rounded-xl border px-4 text-left text-lg font-bold transition ${filterOperators.includes(operator) ? "border-blue-300 bg-blue-500/15 text-blue-100" : "border-white/15 bg-slate-950/45 text-slate-300"}`}
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${filterOperators.includes(operator) ? "bg-blue-500 text-white" : "border border-white/20"}`}>
                      {filterOperators.includes(operator) && <Check className="h-5 w-5" />}
                    </span>
                    {operator}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-4 flex items-center gap-3">
                <FileText className="h-6 w-6 text-blue-300" />
                <h3 className="text-xl font-bold">Exibir somente</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["all", "Todos"],
                  ["download", "Apenas disponíveis"],
                  ["request", "Apenas pendentes"],
                  ["track", "Apenas em acompanhamento"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAvailability(value as typeof availability)}
                    className={`flex h-14 items-center gap-3 rounded-xl border px-4 text-left text-lg font-semibold transition ${availability === value ? "border-blue-300 bg-blue-500/15 text-blue-100" : "border-white/15 bg-slate-950/45 text-slate-300"}`}
                  >
                    <span className={`h-7 w-7 rounded-full border-2 ${availability === value ? "border-blue-300 bg-blue-400 shadow-[inset_0_0_0_6px_#031827]" : "border-slate-400"}`} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-4 border-t border-white/10 px-8 py-6">
            <button
              type="button"
              onClick={() => {
                setFilterOperators(["Hapvida", "NDI"]);
                setAvailability("all");
              }}
              className="h-12 rounded-xl border border-white/20 px-8 text-base font-bold transition hover:border-blue-300"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => setShowFilters(false)}
              className="h-12 rounded-xl bg-blue-600 px-9 text-base font-black text-white shadow-[0_12px_30px_rgba(0,91,255,0.24)] transition hover:bg-blue-500"
            >
              Aplicar filtros
            </button>
          </div>
        </ModalShell>
      )}

      {showManualRequest && (
        <ModalShell title="Novo pedido manual" description="Solicite a geração manual do kit faturamento para a empresa selecionada." onClose={() => setShowManualRequest(false)}>
          <form onSubmit={handleManualRequest}>
            <div className="grid gap-5 px-8 py-7">
              <Field label="Empresa">
                <DarkSelect defaultValue="Dantas Almeida">
                  {billingItems.map((item) => (
                    <option key={item.id}>{item.company}</option>
                  ))}
                </DarkSelect>
              </Field>
              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Operadora">
                  <DarkSelect defaultValue="Hapvida">
                    <option>Hapvida</option>
                    <option>NDI</option>
                  </DarkSelect>
                </Field>
                <Field label="Competência">
                  <div className="relative">
                    <Calendar className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-300" />
                    <input
                      defaultValue="09/2026"
                      className="h-12 w-full rounded-xl border border-white/15 bg-slate-950/45 pl-12 pr-4 text-sm text-slate-100 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/15"
                    />
                  </div>
                </Field>
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold text-slate-100">Tipo de pedido</p>
                <div className="grid gap-3 md:grid-cols-4">
                  {requestTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setSelectedRequestType(type)}
                      className={`flex min-h-[74px] items-center gap-3 rounded-xl border px-4 text-left text-base font-semibold transition ${selectedRequestType === type ? "border-blue-300 bg-blue-500/15 text-blue-100" : "border-white/15 bg-slate-950/45 text-slate-200 hover:border-blue-300"}`}
                    >
                      <FileText className="h-7 w-7" />
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPriorityRequest((current) => !current)}
                className="flex items-center gap-4 rounded-xl border border-white/15 bg-slate-950/45 px-4 py-4 text-left transition hover:border-blue-300"
                aria-pressed={priorityRequest}
              >
                <span className={`relative h-8 w-14 rounded-full transition ${priorityRequest ? "bg-blue-500" : "bg-slate-700"}`}>
                  <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${priorityRequest ? "left-7" : "left-1"}`} />
                </span>
                <span>
                  <span className="block text-base font-bold">Marcar como prioridade</span>
                  <span className="text-sm text-slate-300">Sinaliza o pedido para tratamento prioritário quando a integração estiver disponível.</span>
                </span>
              </button>
              {manualNotice && (
                <div className="rounded-xl border border-blue-300/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
                  {manualNotice}
                </div>
              )}
            </div>
            <div className="flex justify-between gap-4 border-t border-white/10 px-8 py-6">
              <button
                type="button"
                onClick={() => setShowManualRequest(false)}
                className="h-12 rounded-xl border border-white/20 px-8 text-base font-bold transition hover:border-blue-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex h-12 items-center gap-3 rounded-xl bg-blue-600 px-8 text-base font-black text-white shadow-[0_12px_30px_rgba(0,91,255,0.24)] transition hover:bg-blue-500"
              >
                <Send className="h-5 w-5" />
                Solicitar pedido
              </button>
            </div>
          </form>
        </ModalShell>
      )}
    </div>
  );
}
