import { FormEvent, useMemo, useState } from "react";
import {
  Bell,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileText,
  Filter,
  MessageCircle,
  Plus,
  Search,
  Send,
  Sparkles,
  Tag,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";

type Automation = {
  id: string;
  name: string;
  description: string;
  channel: "WhatsApp";
  objective: string;
  trigger: string;
  active: boolean;
  executions24h: number;
  lastExecution: string;
  icon: typeof MessageCircle;
};

type AutomationCreationMode = "guided" | "ai-agent";

const initialAutomations: Automation[] = [
  {
    id: "1",
    name: "Boas-vindas automática",
    description: "Boas-vindas para novos contatos",
    channel: "WhatsApp",
    objective: "Boas-vindas",
    trigger: "Novo contato",
    active: true,
    executions24h: 1284,
    lastExecution: "Hoje, 10:24",
    icon: MessageCircle,
  },
  {
    id: "2",
    name: "Confirmação de atendimento",
    description: "Confirma o recebimento da mensagem",
    channel: "WhatsApp",
    objective: "Atendimento",
    trigger: "Mensagem recebida",
    active: true,
    executions24h: 892,
    lastExecution: "Hoje, 09:38",
    icon: Bell,
  },
  {
    id: "3",
    name: "Qualificação de leads",
    description: "Qualifica e coleta informações do lead",
    channel: "WhatsApp",
    objective: "Qualificação",
    trigger: "Palavra-chave",
    active: true,
    executions24h: 1532,
    lastExecution: "Hoje, 09:15",
    icon: Users,
  },
  {
    id: "4",
    name: "Agendamento de reunião",
    description: "Agenda reuniões com o time comercial",
    channel: "WhatsApp",
    objective: "Agendamento",
    trigger: "Resposta do lead",
    active: true,
    executions24h: 456,
    lastExecution: "Hoje, 08:47",
    icon: CalendarDays,
  },
  {
    id: "5",
    name: "Follow-up comercial",
    description: "Follow-up de leads não respondidos",
    channel: "WhatsApp",
    objective: "Follow-up",
    trigger: "Sem resposta",
    active: true,
    executions24h: 2176,
    lastExecution: "Hoje, 07:58",
    icon: Tag,
  },
  {
    id: "6",
    name: "Campanha de ofertas",
    description: "Envio de ofertas e novidades",
    channel: "WhatsApp",
    objective: "Campanha",
    trigger: "Lista segmentada",
    active: true,
    executions24h: 3128,
    lastExecution: "Hoje, 07:30",
    icon: Send,
  },
];

const objectives = ["Boas-vindas", "Atendimento", "Qualificação", "Agendamento", "Follow-up", "Campanha"];
const triggers = ["Novo contato", "Mensagem recebida", "Palavra-chave", "Resposta do lead", "Sem resposta", "Lista segmentada"];

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function AutomationIcon({ automation }: { automation: Automation }) {
  const Icon = automation.icon;
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#0d6efd] text-white shadow-[0_12px_26px_rgba(13,110,253,0.22)]">
      <Icon className="h-7 w-7" strokeWidth={2.2} />
    </div>
  );
}

function WhatsAppBadge() {
  return (
    <div className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#d7e4f8] bg-white px-3 text-sm font-semibold text-[#0d1b3e] shadow-sm">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#25d366] text-white">
        <MessageCircle className="h-4 w-4" />
      </span>
      WhatsApp
      <ChevronDown className="h-4 w-4 text-[#5d6f91]" />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={checked}
      onClick={onChange}
      className={`relative h-9 w-16 rounded-full transition ${checked ? "bg-[#0d6efd]" : "bg-[#c7d1df]"}`}
    >
      <span
        className={`absolute top-1 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-md transition ${
          checked ? "left-8" : "left-1"
        }`}
      />
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
    <label className="space-y-2 text-sm font-bold text-[#071451]">
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
        "h-12 w-full rounded-xl border border-[#d4e1f3] bg-white px-4 text-sm text-[#071451] outline-none transition",
        "placeholder:text-[#7082a9] focus:border-[#0d6efd] focus:ring-4 focus:ring-[#0d6efd]/10",
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
          "h-12 w-full appearance-none rounded-xl border border-[#d4e1f3] bg-white px-4 pr-10 text-sm text-[#071451] outline-none transition",
          "focus:border-[#0d6efd] focus:ring-4 focus:ring-[#0d6efd]/10 disabled:bg-[#f3f7fc] disabled:text-[#415477]",
          props.className,
        ].filter(Boolean).join(" ")}
      />
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#415477]" />
    </div>
  );
}

