import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  Filter,
  IdCard,
  Info,
  LockKeyhole,
  Mail,
  MapPin,
  MoreVertical,
  Paperclip,
  Phone,
  Plus,
  Search,
  Send,
  Smile,
  Trash2,
  UploadCloud,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { pipelines } from "@/data/mockData";
import {
  cancelOperation,
  createOperation,
  getOperation,
  getArtifactUrl,
  submitOperationAuthentication,
  subscribeToOperation,
  type AutomationOperationResponse,
  type AutomationOperationStatus,
} from "@/services/automationApi";
import type { OperationConnectionState } from "@/services/operationMonitoring";
import { useAuth } from "@/contexts/AuthContext";
import { validateKoaPeriod } from "@/utils/koaDate";

type ConversationStatus = "active" | "pending" | "resolved";
type ConversationTab = "all" | ConversationStatus;
type SidePanel = "koa" | "transfer" | "funnel" | null;
type KoaFlow = "inclusao" | "exclusao" | "carteirinha";
type InclusionMode = "holder" | "holder_dependents";
type ExclusionMode = "holder" | "dependent";
type KoaOperationType = "inclusion" | "exclusion" | "card";
type KoaPanelPhase =
  | "idle"
  | "form"
  | "submitting"
  | "processing"
  | "awaiting_authentication"
  | "awaiting_confirmation"
  | "cancelling"
  | "cancelled"
  | "success"
  | "error";
type KoaOperationStatus = AutomationOperationStatus;

type Message = {
  id: string;
  text: string;
  time: string;
  fromMe?: boolean;
};

type Conversation = {
  id: string;
  name: string;
  company: string;
  preview: string;
  time: string;
  initials: string;
  status: ConversationStatus;
  avatarColor: string;
  messages: Message[];
  profile: {
    cnpj?: string;
    phone?: string;
    email?: string;
    segment?: string;
    size?: string;
    origin?: string;
    address?: string;
    city?: string;
    state?: string;
    role?: string;
    notes?: string;
    companyId?: string;
  };
};

const koaLogo = "/brand/koa-ghost-static.png";
const koaLogoBody = "/brand/koa-ghost-body.png";
const koaLogoEyes = "/brand/koa-ghost-eyes.png";

const initialConversations: Conversation[] = [
  {
    id: "conv-1",
    name: "Paulo",
    company: "TRANSLOGMG LTDA",
    preview: "Boa tarde, preciso de plano para 12 funcionários.",
    time: "15:36",
    initials: "P",
    status: "active",
    avatarColor: "bg-primary",
    profile: {
      cnpj: "Dado não conectado",
      phone: "Telefone não conectado",
      email: "Canal não conectado",
      segment: "Transporte",
      size: "PME",
      origin: "Caixa de entrada",
      address: "Belo Horizonte",
      city: "Belo Horizonte",
      state: "MG",
      role: "Contato comercial",
      notes: "Solicitação registrada na sessão atual do front-end.",
    },
    messages: [
      { id: "m1", text: "Boa tarde, preciso de plano de saúde para minha empresa. Temos 12 funcionários em BH.", time: "15:30" },
      { id: "m2", text: "Boa tarde Paulo! Vou verificar as melhores opções para vocês. O CNAE da empresa é qual?", time: "15:32", fromMe: true },
      { id: "m3", text: "É transporte rodoviário de carga, CNAE 4930-2/02.", time: "15:34" },
      { id: "m4", text: "Precisamos de cobertura nacional se possível.", time: "15:36" },
    ],
  },
  {
    id: "conv-2",
    name: "Thiago",
    company: "Comercial",
    preview: "Não consegui entrar em contato com o responsável.",
    time: "14:20",
    initials: "T",
    status: "pending",
    avatarColor: "bg-amber-500",
    profile: { origin: "WhatsApp", notes: "Aguardando retorno." },
    messages: [
      { id: "m1", text: "Não consegui entrar em contato com o responsável.", time: "14:20" },
    ],
  },
  {
    id: "conv-3",
    name: "Dpto. Operações VNR",
    company: "Salesbot: Norma",
    preview: "Sabe o plano que você cotou anteriormente?",
    time: "13:55",
    initials: "DO",
    status: "active",
    avatarColor: "bg-emerald-500",
    profile: { origin: "Indicação", segment: "Operações" },
    messages: [
      { id: "m1", text: "Sabe o plano que você cotou anteriormente?", time: "13:55" },
    ],
  },
  {
    id: "conv-4",
    name: "Fernanda",
    company: "Comercial",
    preview: "Na região de Conselheiro Lafaiete, o atendimento cobre?",
    time: "12:40",
    initials: "F",
    status: "resolved",
    avatarColor: "bg-pink-500",
    profile: { city: "Conselheiro Lafaiete", state: "MG", origin: "Site" },
    messages: [
      { id: "m1", text: "Na região de Conselheiro Lafaiete, o atendimento cobre?", time: "12:40" },
      { id: "m2", text: "Cobre sim. Encaminhei as opções disponíveis para conferência.", time: "12:49", fromMe: true },
    ],
  },
];

const tabOptions: Array<{ id: ConversationTab; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "active", label: "Em atendimento" },
  { id: "pending", label: "Pendentes" },
  { id: "resolved", label: "Resolvidos" },
];

function statusLabel(status: ConversationStatus) {
  return {
    active: "Em atendimento",
    pending: "Pendente",
    resolved: "Resolvida",
  }[status];
}

function formatNow() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function normalizeIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function detectKoaIntent(value: string): KoaFlow | null {
  const text = normalizeIntentText(value);

  if (/(carteirinha|segunda via|2a via|2 via|emitir|emissao|emissao)/.test(text)) return "carteirinha";
  if (/(excluir|exclusao|remover|cancelar|retirar|desligar)/.test(text)) return "exclusao";
  if (/(incluir|inclusao|adicionar|cadastrar|entrada)/.test(text)) return "inclusao";
  return null;
}

const koaFlowCopy: Record<KoaFlow, { user: string; assistant: string; title: string; cta: string }> = {
  inclusao: {
    user: "Quero incluir um beneficiário.",
    assistant: "Perfeito! Preencha os dados abaixo para iniciar a solicitação.",
    title: "Inclusão de beneficiário",
    cta: "Enviar solicitação",
  },
  exclusao: {
    user: "Quero excluir um beneficiário.",
    assistant: "Perfeito! Preencha os dados abaixo para iniciar a solicitação.",
    title: "Exclusão de beneficiário",
    cta: "Enviar solicitação",
  },
  carteirinha: {
    user: "Quero emitir uma carteirinha.",
    assistant: "Perfeito! Preencha os dados abaixo para emitir a carteirinha.",
    title: "Emissão de carteirinha",
    cta: "Emitir carteirinha",
  },
};

function ConversationList({
  conversations,
  activeId,
  tab,
  query,
  onQueryChange,
  onTabChange,
  onSelect,
  onMoveStatus,
}: {
  conversations: Conversation[];
  activeId: string;
  tab: ConversationTab;
  query: string;
  onQueryChange: (value: string) => void;
  onTabChange: (value: ConversationTab) => void;
  onSelect: (id: string) => void;
  onMoveStatus: (id: string, status: ConversationStatus) => void;
}) {
  const counts = useMemo(
    () => ({
      all: conversations.length,
      active: conversations.filter((conversation) => conversation.status === "active").length,
      pending: conversations.filter((conversation) => conversation.status === "pending").length,
      resolved: conversations.filter((conversation) => conversation.status === "resolved").length,
    }),
    [conversations],
  );

  const filtered = conversations.filter((conversation) => {
    const matchesTab = tab === "all" || conversation.status === tab;
    const term = query.trim().toLowerCase();
    const matchesQuery =
      !term ||
      conversation.name.toLowerCase().includes(term) ||
      conversation.company.toLowerCase().includes(term) ||
      conversation.preview.toLowerCase().includes(term);
    return matchesTab && matchesQuery;
  });

  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-border bg-card md:h-full md:w-[330px] md:min-w-[330px] md:border-b-0 md:border-r xl:w-[360px] xl:min-w-[360px]">
      <div className="flex shrink-0 items-center gap-3 p-4 pb-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar atendimentos</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-10 w-full rounded-xl border border-input bg-background/70 pl-10 pr-3 text-sm font-normal outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            placeholder="Buscar atendimentos..."
            type="search"
          />
        </label>
      </div>

      <div className="flex shrink-0 gap-5 overflow-x-auto border-b border-border px-4 scrollbar-thin">
        {tabOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onTabChange(option.id)}
            onDragOver={(event) => {
              if (option.id !== "all") event.preventDefault();
            }}
            onDrop={(event) => {
              const id = event.dataTransfer.getData("text/conversation-id");
              if (id && option.id !== "all") onMoveStatus(id, option.id);
            }}
            className={`relative h-11 shrink-0 px-0 text-sm font-normal transition-colors ${
              tab === option.id ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label} ({counts[option.id]})
            {tab === option.id && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="p-5 text-sm text-muted-foreground">Nenhuma conversa encontrada nesta lista.</div>
        ) : (
          filtered.map((conversation) => {
            const active = conversation.id === activeId;
            return (
              <button
                key={conversation.id}
                type="button"
                draggable
                onDragStart={(event) => event.dataTransfer.setData("text/conversation-id", conversation.id)}
                onClick={() => onSelect(conversation.id)}
                className={`flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors ${
                  active ? "bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]" : "hover:bg-secondary/70"
                }`}
              >
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${conversation.avatarColor}`}>
                  {conversation.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{conversation.name}</span>
                    <span className="ml-auto shrink-0 text-xs font-normal text-primary">{conversation.time}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{conversation.company}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">{conversation.preview}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

function ProfilePanel({ conversation }: { conversation: Conversation }) {
  const fields = [
    { icon: Building2, label: "Empresa", value: conversation.company },
    { icon: FileText, label: "CNPJ", value: conversation.profile.cnpj },
    { icon: Phone, label: "Telefone", value: conversation.profile.phone },
    { icon: Mail, label: "E-mail", value: conversation.profile.email },
    { icon: Filter, label: "Segmento", value: conversation.profile.segment },
    { icon: Users, label: "Porte", value: conversation.profile.size },
    { icon: MapPin, label: "Cidade", value: conversation.profile.city },
    { icon: MapPin, label: "Estado", value: conversation.profile.state },
    { icon: Users, label: "Responsável", value: conversation.name },
    { icon: IdCard, label: "Cargo", value: conversation.profile.role },
    { icon: FileText, label: "Observações", value: conversation.profile.notes },
  ].filter((field) => field.value);

  return (
    <section className="grid shrink-0 gap-2 border-b border-border bg-card/80 p-3 shadow-sm sm:grid-cols-2 xl:grid-cols-3">
      {fields.map(({ icon: Icon, label, value }) => (
        <div key={label} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background/70 px-3 py-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary">
            <Icon className="h-4 w-4" strokeWidth={1.5} />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-normal text-muted-foreground">{label}</span>
            <span className="block truncate text-sm font-medium text-foreground">{value}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

function ChatArea({
  conversation,
  panel,
  onOpenPanel,
  onSend,
  onResolve,
}: {
  conversation: Conversation;
  panel: SidePanel;
  onOpenPanel: (panel: SidePanel) => void;
  onSend: (conversationId: string, message: string) => void;
  onResolve: (conversationId: string) => void;
}) {
  const [input, setInput] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages]);

  useEffect(() => {
    setShowMenu(false);
  }, [conversation.id]);

  const handleSend = () => {
    const value = input.trim();
    if (!value) return;
    onSend(conversation.id, value);
    setInput("");
  };

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <button
          type="button"
          onClick={() => setShowProfile((current) => !current)}
          className="flex min-w-0 items-center gap-3 rounded-xl pr-3 text-left outline-none transition hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-primary/25"
        >
          <span className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${conversation.avatarColor}`}>
            {conversation.initials}
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-emerald-500" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-lg font-semibold leading-tight tracking-normal text-foreground">{conversation.name}</span>
            <span className="block text-sm font-normal text-muted-foreground">{statusLabel(conversation.status)}</span>
          </span>
        </button>

        <div className="relative flex items-center gap-2">
          <button
            type="button"
            disabled
            title="Ligação indisponível sem integração de telefonia"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground opacity-55"
          >
            <Phone className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            disabled
            title="Vídeo indisponível sem integração ativa"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground opacity-55"
          >
            <Video className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => onOpenPanel(panel === "transfer" ? null : "transfer")}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-primary transition hover:border-primary/40 hover:bg-primary/10"
            aria-label="Transferir conversa"
          >
            <ArrowRightLeft className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => setShowMenu((current) => !current)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-primary transition hover:border-primary/40 hover:bg-primary/10"
            aria-expanded={showMenu}
            aria-label="Mais ações"
          >
            <MoreVertical className="h-5 w-5" strokeWidth={1.5} />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-12 z-30 w-64 rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl">
              <MenuAction imageSrc={koaLogo} label="Koa" onClick={() => { onOpenPanel("koa"); setShowMenu(false); }} />
              <MenuAction icon={Filter} label="Transferir para funil" onClick={() => { onOpenPanel("funnel"); setShowMenu(false); }} />
              <MenuAction icon={CheckCircle2} label="Finalizar conversa" onClick={() => { onResolve(conversation.id); setShowMenu(false); }} />
            </div>
          )}
        </div>
      </header>

      {showProfile && <ProfilePanel conversation={conversation} />}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 scrollbar-thin sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <div className="self-center rounded-full bg-card px-4 py-1 text-xs font-normal text-muted-foreground shadow-sm">
            Hoje
          </div>
          {conversation.messages.map((message) => (
            <div key={message.id} className={`flex items-end gap-3 ${message.fromMe ? "justify-end" : "justify-start"}`}>
              {!message.fromMe && (
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${conversation.avatarColor}`}>
                  {conversation.initials}
                </span>
              )}
              <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm font-normal leading-relaxed ${
                message.fromMe
                  ? "rounded-br-md bg-primary text-primary-foreground shadow-[0_12px_30px_rgba(36,121,219,0.18)]"
                  : "rounded-bl-md border border-border bg-card text-foreground shadow-sm"
              }`}>
                {message.text}
                <div className={`mt-2 text-xs ${message.fromMe ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                  {message.time}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEnd} />
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-card p-3 sm:p-4">
        <div className="inbox-message-composer flex items-center gap-2">
          <button type="button" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border text-primary transition hover:bg-primary/10" aria-label="Anexar arquivo">
            <Paperclip className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <button type="button" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border text-primary transition hover:bg-primary/10" aria-label="Inserir emoji">
            <Smile className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSend();
              }
            }}
            className="h-12 min-w-[120px] flex-1 rounded-xl border border-input bg-background px-4 text-sm font-normal outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            placeholder="Digite uma mensagem..."
          />
          <button
            type="button"
            onClick={handleSend}
            className="inbox-message-send flex h-12 w-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-0 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            <Send className="h-5 w-5" strokeWidth={1.5} />
            <span className="inbox-message-send-label">Enviar</span>
          </button>
        </div>
      </footer>
    </section>
  );
}

function MenuAction({
  icon: Icon,
  imageSrc,
  label,
  onClick,
}: {
  icon?: React.ElementType;
  imageSrc?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-foreground transition hover:bg-secondary"
    >
      {imageSrc ? (
        <img src={imageSrc} alt="" className="h-5 w-5 shrink-0 object-contain" />
      ) : Icon ? (
        <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
      ) : null}
      {label}
    </button>
  );
}

function SidePanelView({
  panel,
  conversation,
  onClose,
  isClosing,
}: {
  panel: Exclude<SidePanel, null>;
  conversation: Conversation;
  onClose: () => void;
  isClosing: boolean;
}) {
  if (panel === "koa") return <KoaPanel conversation={conversation} onClose={onClose} isClosing={isClosing} />;
  if (panel === "transfer") return <TransferPanel conversation={conversation} onClose={onClose} isClosing={isClosing} />;
  return <FunnelPanel conversation={conversation} onClose={onClose} isClosing={isClosing} />;
}

function PanelShell({
  title,
  description,
  icon: Icon,
  children,
  onClose,
  isClosing,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
  onClose: () => void;
  isClosing: boolean;
}) {
  return (
    <aside className={`absolute inset-y-0 right-0 z-20 flex w-full max-w-[420px] flex-col border-l border-border bg-card shadow-2xl md:w-[420px] ${isClosing ? "koa-panel-exit" : "koa-panel-enter"}`}>
      <header className="flex shrink-0 items-start justify-between border-b border-border p-5">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-tight tracking-normal text-foreground">{title}</h2>
            <p className="mt-1 text-sm font-normal text-muted-foreground">{description}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground" aria-label="Fechar painel">
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">{children}</div>
    </aside>
  );
}

type KoaAttachment = {
  id: string;
  name: string;
  size: number;
};

type KoaDependent = {
  id: string;
  fullName: string;
  cpf: string;
  birthDate: string;
  relationship: string;
};

type KoaFormValues = {
  inclusionType: InclusionMode;
  exclusionType: ExclusionMode;
  contractCode: string;
  companyAccess: string;
  password: string;
  beneficiaryName: string;
  cpf: string;
  birthDate: string;
  startDate: string;
  endDate: string;
  titularUserCode: string;
  exclusionReason: string;
  dependentName: string;
  dependentCpf: string;
  titularName: string;
  relationship: string;
  dependents: KoaDependent[];
  attachments: KoaAttachment[];
};

type KoaOperation = {
  id: string;
  type: KoaOperationType;
  status: KoaOperationStatus;
  createdAt: string;
  updatedAt: string;
  result?: {
    beneficiaryName?: string;
    beneficiaryCpfMasked?: string;
    contractCode?: string;
    cancellationReason?: string;
    effectiveCancellationDate?: string;
    dependentsFound?: Array<{ code?: string; name?: string; birthDate?: string }>;
    cnsNumber?: string;
    unit?: string;
    plan?: string;
    documents?: number;
    prepareOnly?: boolean;
    submissionConfirmed?: boolean;
    portalStatusCode?: string;
    portalStatusLabel?: string;
    status?: string;
    protocol?: string;
    fileName?: string;
    artifactUrl?: string;
  };
  error?: {
    code?: string;
    message: string;
    safeDetails?: string;
    retryable?: boolean;
  };
  artifacts?: AutomationOperationResponse["artifacts"];
};

type KoaSubmittedSummary = {
  title: string;
  detail?: string;
  attachmentCount?: number;
};

type KoaChatEntry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "form"; flow: KoaFlow }
  | { id: string; kind: "submitted"; flow: KoaFlow; summary: KoaSubmittedSummary }
  | { id: string; kind: "operation"; operationId: string };

function createInitialKoaValues(): KoaFormValues {
  return {
    inclusionType: "holder",
    exclusionType: "holder",
    contractCode: "",
    companyAccess: "",
    password: "",
    beneficiaryName: "",
    cpf: "",
    birthDate: "",
    startDate: "",
    endDate: "",
    titularUserCode: "",
    exclusionReason: "",
    dependentName: "",
    dependentCpf: "",
    titularName: "",
    relationship: "",
    dependents: [createDependent()],
    attachments: [],
  };
}