function NewAutomationModal({
  mode,
  onClose,
  onSave,
}: {
  mode: AutomationCreationMode;
  onClose: () => void;
  onSave: (automation: Automation) => void;
}) {
  const [activeOnSave, setActiveOnSave] = useState(true);
  const [message, setMessage] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const objective = String(data.get("objective") || "Atendimento");
    const trigger = String(data.get("trigger") || "Mensagem recebida");
    const name = String(data.get("name") || "").trim();

    if (!name) return;

    onSave({
      id: crypto.randomUUID(),
      name,
      description: message.trim() || "Automação configurada para atendimento via WhatsApp",
      channel: "WhatsApp",
      objective,
      trigger,
      active: activeOnSave,
      executions24h: 0,
      lastExecution: "Ainda não executada",
      icon: Bot,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#06112a]/35 px-6 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[760px] overflow-hidden rounded-2xl border border-[#cddced] bg-white shadow-[0_28px_90px_rgba(7,20,81,0.18)]"
      >
        <div className="flex items-start justify-between gap-5 px-8 pb-5 pt-7">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-[#071451]">Nova automação</h2>
            <p className="mt-2 text-sm text-[#5d6f91]">
              {mode === "ai-agent"
                ? "Configure o agente comercial com IA para o seu time."
                : "Configure o fluxo guiado para o seu time comercial."}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex h-11 items-center gap-2 rounded-full bg-[#eaf3ff] px-5 text-sm font-bold text-[#0d6efd]">
              <MessageCircle className="h-5 w-5" />
              WhatsApp
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[#071451] transition hover:bg-[#eef4fb]"
              aria-label="Fechar modal"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div className="grid gap-5 px-8 pb-6">
          <Field label="Nome da automação">
            <TextInput name="name" placeholder="Ex: Boas-vindas automática" required />
          </Field>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Canal">
              <SelectInput name="channel" value="WhatsApp" disabled>
                <option>WhatsApp</option>
              </SelectInput>
            </Field>
            <Field label="Objetivo">
              <SelectInput name="objective" defaultValue="">
                <option value="" disabled>Selecione um objetivo</option>
                {objectives.map((objective) => (
                  <option key={objective}>{objective}</option>
                ))}
              </SelectInput>
            </Field>
          </div>

          <Field label="Gatilho de entrada">
            <SelectInput name="trigger" defaultValue="">
              <option value="" disabled>Selecione um gatilho</option>
              {triggers.map((trigger) => (
                <option key={trigger}>{trigger}</option>
              ))}
            </SelectInput>
          </Field>

          <Field label="Mensagem inicial">
            <div className="relative">
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value.slice(0, 1000))}
                className="min-h-[132px] w-full resize-none rounded-xl border border-[#d4e1f3] bg-white px-4 py-4 text-sm text-[#071451] outline-none transition placeholder:text-[#7082a9] focus:border-[#0d6efd] focus:ring-4 focus:ring-[#0d6efd]/10"
                placeholder="Digite a mensagem que será enviada inicialmente..."
              />
              <div className="absolute bottom-4 left-4 flex items-center gap-5 text-[#415477]">
                <Sparkles className="h-5 w-5" />
                <span className="text-sm font-bold">{`{}`}</span>
                <PaperclipIcon />
              </div>
              <span className="absolute bottom-4 right-4 text-sm text-[#7082a9]">{message.length}/1000</span>
            </div>
          </Field>

          <div className="flex items-center gap-4">
            <Toggle
              checked={activeOnSave}
              onChange={() => setActiveOnSave((current) => !current)}
              ariaLabel="Ativar automação ao salvar"
            />
            <div>
              <p className="font-bold text-[#071451]">Ativar automação ao salvar</p>
              <p className="text-sm text-[#5d6f91]">A automação será criada e ativada automaticamente.</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#dbe6f4] px-8 py-5">
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-xl border border-[#d4e1f3] px-8 text-sm font-bold text-[#071451] transition hover:border-[#0d6efd] hover:text-[#0d6efd]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex h-12 items-center gap-3 rounded-xl bg-[#0d6efd] px-8 text-sm font-black text-white shadow-[0_14px_34px_rgba(13,110,253,0.24)] transition hover:bg-[#095edb]"
          >
            <Zap className="h-5 w-5" />
            Salvar e ativar
          </button>
        </div>
      </form>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.6 12.8l5.9-5.9a3.2 3.2 0 014.5 4.5l-7.1 7.1a5 5 0 01-7.1-7.1l7.4-7.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AutomationChoiceModal({
  onClose,
  onContinue,
}: {
  onClose: () => void;
  onContinue: (mode: AutomationCreationMode) => void;
}) {
  const [selected, setSelected] = useState<AutomationCreationMode>("ai-agent");
  const options = [
    {
      id: "guided" as const,
      title: "Fluxo guiado",
      description: "Monte uma automação passo a passo com gatilho, condições e ação.",
      icon: Zap,
    },
    {
      id: "ai-agent" as const,
      title: "Agente comercial com IA",
      description: "Configure um agente recomendado para qualificar, responder e encaminhar leads.",
      icon: Bot,
      recommended: true,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-6 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-card p-6 text-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Criar automação</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Escolha como deseja começar. Nada será ativado até você revisar e salvar.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:border-primary hover:text-primary"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {options.map((option) => {
            const Icon = option.icon;
            const active = selected === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelected(option.id)}
                className={`min-h-[168px] rounded-xl border p-5 text-left transition ${
                  active ? "border-primary bg-primary/10 shadow-lg shadow-primary/10" : "border-border bg-background hover:border-primary/60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  {option.recommended && (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                      Recomendado
                    </span>
                  )}
                </div>
                <h3 className="mt-4 text-lg font-bold">{option.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{option.description}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-6 rounded-xl border border-border bg-background p-4">
          <p className="text-sm font-semibold">Resumo do próximo passo</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {selected === "ai-agent"
              ? "Você seguirá para a configuração do agente, canal WhatsApp, objetivo e mensagem inicial."
              : "Você seguirá para o construtor visual de gatilho, condições e ações. A criação real depende do serviço de automações."}
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-lg border border-border px-5 text-sm font-bold transition hover:border-primary hover:text-primary"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onContinue(selected)}
            className="h-11 rounded-lg bg-primary px-6 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>(initialAutomations);
  const [query, setQuery] = useState("");
  const [creationMode, setCreationMode] = useState<AutomationCreationMode | null>(null);
  const [showChoice, setShowChoice] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  const filteredAutomations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return automations.filter((automation) => {
      const matchesSearch =
        !normalized ||
        automation.name.toLowerCase().includes(normalized) ||
        automation.objective.toLowerCase().includes(normalized) ||
        automation.trigger.toLowerCase().includes(normalized);

      const matchesFilter =
        filter === "all" ||
        (filter === "active" && automation.active) ||
        (filter === "inactive" && !automation.active);

      return matchesSearch && matchesFilter;
    });
  }, [automations, filter, query]);

  const toggleAutomation = (id: string) => {
    setAutomations((current) =>
      current.map((automation) =>
        automation.id === id ? { ...automation, active: !automation.active } : automation,
      ),
    );
  };

  const saveAutomation = (automation: Automation) => {
    setAutomations((current) => [automation, ...current]);
    setCreationMode(null);
  };

  return (
    <div className="h-full overflow-auto bg-[#f7fbff] px-8 py-7 text-[#071451] scrollbar-thin">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative w-full min-w-[320px] sm:w-[420px]">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#29466f]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-14 w-full rounded-xl border border-[#d7e4f8] bg-white pl-14 pr-4 text-base font-medium text-[#071451] outline-none shadow-sm transition placeholder:text-[#6d7f9f] focus:border-[#0d6efd] focus:ring-4 focus:ring-[#0d6efd]/10"
              placeholder="Buscar automações..."
              type="search"
            />
          </div>
          <div className="flex h-14 rounded-xl border border-[#d7e4f8] bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-lg px-4 text-sm font-bold transition ${filter === "all" ? "bg-[#eaf3ff] text-[#0d6efd]" : "text-[#071451] hover:bg-[#f1f6fd]"}`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setFilter("active")}
              className={`rounded-lg px-4 text-sm font-bold transition ${filter === "active" ? "bg-[#eaf3ff] text-[#0d6efd]" : "text-[#071451] hover:bg-[#f1f6fd]"}`}
            >
              Ativas
            </button>
            <button
              type="button"
              onClick={() => setFilter("inactive")}
              className={`rounded-lg px-4 text-sm font-bold transition ${filter === "inactive" ? "bg-[#eaf3ff] text-[#0d6efd]" : "text-[#071451] hover:bg-[#f1f6fd]"}`}
            >
              Inativas
            </button>
          </div>
          <button
            type="button"
            className="flex h-14 items-center gap-3 rounded-xl border border-[#d7e4f8] bg-white px-5 text-base font-bold text-[#071451] shadow-sm transition hover:border-[#0d6efd] hover:text-[#0d6efd]"
          >
            <Filter className="h-5 w-5" />
            Filtros
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowChoice(true)}
          className="flex h-14 items-center justify-center gap-3 rounded-xl bg-[#0d6efd] px-7 text-base font-black text-white shadow-[0_14px_34px_rgba(13,110,253,0.24)] transition hover:bg-[#095edb]"
        >
          <Plus className="h-6 w-6" />
          Criar automação
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#d7e4f8] bg-white shadow-sm">
        <table className="w-full min-w-[1180px] text-sm">
          <thead>
            <tr className="border-b border-[#dfe8f5] bg-[#fbfdff] text-left text-xs uppercase tracking-[0.08em] text-[#4d5f80]">
              <th className="px-6 py-5 font-black">Automação</th>
              <th className="px-6 py-5 font-black">Canal</th>
              <th className="px-6 py-5 font-black">Objetivo</th>
              <th className="px-6 py-5 font-black">Gatilho</th>
              <th className="px-6 py-5 font-black">Status</th>
              <th className="px-6 py-5 font-black">Execuções 24h</th>
              <th className="px-6 py-5 font-black">Última execução</th>
            </tr>
          </thead>
          <tbody>
            {filteredAutomations.map((automation) => (
              <tr key={automation.id} className="border-b border-[#dfe8f5] last:border-0 transition hover:bg-[#f8fbff]">
                <td className="px-6 py-5">
                  <div className="flex items-center gap-5">
                    <AutomationIcon automation={automation} />
                    <div>
                      <p className="text-base font-black text-[#071451]">{automation.name}</p>
                      <p className="mt-1 text-sm text-[#405579]">{automation.description}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5">
                  <WhatsAppBadge />
                </td>
                <td className="px-6 py-5">
                  <span className="rounded-lg bg-[#eaf3ff] px-4 py-2 text-sm font-bold text-[#0d6efd]">
                    {automation.objective}
                  </span>
                </td>
                <td className="px-6 py-5 text-base font-medium text-[#071451]">{automation.trigger}</td>
                <td className="px-6 py-5">
                  <div className="flex items-center gap-4">
                    <Toggle
                      checked={automation.active}
                      onChange={() => toggleAutomation(automation.id)}
                      ariaLabel={`${automation.active ? "Desativar" : "Ativar"} ${automation.name}`}
                    />
                    <span className={`flex items-center gap-2 text-sm font-black ${automation.active ? "text-[#0dbf57]" : "text-[#71819d]"}`}>
                      <span className={`h-2.5 w-2.5 rounded-full ${automation.active ? "bg-[#0dbf57]" : "bg-[#a8b4c6]"}`} />
                      {automation.active ? "Ativa" : "Inativa"}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-5 text-xl font-medium text-[#071451]">{formatNumber(automation.executions24h)}</td>
                <td className="px-6 py-5 text-base font-medium text-[#405579]">{automation.lastExecution}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#dfe8f5] px-6 py-5 text-sm text-[#405579]">
          <span>Mostrando 1 a {filteredAutomations.length} de {automations.length} automações</span>
          <div className="flex items-center gap-3">
            {[1, 2, 3, 4, 5].map((page) => (
              <button
                key={page}
                type="button"
                className={`flex h-11 w-11 items-center justify-center rounded-xl border text-base font-bold transition ${
                  page === 1
                    ? "border-[#0d6efd] bg-[#eaf3ff] text-[#0d6efd]"
                    : "border-transparent text-[#071451] hover:border-[#d7e4f8]"
                }`}
              >
                {page}
              </button>
            ))}
            <button type="button" className="h-11 rounded-xl border border-[#d7e4f8] bg-white px-5 text-base font-bold text-[#071451]">
              10 por página
              <ChevronDown className="ml-3 inline h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {filteredAutomations.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-[#d7e4f8] bg-white p-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-[#7082a9]" />
          <h2 className="mt-3 text-lg font-black">Nenhuma automação encontrada</h2>
          <p className="mt-1 text-sm text-[#5d6f91]">Ajuste a busca ou os filtros aplicados.</p>
        </div>
      )}

      {showChoice && (
        <AutomationChoiceModal
          onClose={() => setShowChoice(false)}
          onContinue={(mode) => {
            setCreationMode(mode);
            setShowChoice(false);
          }}
        />
      )}

      {creationMode && (
        <NewAutomationModal
          mode={creationMode}
          onClose={() => setCreationMode(null)}
          onSave={saveAutomation}
        />
      )}
    </div>
  );
}