function createDependent(): KoaDependent {
  return {
    id: `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fullName: "",
    cpf: "",
    birthDate: "",
    relationship: "",
  };
}

function createAttachment(file: File): KoaAttachment {
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    size: file.size,
  };
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function operationTypeFromFlow(flow: KoaFlow): KoaOperationType {
  if (flow === "inclusao") return "inclusion";
  if (flow === "exclusao") return "exclusion";
  return "card";
}

function automationTypeFromFlow(flow: KoaFlow) {
  if (flow === "carteirinha") return "CARD_ISSUE" as const;
  if (flow === "inclusao") return "INCLUSION_HOLDER" as const;
  return "EXCLUSION_HOLDER" as const;
}

function createKoaEntryId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isActiveKoaOperationStatus(status?: KoaOperationStatus) {
  return (
    status === "queued" ||
    status === "starting" ||
    status === "authenticating" ||
    status === "accessing_portal" ||
    status === "checking_active_users" ||
    status === "checking_cns" ||
    status === "checking_cpf" ||
    status === "generating_cpf_document" ||
    status === "validating_documents" ||
    status === "opening_inclusion" ||
    status === "filling_registration" ||
    status === "selecting_plan" ||
    status === "uploading_documents" ||
    status === "filling_health_questionnaire" ||
    status === "processing" ||
    status === "submitting" ||
    status === "checking_movement_status" ||
    status === "capturing_evidence" ||
    status === "verifying" ||
    status === "cancelling"
  );
}

function phaseFromOperationStatus(status: KoaOperationStatus): KoaPanelPhase {
  if (status === "success") return "success";
  if (status === "error" || status === "manual_review") return "error";
  if (status === "awaiting_authentication") return "awaiting_authentication";
  if (status === "awaiting_confirmation") return "awaiting_confirmation";
  if (status === "awaiting_human_verification") return "error";
  if (status === "submission_confirmed") return "success";
  if (status === "cancelled") return "cancelled";
  if (status === "cancelling") return "cancelling";
  return "processing";
}

function safeKoaErrorMessage(code?: string) {
  if (code === "REAUTH_REQUIRED") return "É necessário renovar o acesso à Hapvida.";
  if (code === "CREDENTIAL_NOT_FOUND") return "Credencial segura não encontrada.";
  if (code === "BENEFICIARY_NOT_FOUND") return "Beneficiário não encontrado.";
  if (code === "BENEFICIARY_NOT_ACTIVE") return "Beneficiário não está ativo na Hapvida.";
  if (code === "BENEFICIARY_ALREADY_ACTIVE") return "Beneficiário já está ativo na Hapvida.";
  if (code === "CNS_LOOKUP_FAILED") return "Não consegui consultar o CNS.";
  if (code === "CNS_NOT_FOUND") return "CNS não encontrado para o beneficiário.";
  if (code === "CNS_IDENTITY_MISMATCH") return "Os dados do CNS não conferem com a solicitação.";
  if (code === "CNS_CAPTCHA_REQUIRED") return "A consulta CNS exige verificação humana.";
  if (code === "CPF_LOOKUP_FAILED") return "Não consegui consultar a situação do CPF.";
  if (code === "CPF_IDENTITY_MISMATCH") return "Os dados da Receita não conferem com a solicitação.";
  if (code === "CPF_CAPTCHA_REQUIRED") return "A Receita Federal exige verificação humana.";
  if (code === "CPF_STATUS_REVIEW_REQUIRED") return "A situação cadastral do CPF exige revisão.";
  if (code === "CPF_DOCUMENT_GENERATION_FAILED") return "Não consegui gerar o comprovante do CPF.";
  if (code === "PLAN_SELECTION_REQUIRED") return "Unidade Empresa e Plano precisam ser informados.";
  if (code === "MISSING_REQUIRED_DATA") return "Faltam dados obrigatórios para continuar.";
  if (code === "INVALID_ATTACHMENT_TYPE") return "Um dos anexos possui tipo inválido.";
  if (code === "ATTACHMENT_TOO_LARGE") return "Um dos anexos ultrapassa o limite permitido.";
  if (code === "HEALTH_ANSWERS_REQUIRED") return "A declaração de saúde precisa ser informada.";
  if (code === "HEALTH_DETAIL_REQUIRED") return "Uma resposta positiva da saúde precisa de detalhe.";
  if (code === "DEPENDENT_ALREADY_ACTIVE") return "Dependente já está ativo na Hapvida.";
  if (code === "HOLDER_NOT_ACTIVE") return "Titular responsável não está ativo na Hapvida.";
  if (code === "BENEFICIARY_TYPE_MISMATCH") return "O tipo do beneficiário não confere com a movimentação.";
  if (code === "BENEFICIARY_AMBIGUOUS") return "Encontrei mais de um beneficiário possível.";
  if (code === "ACTIVE_USERS_LIST_UNAVAILABLE") return "Não consegui validar a lista de usuários ativos.";
  if (code === "MOVEMENT_STATUS_UNAVAILABLE") return "Não consegui abrir o Status de Movimentação.";
  if (code === "MOVEMENT_STATUS_NOT_FOUND") return "Não encontrei a movimentação no status do portal.";
  if (code === "SUBMISSION_STATUS_UNKNOWN") return "Não consegui confirmar se a solicitação foi registrada.";
  if (code === "MOVEMENT_EVIDENCE_FAILED") return "Não consegui gerar o comprovante da movimentação.";
  if (code === "DOWNLOAD_VALIDATION_FAILED") return "Não consegui validar o arquivo da carteirinha.";
  if (code === "PDF_VALIDATION_FAILED") return "Não consegui validar o PDF da carteirinha.";
  if (code === "CARD_VALIDATION_FAILED") return "A carteirinha gerada não confere com os dados informados.";
  if (code === "INVALID_PERIOD") return "Não foi possível emitir a carteirinha porque o período informado é inválido.";
  if (code === "AUTHENTICATION_FAILED") return "Não consegui autenticar no portal da operadora.";
  if (code === "AUTHENTICATION_ATTEMPTS_EXCEEDED") return "O limite de tentativas de autenticação foi atingido.";
  if (code === "WORKFLOW_DISABLED") return "Essa movimentação ainda não está liberada para automação real.";
  if (code === "BENEFICIARY_VALIDATION_FAILED") return "Os dados retornados pelo portal não conferem com a solicitação.";
  if (code === "CANCELLATION_REASON_REQUIRED") return "O motivo informado não foi encontrado no portal.";
  if (code === "ATTACHMENT_UPLOAD_FAILED") return "Não foi possível preparar os anexos para o portal.";
  if (code === "PORTAL_CHANGED") return "O portal mudou e precisa de revisão.";
  if (code === "PORTAL_TIMEOUT") return "O portal demorou mais que o esperado.";
  return "Não foi possível concluir a movimentação.";
}

function mapAutomationOperation(response: AutomationOperationResponse, type: KoaOperationType): KoaOperation {
  const firstArtifact = response.artifacts[0];
  const artifactUrl = firstArtifact ? firstArtifact.url || getArtifactUrl(response.operationId, firstArtifact.fileName) : undefined;

  return {
    id: response.operationId,
    type,
    status: response.status,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    result: response.result
      ? {
          beneficiaryName: typeof response.result.beneficiaryName === "string" ? response.result.beneficiaryName : undefined,
          beneficiaryCpfMasked: typeof response.result.beneficiaryCpfMasked === "string" ? response.result.beneficiaryCpfMasked : undefined,
          contractCode: typeof response.result.contractCode === "string" ? response.result.contractCode : undefined,
          cancellationReason: typeof response.result.cancellationReason === "string" ? response.result.cancellationReason : undefined,
          effectiveCancellationDate:
            typeof response.result.effectiveCancellationDate === "string" ? response.result.effectiveCancellationDate : undefined,
          cnsNumber: typeof response.result.cnsNumber === "string" ? response.result.cnsNumber : undefined,
          unit: typeof response.result.unit === "string" ? response.result.unit : undefined,
          plan: typeof response.result.plan === "string" ? response.result.plan : undefined,
          documents: typeof response.result.documents === "number" ? response.result.documents : undefined,
          dependentsFound: Array.isArray(response.result.dependentsFound)
            ? (response.result.dependentsFound as Array<{ code?: string; name?: string; birthDate?: string }>)
            : undefined,
          prepareOnly: response.result.prepareOnly === true,
          submissionConfirmed: response.result.submissionConfirmed === true,
          portalStatusCode: typeof response.result.portalStatusCode === "string" ? response.result.portalStatusCode : undefined,
          portalStatusLabel: typeof response.result.portalStatusLabel === "string" ? response.result.portalStatusLabel : undefined,
          status:
            typeof response.result.portalStatusLabel === "string"
              ? response.result.portalStatusLabel
              : typeof response.result.portalStatus === "string"
                ? response.result.portalStatus
                : undefined,
          protocol: typeof response.result.protocol === "string" ? response.result.protocol : undefined,
          fileName: firstArtifact?.fileName,
          artifactUrl,
        }
      : firstArtifact
        ? { fileName: firstArtifact.fileName, artifactUrl }
        : undefined,
    error: response.error
      ? {
          code: response.error.code,
          message: safeKoaErrorMessage(response.error.code),
          safeDetails: response.error.safeDetails,
          retryable: response.error.retryable,
        }
      : undefined,
    artifacts: response.artifacts,
  };
}

function resolveKoaCompanyId(conversation: Conversation) {
  return import.meta.env.VITE_KOA_DEFAULT_COMPANY_ID ?? conversation.profile.companyId;
}

function operationProcessingMessage(type: KoaOperationType) {
  return {
    inclusion: "Processando sua inclusão...",
    exclusion: "Processando sua exclusão...",
    card: "Processando a emissão da carteirinha...",
  }[type];
}

function operationStatusMessage(status: KoaOperationStatus, type: KoaOperationType) {
  if (status === "queued") return "Aguardando processamento...";
  if (status === "starting") return "Iniciando operação...";
  if (status === "authenticating") return "Acessando a operadora...";
  if (status === "accessing_portal") return "Acessando o portal...";
  if (status === "checking_active_users") return "Validando os usuários ativos da empresa...";
  if (status === "checking_cns") return "Consultando o CNS...";
  if (status === "checking_cpf") return "Validando o CPF na Receita...";
  if (status === "awaiting_authentication") return "Aguardando autenticação Hapvida...";
  if (status === "generating_cpf_document") return "Gerando comprovante do CPF...";
  if (status === "validating_documents") return "Validando documentos...";
  if (status === "opening_inclusion") return "Abrindo inclusão de titular...";
  if (status === "filling_registration") return "Preenchendo cadastro...";
  if (status === "selecting_plan") return "Selecionando unidade e plano...";
  if (status === "uploading_documents") return "Enviando documentos...";
  if (status === "filling_health_questionnaire") return "Preenchendo questionário de saúde...";
  if (status === "awaiting_confirmation") return "Aguardando confirmação...";
  if (status === "submitting") return "Enviando a solicitação no portal...";
  if (status === "checking_movement_status") return "Consultando Status de Movimentação...";
  if (status === "capturing_evidence") return "Gerando comprovante da movimentação...";
  if (status === "verifying") return "Validando a carteirinha...";
  return operationProcessingMessage(type);
}

function operationSuccessMessage(type: KoaOperationType) {
  return {
    inclusion: "Inclusão realizada com sucesso.",
    exclusion: "Solicitação de exclusão registrada no portal.",
    card: "Carteirinha emitida com sucesso.",
  }[type];
}

function buildSubmittedSummary(flow: KoaFlow, values: KoaFormValues): KoaSubmittedSummary {
  if (flow === "carteirinha") {
    return {
      title: "Solicitação de carteirinha enviada",
      detail: values.beneficiaryName ? `Beneficiário: ${values.beneficiaryName}` : undefined,
    };
  }

  if (flow === "inclusao") {
    const dependentCount = values.inclusionType === "holder_dependents" ? values.dependents.length : 0;
    return {
      title: "Solicitação de inclusão enviada",
      detail: dependentCount > 0 ? `Titular com ${dependentCount} dependente${dependentCount > 1 ? "s" : ""}` : "Somente titular",
      attachmentCount: values.attachments.length || undefined,
    };
  }

  return {
    title: "Solicitação de exclusão enviada",
    detail: values.exclusionType === "dependent" ? "Exclusão de dependente" : "Exclusão de titular",
    attachmentCount: values.attachments.length || undefined,
  };
}

function KoaPanel({
  conversation,
  onClose,
  isClosing,
}: {
  conversation: Conversation;
  onClose: () => void;
  isClosing: boolean;
}) {
  const { user, workspace } = useAuth();
  const [selectedFlow, setSelectedFlow] = useState<KoaFlow | null>(null);
  const [phase, setPhase] = useState<KoaPanelPhase>("idle");
  const [history, setHistory] = useState<KoaChatEntry[]>([]);
  const [message, setMessage] = useState("");
  const [helperText, setHelperText] = useState<string | null>(null);
  const [values, setValues] = useState<KoaFormValues>(() => createInitialKoaValues());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [operation, setOperation] = useState<KoaOperation | null>(null);
  const [operationConnectionState, setOperationConnectionState] = useState<OperationConnectionState>("live");
  const historyEndRef = useRef<HTMLDivElement>(null);
  const cancelInFlightRef = useRef(false);
  const operationUnsubscribeRef = useRef<(() => void) | null>(null);
  const flows = [
    { id: "inclusao" as const, label: "Inclusão", icon: UserPlus },
    { id: "exclusao" as const, label: "Exclusão", icon: UserMinus },
    { id: "carteirinha" as const, label: "Carteirinha", icon: CreditCard },
  ];

  useEffect(() => {
    if (!selectedFlow) return;
    historyEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [selectedFlow, history.length, operation?.status, operation?.updatedAt]);

  useEffect(() => {
    return () => {
      operationUnsubscribeRef.current?.();
      operationUnsubscribeRef.current = null;
    };
  }, []);

  const openFlow = (flow: KoaFlow, sourceText = "") => {
    const text = normalizeIntentText(sourceText);
    setSelectedFlow(flow);
    setPhase("form");
    setHelperText(null);
    setErrors({});
    setOperation(null);
    setOperationConnectionState("live");
    const initialValues = createInitialKoaValues();
    setValues({
      ...initialValues,
      inclusionType: flow === "inclusao" && /dependente|dependentes/.test(text) ? "holder_dependents" : initialValues.inclusionType,
      exclusionType: flow === "exclusao" && /dependente|dependentes/.test(text) ? "dependent" : initialValues.exclusionType,
    });
    setHistory([
      { id: createKoaEntryId("user"), kind: "user", text: koaFlowCopy[flow].user },
      { id: createKoaEntryId("assistant"), kind: "assistant", text: koaFlowCopy[flow].assistant },
      { id: createKoaEntryId("form"), kind: "form", flow },
    ]);
  };

  const handleMessageSubmit = () => {
    if (phase === "processing" || phase === "submitting" || phase === "cancelling") return;
    const trimmed = message.trim();
    if (!trimmed) return;

    const flow = detectKoaIntent(trimmed);
    if (flow) {
      openFlow(flow, trimmed);
    } else {
      setHelperText("Me diga se deseja inclusão, exclusão ou carteirinha.");
    }
    setMessage("");
  };

  const handleSubmitFlow = async () => {
    if (!selectedFlow) return;
    setPhase("submitting");
    setHelperText(null);
    const nextErrors = validateKoaValues(selectedFlow, values);

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setPhase("form");
      return;
    }

    if (selectedFlow === "exclusao" && values.attachments.length > 0) {
      setHelperText("Anexos para exclusão ainda não estão conectados ao worker. Remova os anexos para preparar sem documento.");
      setPhase("form");
      return;
    }

    const type = operationTypeFromFlow(selectedFlow);
    let cardPeriod: { periodStart: string; periodEnd: string } | null = null;
    if (selectedFlow === "carteirinha") {
      const validatedPeriod = validateKoaPeriod(values.startDate, values.endDate);
      if (!validatedPeriod.valid) {
        setErrors({
          startDate: "Informe um período válido.",
          endDate: "Informe um período válido.",
        });
        setPhase("form");
        return;
      }
      cardPeriod = {
        periodStart: validatedPeriod.periodStart,
        periodEnd: validatedPeriod.periodEnd,
      };
    }

    const submittedSummary = buildSubmittedSummary(selectedFlow, values);

    if (
      (selectedFlow === "inclusao" && values.inclusionType !== "holder") ||
      (selectedFlow === "exclusao" && values.exclusionType === "dependent")
    ) {
      const localError: KoaOperation = {
        id: createKoaEntryId("operation"),
        type,
        status: "error",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: {
          code: "WORKFLOW_DISABLED",
          message: "Essa movimentação ainda não está liberada para automação real.",
          safeDetails:
            selectedFlow === "exclusao"
              ? "Nesta etapa, somente exclusão de titular em modo preparação está habilitada."
              : "Nesta etapa, somente inclusão de titular em modo preparação está habilitada.",
          retryable: false,
        },
      };

      setOperation(localError);
      setHistory((current) => [
        ...current.filter((entry) => entry.kind !== "form"),
        { id: createKoaEntryId("submitted"), kind: "submitted", flow: selectedFlow, summary: submittedSummary },
        { id: createKoaEntryId("operation-message"), kind: "operation", operationId: localError.id },
      ]);
      setValues((current) => ({ ...current, password: "" }));
      setPhase("error");
      return;
    }

    const companyId = resolveKoaCompanyId(conversation);
    const workspaceId = workspace?.id ?? import.meta.env.VITE_KOA_DEFAULT_WORKSPACE_ID;
    if (!companyId) {
      setErrors({ companyId: "Empresa não conectada ao cadastro real do Kortex." });
      setHelperText("Conecte esta conversa a uma empresa cadastrada ou configure VITE_KOA_DEFAULT_COMPANY_ID para o teste controlado.");
      setPhase("form");
      return;
    }

    if (!workspaceId) {
      setHelperText("Selecione um workspace ativo antes de enviar a automação.");
      setPhase("form");
      return;
    }

    try {
      setOperationConnectionState("live");
      const operationPayload =
        selectedFlow === "carteirinha"
          ? {
              beneficiaryName: values.beneficiaryName.trim(),
              periodStart: cardPeriod.periodStart,
              periodEnd: cardPeriod.periodEnd,
              contractCode: values.contractCode.trim() || undefined,
            }
          : selectedFlow === "inclusao"
            ? {
                beneficiaryName: values.beneficiaryName.trim(),
                cpf: values.cpf.trim(),
                birthDate: values.birthDate.trim(),
                contractCode: values.contractCode.trim() || undefined,
                healthAllNegativeConfirmed: false,
              }
            : {
                beneficiaryName: values.beneficiaryName.trim(),
                beneficiaryCpf: values.cpf.trim(),
                cancellationReason: values.exclusionReason.trim(),
                companyAccess: values.companyAccess.trim() || undefined,
              };

      const response = await createOperation({
        type: automationTypeFromFlow(selectedFlow),
        workspaceId,
        companyId,
        requestedBy: user?.id,
        data: operationPayload,
      });
      const nextOperation = mapAutomationOperation(response, type);

      operationUnsubscribeRef.current?.();
      operationUnsubscribeRef.current = null;
      const unsubscribe = await subscribeToOperation(response.operationId, {
        onEvent: () => {
          void getOperation(response.operationId).then((updated) => {
            const mapped = mapAutomationOperation(updated, type);
            setOperation(mapped);
            setPhase(phaseFromOperationStatus(mapped.status));
          });
        },
        onConnectionState: setOperationConnectionState,
      });
      operationUnsubscribeRef.current = unsubscribe;

      setOperation(nextOperation);
      setHistory((current) => [
        ...current.filter((entry) => entry.kind !== "form"),
        { id: createKoaEntryId("submitted"), kind: "submitted", flow: selectedFlow, summary: submittedSummary },
        { id: createKoaEntryId("operation-message"), kind: "operation", operationId: nextOperation.id },
      ]);
      setValues((current) => ({ ...current, password: "" }));
      setPhase(phaseFromOperationStatus(nextOperation.status));
    } catch (error) {
      const failedOperation: KoaOperation = {
        id: createKoaEntryId("operation"),
        type,
        status: "error",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: {
          message: "Não foi possível enviar a solicitação ao worker.",
          safeDetails: error instanceof Error ? error.message : "Falha desconhecida.",
          retryable: true,
        },
      };
      setOperation(failedOperation);
      setHistory((current) => [
        ...current.filter((entry) => entry.kind !== "form"),
        { id: createKoaEntryId("submitted"), kind: "submitted", flow: selectedFlow, summary: submittedSummary },
        { id: createKoaEntryId("operation-message"), kind: "operation", operationId: failedOperation.id },
      ]);
      setValues((current) => ({ ...current, password: "" }));
      setPhase("error");
    }
  };

  const handleCancelOperation = async () => {
    if (!operation || cancelInFlightRef.current) return;
    if (
      (!isActiveKoaOperationStatus(operation.status) &&
        operation.status !== "awaiting_confirmation" &&
        operation.status !== "awaiting_authentication") ||
      operation.status === "cancelling"
    ) {
      return;
    }

    cancelInFlightRef.current = true;
    const cancellingAt = new Date().toISOString();

    setPhase("cancelling");
    setOperation((current) =>
      current?.id === operation.id ? { ...current, status: "cancelling", updatedAt: cancellingAt } : current,
    );

    try {
      const cancelled = await cancelOperation(operation.id);
      const mapped = mapAutomationOperation(cancelled, operation.type);
      setOperation(mapped);
      setPhase(phaseFromOperationStatus(mapped.status));
    } catch (error) {
      setOperation((current) =>
        current?.id === operation.id
          ? {
              ...current,
              status: "error",
              updatedAt: new Date().toISOString(),
              error: {
                message: "Não foi possível cancelar a operação.",
                safeDetails: error instanceof Error ? error.message : "O backend não confirmou o cancelamento.",
                retryable: false,
              },
            }
          : current,
      );
      setPhase("error");
    } finally {
      cancelInFlightRef.current = false;
    }
  };

  const handleRetry = () => {
    if (!selectedFlow) return;
    openFlow(selectedFlow);
  };

  const handleSubmitAuthentication = async (input: {
    password: string;
    rememberOnDevice: boolean;
    companyCode?: string;
  }) => {
    if (!operation) return "Operação não encontrada.";

    try {
      const result = await submitOperationAuthentication({
        operationId: operation.id,
        companyCode: input.companyCode,
        password: input.password,
        rememberOnDevice: input.rememberOnDevice,
      });

      if (!result.ok) {
        if (result.operation) {
          const mapped = mapAutomationOperation(result.operation, operation.type);
          setOperation(mapped);
          setPhase(phaseFromOperationStatus(mapped.status));
        }
        if (result.error === "COMPANY_CODE_REQUIRED") return "Informe o código da empresa para continuar.";
        if (result.error === "AUTHENTICATION_ATTEMPTS_EXCEEDED") return "Limite de tentativas atingido. O Koa interrompeu o fluxo para revisão.";
        return "Não foi possível autenticar. Confira a senha e tente novamente.";
      }

      if (result.operation) {
        const mapped = mapAutomationOperation(result.operation, operation.type);
        setOperation(mapped);
        setPhase(phaseFromOperationStatus(mapped.status));
      } else {
        setOperation((current) =>
          current?.id === operation.id
            ? { ...current, status: "queued", updatedAt: new Date().toISOString() }
            : current,
        );
        setPhase("processing");
      }
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : "Não foi possível autenticar. Tente novamente.";
    }
  };

  const renderEntry = (entry: KoaChatEntry) => {
    if (entry.kind === "user") return <KoaUserBubble key={entry.id}>{entry.text}</KoaUserBubble>;
    if (entry.kind === "assistant") return <KoaAssistantBubble key={entry.id}>{entry.text}</KoaAssistantBubble>;
    if (entry.kind === "submitted") return <KoaSubmittedRequest key={entry.id} summary={entry.summary} />;
    if (entry.kind === "operation") {
      if (!operation || operation.id !== entry.operationId) return null;
      if (!isActiveKoaOperationStatus(operation.status)) {
        return (
          <KoaOperationResult
            key={entry.id}
            operation={operation}
            defaultCompanyCode={values.contractCode}
            onRetry={handleRetry}
            onCancelOperation={handleCancelOperation}
            onSubmitAuthentication={handleSubmitAuthentication}
          />
        );
      }

      const isCancelling = operation.status === "cancelling";
      const secondaryMessage =
        operationConnectionState === "reconnecting"
          ? "Reconectando ao acompanhamento da operação..."
          : isCancelling
            ? "Estou interrompendo a movimentação atual."
            : "Aguarde, enviarei as informações assim que finalizar.";

      return (
        <KoaProcessingMessage
          key={entry.id}
          operationType={operation.type}
          status={operation.status}
          message={isCancelling ? "Cancelando operação..." : operationStatusMessage(operation.status, operation.type)}
          secondaryMessage={secondaryMessage}
        />
      );
    }

    return (
      <KoaMovementForm
        key={entry.id}
        flow={entry.flow}
        values={values}
        errors={errors}
        onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
        onDependentChange={(id, key, value) =>
          setValues((current) => ({
            ...current,
            dependents: current.dependents.map((dependent) => (dependent.id === id ? { ...dependent, [key]: value } : dependent)),
          }))
        }
        onAddDependent={() => setValues((current) => ({ ...current, dependents: [...current.dependents, createDependent()] }))}
        onRemoveDependent={(id) =>
          setValues((current) => ({
            ...current,
            dependents: current.dependents.length > 1 ? current.dependents.filter((dependent) => dependent.id !== id) : current.dependents,
          }))
        }
        onFilesSelected={(files) =>
          setValues((current) => ({ ...current, attachments: [...current.attachments, ...files.map(createAttachment)] }))
        }
        onRemoveAttachment={(id) =>
          setValues((current) => ({ ...current, attachments: current.attachments.filter((file) => file.id !== id) }))
        }
        onSubmit={handleSubmitFlow}
      />
    );
  };

  return (
    <aside className={`absolute inset-y-0 right-0 z-20 flex w-full max-w-[390px] flex-col border-l border-border bg-card shadow-2xl md:relative md:z-0 md:w-[360px] md:min-w-[360px] md:max-w-none md:shadow-none ${isClosing ? "koa-panel-exit" : "koa-panel-enter"}`}>
      <button type="button" onClick={onClose} className="absolute right-5 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-lg text-primary transition hover:bg-primary/10" aria-label="Fechar Koa">
        <X className="h-5 w-5" strokeWidth={1.5} />
      </button>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={`min-h-0 flex-1 overflow-y-auto px-5 scrollbar-thin ${selectedFlow ? "pb-5 pt-14" : "flex flex-col items-center justify-center gap-8 py-14 text-center"}`}>
          {!selectedFlow ? (
            <>
              <KoaAnimatedLogo label="Koa" className="h-36 w-36 sm:h-40 sm:w-40" />
              <h2 className="text-2xl font-semibold leading-tight tracking-normal text-foreground">Qual movimentação você deseja realizar?</h2>
              <div className="grid w-full grid-cols-3 gap-2">
                {flows.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => openFlow(id)}
                    className="flex min-h-[72px] flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-background px-2 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    <Icon className="h-6 w-6" strokeWidth={1.5} />
                    {label}
                  </button>
                ))}
              </div>
              {helperText && <p className="rounded-full bg-secondary px-4 py-2 text-sm text-muted-foreground">{helperText}</p>}
            </>
          ) : (
            <div className="space-y-4">
              {history.map(renderEntry)}
              {helperText && <p className="rounded-2xl bg-secondary px-4 py-3 text-sm text-muted-foreground">{helperText}</p>}
              <div ref={historyEndRef} />
            </div>
          )}
        </div>
        <KoaPanelComposer
          value={message}
          onChange={setMessage}
          onSubmit={handleMessageSubmit}
          disabled={phase === "submitting" || phase === "processing" || phase === "awaiting_authentication"}
          operationStatus={operation?.status}
          onCancelOperation={handleCancelOperation}
        />
      </div>
    </aside>
  );
}

function KoaPanelComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  operationStatus,
  onCancelOperation,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  operationStatus?: KoaOperationStatus;
  onCancelOperation: () => void;
}) {
  const operationActive = isActiveKoaOperationStatus(operationStatus);
  const awaitingAuthentication = operationStatus === "awaiting_authentication";
  const cancelling = operationStatus === "cancelling";

  if (operationActive || awaitingAuthentication) {
    return (
      <div className="shrink-0 border-t border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-3 rounded-full bg-secondary/70 px-4 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
            {awaitingAuthentication
              ? "Aguardando autenticação Hapvida..."
              : cancelling
                ? "Cancelando operação..."
                : "Koa está processando a movimentação..."}
          </span>
          <button
            type="button"
            onClick={onCancelOperation}
            disabled={cancelling}
            aria-label="Cancelar operação"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:bg-primary disabled:active:scale-100"
          >
            <span className="h-3.5 w-3.5 rounded-[3px] bg-white" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 rounded-full bg-secondary/70 px-3 py-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
          className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-normal outline-none placeholder:text-muted-foreground"
          placeholder="Digite uma mensagem..."
        />
        <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background hover:text-primary" aria-label="Anexar arquivo">
          <Paperclip className="h-5 w-5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-primary"
        >
          <Send className="h-5 w-5" strokeWidth={1.5} />
          <span className="sr-only">Enviar</span>
        </button>
      </div>
    </div>
  );
}

function KoaUserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="ml-auto w-fit max-w-[82%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm font-medium leading-relaxed text-primary-foreground shadow-sm">
      {children}
    </div>
  );
}

function KoaAssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-fit max-w-[86%] rounded-2xl rounded-bl-md bg-secondary px-4 py-3 text-sm font-medium leading-relaxed text-foreground">
      {children}
    </div>
  );
}

function KoaSubmittedRequest({ summary }: { summary: KoaSubmittedSummary }) {
  return (
    <div className="ml-auto w-fit max-w-[84%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm">
      <p className="font-semibold">{summary.title}</p>
      {summary.detail && <p className="mt-1 text-xs text-primary-foreground/80">{summary.detail}</p>}
      {summary.attachmentCount ? (
        <p className="mt-1 text-xs text-primary-foreground/80">
          {summary.attachmentCount} anexo{summary.attachmentCount > 1 ? "s" : ""} enviado{summary.attachmentCount > 1 ? "s" : ""}
        </p>
      ) : null}
    </div>
  );
}

function KoaProcessingMessage({
  operationType,
  status,
  message,
  secondaryMessage,
}: {
  operationType: KoaOperationType;
  status: KoaOperationStatus;
  message: string;
  secondaryMessage: string;
}) {
  const statusLabel = status === "queued" ? "Na fila de processamento" : status === "cancelling" ? "Cancelando" : "Processando";

  return (
    <div className="flex items-start gap-2">
      <KoaOperationAnimation className="mt-0.5 h-10 w-10 shrink-0" />
      <div className="max-w-[84%] rounded-2xl rounded-bl-md bg-secondary/80 px-4 py-3 text-left shadow-sm">
        <p className="text-sm font-semibold leading-snug text-primary">{message}</p>
        <p className="mt-1 text-sm font-normal leading-snug text-muted-foreground">{secondaryMessage}</p>
        <span className="sr-only">{statusLabel} {operationType}</span>
      </div>
    </div>
  );
}

function KoaAuthenticationCard({
  defaultCompanyCode,
  onCancelOperation,
  onSubmitAuthentication,
}: {
  defaultCompanyCode?: string;
  onCancelOperation: () => void;
  onSubmitAuthentication: (input: { password: string; rememberOnDevice: boolean; companyCode?: string }) => Promise<string | undefined>;
}) {
  const [companyCode, setCompanyCode] = useState(defaultCompanyCode?.trim() ?? "");
  const [password, setPassword] = useState("");
  const [rememberOnDevice, setRememberOnDevice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsCompanyCode = !defaultCompanyCode?.trim();

  const handleSubmit = async () => {
    if (submitting) return;
    if (needsCompanyCode && !companyCode.trim()) {
      setError("Informe o código da empresa.");
      return;
    }
    if (!password) {
      setError("Informe a senha para continuar.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmitAuthentication({
        companyCode: companyCode.trim() || undefined,
        password,
        rememberOnDevice,
      });
      setPassword("");
      if (result) {
        setError(result);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-start gap-2">
      <KoaOperationAnimation className="mt-0.5 h-10 w-10 shrink-0" />
      <div className="max-w-[84%] rounded-2xl rounded-bl-md bg-secondary/80 px-4 py-3 text-left shadow-sm">
        <p className="text-sm font-semibold text-foreground">Preciso autenticar o acesso Hapvida para continuar.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A senha será usada somente para validar o portal e retomar esta emissão.
        </p>

        <div className="mt-4 space-y-3">
          {needsCompanyCode ? (
            <KoaTextField
              icon={Building2}
              label="Código da empresa"
              value={companyCode}
              error={error?.includes("código") ? error : undefined}
              placeholder="Digite o código"
              onChange={(value) => {
                setCompanyCode(value);
                setError(null);
              }}
            />
          ) : (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Empresa</p>
              <p className="text-sm font-semibold text-foreground">{defaultCompanyCode}</p>
            </div>
          )}

          <KoaPasswordField
            label="Senha"
            value={password}
            error={error && !error.includes("código") ? error : undefined}
            onChange={(value) => {
              setPassword(value);
              setError(null);
            }}
          />

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={rememberOnDevice}
              onChange={(event) => setRememberOnDevice(event.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
            />
            Lembrar neste computador
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancelOperation}
            disabled={submitting}
            className="h-10 rounded-xl border border-border px-3 text-xs font-semibold text-muted-foreground transition hover:bg-background disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="h-10 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "Autenticando..." : "Entrar e continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function KoaOperationResult({
  operation,
  defaultCompanyCode,
  onRetry,
  onCancelOperation,
  onSubmitAuthentication,
}: {
  operation: KoaOperation;
  defaultCompanyCode?: string;
  onRetry: () => void;
  onCancelOperation: () => void;
  onSubmitAuthentication: (input: { password: string; rememberOnDevice: boolean; companyCode?: string }) => Promise<string | undefined>;
}) {
  if (operation.status === "cancelled") {
    return (
      <div className="w-fit max-w-[86%] rounded-2xl rounded-bl-md bg-secondary px-4 py-3 text-sm text-foreground">
        <p className="font-semibold">Operação cancelada.</p>
        <p className="mt-1 text-sm font-normal text-muted-foreground">A movimentação foi interrompida antes da conclusão.</p>
      </div>
    );
  }

  if (operation.status === "awaiting_authentication") {
    return (
      <KoaAuthenticationCard
        defaultCompanyCode={defaultCompanyCode}
        onCancelOperation={onCancelOperation}
        onSubmitAuthentication={onSubmitAuthentication}
      />
    );
  }

  if (operation.status === "awaiting_human_verification") {
    return (
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Info className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <div className="max-w-[84%] rounded-2xl rounded-bl-md bg-secondary/80 px-4 py-3 text-left shadow-sm">
          <p className="text-sm font-semibold text-foreground">É necessária uma verificação humana.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            O Koa parou antes de continuar porque o portal externo apresentou CAPTCHA ou validação manual.
          </p>
          {operation.result?.status && <p className="mt-2 text-xs text-muted-foreground">{operation.result.status}</p>}
          <button type="button" onClick={onCancelOperation} className="mt-3 h-9 rounded-xl border border-border px-3 text-xs font-semibold text-muted-foreground transition hover:bg-background">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (operation.status === "awaiting_confirmation") {
    const dependents = operation.result?.dependentsFound ?? [];
    const resultRows = [
      operation.result?.beneficiaryName ? { label: operation.type === "inclusion" ? "Beneficiário" : "Titular", value: operation.result.beneficiaryName } : null,
      operation.result?.beneficiaryCpfMasked ? { label: "CPF", value: operation.result.beneficiaryCpfMasked } : null,
      operation.result?.cnsNumber ? { label: "CNS", value: operation.result.cnsNumber } : null,
      operation.result?.contractCode ? { label: "Contrato", value: operation.result.contractCode } : null,
      operation.result?.unit ? { label: "Unidade", value: operation.result.unit } : null,
      operation.result?.plan ? { label: "Plano", value: operation.result.plan } : null,
      typeof operation.result?.documents === "number" ? { label: "Documentos", value: String(operation.result.documents) } : null,
      operation.result?.cancellationReason ? { label: "Motivo", value: operation.result.cancellationReason } : null,
      operation.result?.effectiveCancellationDate ? { label: "Data do pré-cancelamento", value: operation.result.effectiveCancellationDate } : null,
    ].filter(Boolean) as Array<{ label: string; value: string }>;

    return (
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Info className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <div className="max-w-[84%] rounded-2xl rounded-bl-md bg-secondary/80 px-4 py-3 text-left shadow-sm">
          <p className="text-sm font-semibold text-foreground">
            {operation.type === "inclusion" ? "Revise os dados antes de confirmar a inclusão." : "Revise os dados antes de confirmar a exclusão."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {operation.type === "inclusion"
              ? "O Koa preparou a inclusão de titular e parou antes do envio definitivo."
              : "O Koa preparou o pré-cancelamento e parou antes do envio definitivo."}
          </p>
          {resultRows.length > 0 && (
            <div className="mt-3 space-y-2">
              {resultRows.map((row) => (
                <div key={row.label}>
                  <p className="text-xs font-medium text-muted-foreground">{row.label}</p>
                  <p className="text-sm font-medium text-foreground">{row.value}</p>
                </div>
              ))}
            </div>
          )}
          {dependents.length > 0 && (
            <div className="mt-3 rounded-xl border border-border bg-background/70 p-3">
              <p className="text-xs font-semibold text-foreground">Dependentes encontrados</p>
              <div className="mt-2 space-y-1">
                {dependents.map((dependent, index) => (
                  <p key={`${dependent.code ?? dependent.name ?? "dep"}-${index}`} className="text-xs text-muted-foreground">
                    {dependent.name ?? "Dependente"}{dependent.birthDate ? ` - ${dependent.birthDate}` : ""}
                  </p>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={onCancelOperation} className="h-9 rounded-xl border border-border px-3 text-xs font-semibold text-muted-foreground transition hover:bg-background">
              Cancelar
            </button>
            <button type="button" disabled className="h-9 rounded-xl bg-muted px-3 text-xs font-semibold text-muted-foreground" title="Submit real bloqueado nesta fase">
              {operation.type === "inclusion" ? "Confirmar inclusão" : "Confirmar exclusão"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (operation.status === "error") {
    return (
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <X className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <div className="max-w-[84%] rounded-2xl rounded-bl-md bg-secondary/80 px-4 py-3 text-left shadow-sm">
          <p className="text-sm font-semibold text-foreground">{operation.error?.message || "Não foi possível concluir a movimentação."}</p>
          <p className="mt-1 text-sm text-muted-foreground">Verifique os dados e tente novamente.</p>
          {operation.error?.safeDetails && <p className="mt-2 text-xs text-muted-foreground">{operation.error.safeDetails}</p>}
          {operation.error?.retryable !== false && (
            <button type="button" onClick={onRetry} className="mt-3 h-9 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90">
              Tentar novamente
            </button>
          )}
        </div>
      </div>
    );
  }

  if (operation.status === "manual_review") {
    return (
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Info className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <div className="max-w-[84%] rounded-2xl rounded-bl-md bg-secondary/80 px-4 py-3 text-left shadow-sm">
          <p className="text-sm font-semibold text-foreground">A operação precisa de revisão manual.</p>
          <p className="mt-1 text-sm text-muted-foreground">O Koa interrompeu o fluxo para evitar uma ação incorreta no portal.</p>
          {operation.error?.safeDetails && <p className="mt-2 text-xs text-muted-foreground">{operation.error.safeDetails}</p>}
        </div>
      </div>
    );
  }

  const resultRows = [
    operation.result?.beneficiaryName ? { label: "Beneficiário", value: operation.result.beneficiaryName } : null,
    operation.result?.portalStatusCode ? { label: "Código Hapvida", value: operation.result.portalStatusCode } : null,
    operation.result?.status ? { label: "Status", value: operation.result.status } : null,
    operation.result?.protocol ? { label: "Protocolo", value: operation.result.protocol } : null,
    operation.result?.fileName ? { label: "Arquivo", value: operation.result.fileName } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const resultTitle =
    operation.status === "submission_confirmed"
      ? operation.type === "inclusion"
        ? "Solicitação de inclusão registrada no portal."
        : operation.type === "exclusion"
          ? "Solicitação de exclusão registrada no portal."
          : operationSuccessMessage(operation.type)
      : operationSuccessMessage(operation.type);

  return (
    <div className="w-fit max-w-[86%] rounded-2xl rounded-bl-md bg-secondary px-4 py-3 text-sm text-foreground">
      <p className="font-semibold">{resultTitle}</p>
      {resultRows.length > 0 && (
        <div className="mt-3 space-y-2">
          {resultRows.map((row) => (
            <div key={row.label}>
              <p className="text-xs font-medium text-muted-foreground">{row.label}</p>
              <p className="text-sm font-medium text-foreground">{row.value}</p>
            </div>
          ))}
        </div>
      )}
      {operation.result?.artifactUrl && (
        <a
          href={operation.result.artifactUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex h-9 items-center justify-center rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          {operation.type === "card" ? "Baixar carteirinha" : "Ver comprovante"}
        </a>
      )}
    </div>
  );
}

function KoaMovementForm({
  flow,
  values,
  errors,
  onChange,
  onDependentChange,
  onAddDependent,
  onRemoveDependent,
  onFilesSelected,
  onRemoveAttachment,
  onSubmit,
}: {
  flow: KoaFlow;
  values: KoaFormValues;
  errors: Record<string, string>;
  onChange: (key: keyof KoaFormValues, value: string) => void;
  onDependentChange: (id: string, key: keyof KoaDependent, value: string) => void;
  onAddDependent: () => void;
  onRemoveDependent: (id: string) => void;
  onFilesSelected: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: () => void;
}) {
  if (flow === "carteirinha") {
    return (
      <KoaFormCard icon={IdCard} title="Emissão de carteirinha">
        <div className="space-y-3">
          <KoaTextField icon={FileText} label="Código do contrato" value={values.contractCode} error={errors.contractCode} placeholder="Digite o código" onChange={(value) => onChange("contractCode", value)} />
          <div className="grid gap-3">
            <KoaTextField icon={CalendarDays} label="Data inicial" value={values.startDate} error={errors.startDate} placeholder="DD/MM/AAAA" onChange={(value) => onChange("startDate", value)} />
            <KoaTextField icon={CalendarDays} label="Data final" value={values.endDate} error={errors.endDate} placeholder="DD/MM/AAAA" onChange={(value) => onChange("endDate", value)} />
          </div>
          <KoaTextField icon={Users} label="Nome completo do beneficiário" value={values.beneficiaryName} error={errors.beneficiaryName} placeholder="Digite o nome completo" onChange={(value) => onChange("beneficiaryName", value)} />
          <KoaInfoNote>Informe o período em que o beneficiário foi incluído.</KoaInfoNote>
        </div>
        <KoaSubmitButton onClick={onSubmit}>Emitir carteirinha</KoaSubmitButton>
      </KoaFormCard>
    );
  }

  if (flow === "inclusao") {
    return (
      <KoaFormCard icon={UserPlus} title="Inclusão de beneficiário" description="Preencha os dados abaixo para incluir o beneficiário no plano.">
        <div className="space-y-3">
          <KoaSelectField
            icon={Users}
            label="Tipo de inclusão"
            value={values.inclusionType}
            error={errors.inclusionType}
            onChange={(value) => onChange("inclusionType", value)}
            options={[
              { value: "holder", label: "Somente titular" },
              { value: "holder_dependents", label: "Titular + dependentes" },
            ]}
          />
          <KoaTextField icon={FileText} label="Código do contrato" value={values.contractCode} error={errors.contractCode} placeholder="Digite o código" onChange={(value) => onChange("contractCode", value)} />
          <KoaTextField icon={Users} label="Nome completo do beneficiário" value={values.beneficiaryName} error={errors.beneficiaryName} placeholder="Digite o nome completo" onChange={(value) => onChange("beneficiaryName", value)} />
          <KoaTextField icon={IdCard} label="CPF" value={values.cpf} error={errors.cpf} placeholder="000.000.000-00" onChange={(value) => onChange("cpf", value)} />
          <KoaTextField icon={CalendarDays} label="Data de nascimento" value={values.birthDate} error={errors.birthDate} placeholder="DD/MM/AAAA" onChange={(value) => onChange("birthDate", value)} />

          {values.inclusionType === "holder_dependents" && (
            <div className="space-y-3 border-t border-border pt-4">
              <div>
                <h4 className="text-base font-semibold text-foreground">Dependentes</h4>
                <p className="text-sm text-muted-foreground">Adicione os dependentes vinculados ao titular.</p>
              </div>
              {values.dependents.map((dependent, index) => (
                <div key={dependent.id} className="space-y-3 rounded-2xl border border-border bg-card/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">Dependente {index + 1}</p>
                    <button type="button" onClick={() => onRemoveDependent(dependent.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-destructive" aria-label="Remover dependente">
                      <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>
                  <KoaTextField icon={Users} label="Nome completo" value={dependent.fullName} error={errors[`dependents.${index}.fullName`]} placeholder="Digite o nome completo" onChange={(value) => onDependentChange(dependent.id, "fullName", value)} />
                  <KoaTextField icon={IdCard} label="CPF" value={dependent.cpf} error={errors[`dependents.${index}.cpf`]} placeholder="000.000.000-00" onChange={(value) => onDependentChange(dependent.id, "cpf", value)} />
                  <KoaTextField icon={CalendarDays} label="Data de nascimento" value={dependent.birthDate} error={errors[`dependents.${index}.birthDate`]} placeholder="DD/MM/AAAA" onChange={(value) => onDependentChange(dependent.id, "birthDate", value)} />
                  <KoaTextField icon={FileText} label="Grau de parentesco" value={dependent.relationship} error={errors[`dependents.${index}.relationship`]} placeholder="Ex.: filho, cônjuge" onChange={(value) => onDependentChange(dependent.id, "relationship", value)} />
                </div>
              ))}
              <button type="button" onClick={onAddDependent} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 text-sm font-medium text-primary transition hover:bg-primary/5">
                <Plus className="h-4 w-4" strokeWidth={1.5} />
                Adicionar dependente
              </button>
            </div>
          )}

          <KoaAttachmentArea
            title="Anexos"
            description="Anexe os documentos necessários para a solicitação."
            attachments={values.attachments}
            onFilesSelected={onFilesSelected}
            onRemoveAttachment={onRemoveAttachment}
          />
        </div>
        <KoaSubmitButton onClick={onSubmit}>Enviar solicitação</KoaSubmitButton>
      </KoaFormCard>
    );
  }

  return (
    <KoaFormCard icon={UserMinus} title={values.exclusionType === "dependent" ? "Exclusão de dependente" : "Exclusão de beneficiário"} description={values.exclusionType === "dependent" ? "Preencha os dados abaixo para excluir o dependente do plano." : "Preencha os dados abaixo para solicitar a exclusão do beneficiário no plano."}>
      <div className="space-y-3">
        <KoaSegmentedChoice
          label="Tipo de exclusão"
          value={values.exclusionType}
          onChange={(value) => onChange("exclusionType", value)}
          options={[
            { value: "holder", label: "Titular", icon: Users },
            { value: "dependent", label: "Dependente", icon: UserMinus },
          ]}
        />

        {values.exclusionType === "holder" ? (
          <>
            <KoaTextField icon={Building2} label="Empresa / acesso da empresa" value={values.companyAccess} error={errors.companyAccess} placeholder="Digite a empresa ou acesso" onChange={(value) => onChange("companyAccess", value)} />
            <KoaTextField icon={Users} label="Beneficiário a ser excluído" value={values.beneficiaryName} error={errors.beneficiaryName} placeholder="Digite o nome completo" onChange={(value) => onChange("beneficiaryName", value)} />
            <KoaTextField icon={IdCard} label="CPF" value={values.cpf} error={errors.cpf} placeholder="000.000.000-00" onChange={(value) => onChange("cpf", value)} />
            <KoaSelectField
              icon={FileText}
              label="Motivo da exclusão"
              value={values.exclusionReason}
              error={errors.exclusionReason}
              onChange={(value) => onChange("exclusionReason", value)}
              placeholder="Selecione o motivo"
              options={[
                { value: "desligamento", label: "Desligamento" },
                { value: "solicitacao_cliente", label: "Solicitação do cliente" },
                { value: "outro", label: "Outro motivo" },
              ]}
            />
            <KoaAttachmentArea
              title="Anexos (opcional)"
              description="Anexe documentos de comprovação, se necessário."
              attachments={values.attachments}
              onFilesSelected={onFilesSelected}
              onRemoveAttachment={onRemoveAttachment}
            />
            <KoaInfoNote>O Koa buscará o código do titular e a data do pré-cancelamento diretamente no portal. Nenhuma senha é solicitada no chat.</KoaInfoNote>
          </>
        ) : (
          <KoaInfoNote>Exclusão de dependente ainda não está habilitada para automação. Nesta fase, apenas titular pode seguir em modo preparação.</KoaInfoNote>
        )}
      </div>
      <KoaSubmitButton onClick={onSubmit}>Enviar solicitação</KoaSubmitButton>
    </KoaFormCard>
  );
}

function validateKoaValues(flow: KoaFlow, values: KoaFormValues) {
  const nextErrors: Record<string, string> = {};
  const requireValue = (key: keyof KoaFormValues, label = "Campo obrigatório") => {
    const value = values[key];
    if (typeof value === "string" && !value.trim()) nextErrors[key] = label;
  };

  if (flow === "carteirinha") {
    ["startDate", "endDate", "beneficiaryName"].forEach((key) => requireValue(key as keyof KoaFormValues));
    if (values.startDate.trim() && values.endDate.trim()) {
      const period = validateKoaPeriod(values.startDate, values.endDate);
      if (!period.valid) {
        nextErrors.startDate = "Informe um período válido.";
        nextErrors.endDate = "Informe um período válido.";
      }
    }
  }

  if (flow === "inclusao") {
    ["contractCode", "beneficiaryName", "cpf", "birthDate"].forEach((key) => requireValue(key as keyof KoaFormValues));
    if (values.inclusionType === "holder_dependents") {
      values.dependents.forEach((dependent, index) => {
        (["fullName", "cpf", "birthDate", "relationship"] as Array<keyof KoaDependent>).forEach((key) => {
          if (!dependent[key].trim()) nextErrors[`dependents.${index}.${key}`] = "Campo obrigatório";
        });
      });
    }
  }

  if (flow === "exclusao" && values.exclusionType === "holder") {
    ["companyAccess", "beneficiaryName", "cpf", "exclusionReason"].forEach((key) => requireValue(key as keyof KoaFormValues));
  }

  return nextErrors;
}

function KoaFormCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4 text-left shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-foreground">
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold leading-tight text-foreground">{title}</h3>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function KoaTextField({
  icon: Icon,
  label,
  value,
  error,
  placeholder,
  onChange,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  error?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      <span className={`flex h-11 items-center gap-3 rounded-xl border bg-card px-3 transition ${error ? "border-destructive/60" : "border-input focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15"}`}>
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm font-normal outline-none placeholder:text-muted-foreground"
        />
      </span>
      {error && <span className="text-xs font-normal text-destructive">{error}</span>}
    </label>
  );
}

function KoaPasswordField({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      <span className={`flex h-11 items-center gap-3 rounded-xl border bg-card px-3 transition ${error ? "border-destructive/60" : "border-input focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15"}`}>
        <LockKeyhole className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <input
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Digite sua senha"
          className="min-w-0 flex-1 bg-transparent text-sm font-normal outline-none placeholder:text-muted-foreground"
        />
        <button type="button" onClick={() => setVisible((current) => !current)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground" aria-label={visible ? "Ocultar senha" : "Mostrar senha"}>
          {visible ? <EyeOff className="h-5 w-5" strokeWidth={1.5} /> : <Eye className="h-5 w-5" strokeWidth={1.5} />}
        </button>
      </span>
      {error && <span className="text-xs font-normal text-destructive">{error}</span>}
    </label>
  );
}

function KoaSelectField({
  icon: Icon,
  label,
  value,
  error,
  options,
  placeholder,
  onChange,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      <span className={`flex h-11 items-center gap-3 rounded-xl border bg-card px-3 transition ${error ? "border-destructive/60" : "border-input focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15"}`}>
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 appearance-none bg-transparent text-sm font-normal outline-none"
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronRight className="h-4 w-4 rotate-90 text-muted-foreground" strokeWidth={1.5} />
      </span>
      {error && <span className="text-xs font-normal text-destructive">{error}</span>}
    </label>
  );
}

function KoaSegmentedChoice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: ExclusionMode;
  options: Array<{ value: ExclusionMode; label: string; icon: React.ElementType }>;
  onChange: (value: ExclusionMode) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {options.map(({ value: optionValue, label: optionLabel, icon: Icon }) => (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition ${
              value === optionValue ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:border-primary/40"
            }`}
          >
            <Icon className="h-5 w-5" strokeWidth={1.5} />
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function KoaInfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl bg-secondary/70 p-3 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.5} />
      <p>{children}</p>
    </div>
  );
}

function KoaAttachmentArea({
  title,
  description,
  attachments,
  onFilesSelected,
  onRemoveAttachment,
}: {
  title: string;
  description: string;
  attachments: KoaAttachment[];
  onFilesSelected: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length > 0) onFilesSelected(files);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div>
        <h4 className="text-base font-semibold text-foreground">{title}</h4>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          handleFiles(event.dataTransfer.files);
        }}
        className="flex min-h-[72px] w-full items-center gap-3 rounded-xl border border-dashed border-primary/35 bg-primary/5 px-4 text-left transition hover:border-primary/55 hover:bg-primary/10"
      >
        <UploadCloud className="h-6 w-6 shrink-0 text-primary" strokeWidth={1.5} />
        <span>
          <span className="block text-sm font-semibold text-foreground">Anexar arquivos</span>
          <span className="block text-sm text-muted-foreground">Selecione ou arraste os arquivos aqui</span>
        </span>
      </button>
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((file) => (
            <div key={file.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{file.name}</span>
                <span className="block text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
              </span>
              <button type="button" onClick={() => onRemoveAttachment(file.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-destructive" aria-label={`Remover ${file.name}`}>
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KoaSubmitButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25">
      {children}
    </button>
  );
}

const KoaAnimatedLogo = memo(function KoaAnimatedLogo({
  label,
  className = "",
  processing = false,
}: {
  label: string;
  className?: string;
  processing?: boolean;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`koa-animated-logo ${processing ? "koa-animated-logo--processing" : ""} ${className}`}
    >
      <img src={koaLogoBody} alt="" aria-hidden="true" className="koa-animated-logo__body" />
      <img src={koaLogoEyes} alt="" aria-hidden="true" className="koa-animated-logo__eyes" />
    </span>
  );
});

function KoaOperationAnimation({ className = "" }: { className?: string }) {
  return <KoaAnimatedLogo label="Koa está processando" processing className={className} />;
}

function TransferPanel({ conversation, onClose, isClosing }: { conversation: Conversation; onClose: () => void; isClosing: boolean }) {
  return (
    <PanelShell title="Transferir conversa" description="Setores reais ainda não estão conectados nesta tela." icon={Users} onClose={onClose} isClosing={isClosing}>
      <div className="rounded-2xl border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
        Nenhum serviço de setores/departamentos foi encontrado no código atual. A interface está preparada, mas a confirmação fica indisponível para não simular transferência.
      </div>
      <div className="mt-5 rounded-2xl border border-border bg-background p-4">
        <p className="text-sm font-semibold text-foreground">{conversation.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">{conversation.company}</p>
        <p className="mt-3 text-xs text-muted-foreground">Status atual: {statusLabel(conversation.status)}</p>
      </div>
      <button type="button" disabled className="mt-5 h-11 w-full rounded-xl bg-muted text-sm font-semibold text-muted-foreground">
        Confirmar transferência
      </button>
    </PanelShell>
  );
}

function FunnelPanel({ conversation, onClose, isClosing }: { conversation: Conversation; onClose: () => void; isClosing: boolean }) {
  const stages = pipelines[0]?.stages ?? [];
  const [stage, setStage] = useState(stages[0] ?? "");

  return (
    <PanelShell title="Transferir no funil" description="Escolha uma etapa do funil disponível no produto atual." icon={Filter} onClose={onClose} isClosing={isClosing}>
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center gap-3">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${conversation.avatarColor}`}>
            {conversation.initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{conversation.name}</p>
            <p className="truncate text-sm text-muted-foreground">{conversation.company}</p>
          </div>
        </div>
      </div>
      <p className="mt-5 text-sm font-medium text-muted-foreground">Selecione a nova etapa</p>
      <div className="mt-3 space-y-2">
        {stages.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setStage(item)}
            className={`flex h-12 w-full items-center justify-between rounded-xl border px-4 text-sm font-medium transition ${
              stage === item ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:border-primary/40"
            }`}
          >
            {item}
            {stage === item && <ChevronRight className="h-4 w-4" strokeWidth={1.5} />}
          </button>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-5">
        <button type="button" onClick={onClose} className="h-11 rounded-xl border border-border text-sm font-semibold text-muted-foreground transition hover:bg-secondary">
          Cancelar
        </button>
        <button type="button" disabled className="h-11 rounded-xl bg-muted text-sm font-semibold text-muted-foreground" title="Mutação de funil ainda não conectada">
          Confirmar transferência
        </button>
      </div>
    </PanelShell>
  );
}

export default function InboxPage() {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState(initialConversations[0].id);
  const [tab, setTab] = useState<ConversationTab>("all");
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<SidePanel>(null);
  const [renderedPanel, setRenderedPanel] = useState<SidePanel>(null);
  const [isPanelClosing, setIsPanelClosing] = useState(false);
  const previousPanelRef = useRef<SidePanel>(null);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? conversations[0];

  useEffect(() => {
    const previousPanel = previousPanelRef.current;

    if (previousPanel !== "koa" && panel === "koa") {
      window.dispatchEvent(new Event("kortex:koa-panel-open"));
    }

    if (previousPanel === "koa" && panel !== "koa") {
      window.dispatchEvent(new Event("kortex:koa-panel-close"));
    }

    previousPanelRef.current = panel;
  }, [panel]);

  useEffect(() => {
    return () => {
      if (previousPanelRef.current === "koa") {
        window.dispatchEvent(new Event("kortex:koa-panel-close"));
      }
    };
  }, []);

  useEffect(() => {
    if (panel) {
      setRenderedPanel(panel);
      setIsPanelClosing(false);
      return undefined;
    }

    if (renderedPanel) {
      setIsPanelClosing(true);
      const timeout = window.setTimeout(() => {
        setRenderedPanel(null);
        setIsPanelClosing(false);
      }, 230);

      return () => window.clearTimeout(timeout);
    }

    setIsPanelClosing(false);
    return undefined;
  }, [panel, renderedPanel]);

  const handleSend = (conversationId: string, text: string) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              preview: text,
              time: formatNow(),
              messages: [...conversation.messages, { id: `local-${Date.now()}`, text, time: formatNow(), fromMe: true }],
            }
          : conversation,
      ),
    );
  };

  const moveStatus = (conversationId: string, status: ConversationStatus) => {
    setConversations((current) =>
      current.map((conversation) => (conversation.id === conversationId ? { ...conversation, status } : conversation)),
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background font-sans text-foreground md:flex-row">
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        tab={tab}
        query={query}
        onQueryChange={setQuery}
        onTabChange={setTab}
        onSelect={(id) => {
          setActiveId(id);
          setPanel(null);
        }}
        onMoveStatus={moveStatus}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <ChatArea
          conversation={activeConversation}
          panel={panel}
          onOpenPanel={setPanel}
          onSend={handleSend}
          onResolve={(id) => moveStatus(id, "resolved")}
        />
        {renderedPanel && (
          <SidePanelView
            panel={renderedPanel}
            conversation={activeConversation}
            onClose={() => setPanel(null)}
            isClosing={isPanelClosing}
          />
        )}
      </div>
    </div>
  );
}
