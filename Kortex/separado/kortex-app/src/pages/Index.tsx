import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  Building2,
  ChevronRight,
  CreditCard,
  FileText,
  MessageCircle,
  MoreVertical,
  RefreshCcw,
  Search,
  Send,
  UserPlus,
  Users,
} from "lucide-react";
import { contacts, insightsData, leads } from "@/data/mockData";
import { useAuth } from "@/contexts/AuthContext";

type InsightCard = {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
  icon: typeof Building2;
  path: string;
};

type QuickAccess = {
  label: string;
  icon: typeof Building2;
  path: string;
};

const quickAccessItems: QuickAccess[] = [
  { label: "Empresas", icon: Building2, path: "/companies" },
  { label: "Kit faturamento", icon: FileText, path: "/kit-faturamento" },
  { label: "Inclusão / Exclusão", icon: UserPlus, path: "/movimentacoes/inclusao" },
  { label: "Emissão de carteirinha", icon: CreditCard, path: "/movimentacoes/carteirinha" },
  { label: "Chat com clientes", icon: MessageCircle, path: "/inbox" },
  { label: "Chat da equipe", icon: Send, path: "/team-chat" },
];

const recentActivities = [
  {
    company: "RM Books",
    activity: "kit faturamento disponível",
    description: "Kit faturamento gerado e disponível para download.",
    time: "Hoje, 14:32",
    icon: FileText,
  },
  {
    company: "Confins Transportes",
    activity: "inclusão concluída",
    description: "Empresa incluída com sucesso na base.",
    time: "Hoje, 11:20",
    icon: UserPlus,
  },
  {
    company: "Cafeteria Noroeste",
    activity: "retorno pendente",
    description: "Cliente solicitou mais informações sobre o plano.",
    time: "Hoje, 10:08",
    icon: MessageCircle,
  },
  {
    company: "Horizonte Benefícios",
    activity: "carteirinhas emitidas",
    description: "Emissão de 120 carteirinhas concluída com sucesso.",
    time: "Ontem, 18:45",
    icon: CreditCard,
  },
  {
    company: "Mercado Central Saúde",
    activity: "atualização cadastral",
    description: "Dados cadastrais da empresa atualizados.",
    time: "Ontem, 16:10",
    icon: Building2,
  },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export default function Index() {
  const navigate = useNavigate();
  const { user, workspace } = useAuth();

  const insights = useMemo<InsightCard[]>(() => {
    const companyCount = new Set(
      contacts
        .map((contact) => contact.company || (contact.isCompany ? contact.name : ""))
        .filter(Boolean),
    ).size;

    return [
      {
        label: "Empresas",
        value: formatNumber(companyCount || contacts.filter((contact) => contact.isCompany).length),
        delta: "+12% em relação ao mês anterior",
        positive: true,
        icon: Building2,
        path: "/companies",
      },
      {
        label: "Contatos",
        value: formatNumber(contacts.length),
        delta: "+8% em relação ao mês anterior",
        positive: true,
        icon: Users,
        path: "/contacts",
      },
      {
        label: "Movimentações",
        value: formatNumber(leads.length),
        delta: "+15% em relação ao mês anterior",
        positive: true,
        icon: RefreshCcw,
        path: "/pipeline/atendimento-luisa",
      },
      {
        label: "Conversas com clientes",
        value: formatNumber(insightsData.currentConversations),
        delta: "-6% em relação ao mês anterior",
        positive: false,
        icon: MessageCircle,
        path: "/inbox",
      },
    ];
  }, []);

  const userInitials = useMemo(() => {
    const source = user?.email || workspace?.name || "Conta Administradora";
    return (
      source
        .split(/[ @._-]/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "CA"
    );
  }, [user?.email, workspace?.name]);

  return (
    <div className="h-full overflow-auto bg-background px-5 py-5 text-foreground scrollbar-thin lg:px-6">
      <header className="mb-5 flex items-center justify-end gap-4">
        <div className="relative w-full max-w-[420px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-primary" />
          <input
            className="h-11 w-full rounded-[10px] border border-border bg-card pl-11 pr-4 text-sm font-medium text-foreground shadow-[0_8px_22px_rgba(20,77,160,0.06)] outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
            placeholder="Buscar empresas, contatos, conversas..."
            type="search"
          />
        </div>

        <button
          type="button"
          className="relative flex h-10 w-10 items-center justify-center rounded-full text-primary transition hover:bg-accent"
          aria-label="Notificações"
        >
          <Bell className="h-6 w-6" strokeWidth={2} />
          <span className="absolute right-[8px] top-[7px] h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
        </button>

        <div
          className="flex items-center gap-2 rounded-full text-foreground"
          aria-label="Conta atual"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {userInitials}
          </span>
          <span className="hidden text-sm font-medium md:block">{workspace?.name || "Conta Administradora"}</span>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {insights.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={() => navigate(card.path)}
            className="group min-h-[118px] rounded-[10px] border border-border bg-card px-4 py-4 text-left shadow-[0_12px_26px_rgba(31,91,160,0.05)] transition hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_18px_36px_rgba(31,91,160,0.08)]"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                <card.icon className="h-7 w-7" strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[15px] font-bold leading-5 text-foreground">{card.label}</p>
                  <ChevronRight className="h-5 w-5 text-primary transition group-hover:translate-x-1" />
                </div>
                <p className="mt-2 text-[32px] font-bold leading-none tracking-normal text-foreground">{card.value}</p>
                <p className={["mt-3 flex items-center gap-1.5 text-[12px]", card.positive ? "text-[#02b864]" : "text-[#ec3345]"].join(" ")}>
                  <span className="text-[18px] leading-none">{card.positive ? "↗" : "↘"}</span>
                  <span>
                    <span className="font-semibold">{card.delta.split(" ")[0]}</span>{" "}
                    <span className="text-muted-foreground">{card.delta.replace(card.delta.split(" ")[0], "").trim()}</span>
                  </span>
                </p>
              </div>
            </div>
          </button>
        ))}
      </section>

      <section className="mt-5 rounded-[12px] border border-border bg-card px-5 py-4 shadow-[0_12px_26px_rgba(31,91,160,0.045)]">
        <h2 className="text-[24px] font-bold leading-none text-foreground">Acessos rápidos</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {quickAccessItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.path)}
              className="group flex min-h-[120px] flex-col items-start justify-between rounded-[8px] border border-border bg-card px-4 py-4 text-left transition hover:border-primary/45 hover:bg-accent/30 hover:shadow-[0_18px_34px_rgba(24,108,255,0.08)]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-primary/10 text-primary">
                <item.icon className="h-7 w-7" strokeWidth={2.1} />
              </div>
              <div>
                <p className="min-h-[38px] text-[15px] font-bold leading-5 text-foreground">{item.label}</p>
                <span className="mt-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary transition group-hover:translate-x-1 group-hover:bg-primary/15">
                  <ChevronRight className="h-5 w-5" strokeWidth={2.4} />
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-5 rounded-[12px] border border-border bg-card px-5 py-4 shadow-[0_12px_26px_rgba(31,91,160,0.045)]">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-[24px] font-bold leading-none text-foreground">Atividades recentes</h2>
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-semibold text-primary transition hover:gap-3"
          >
            Ver todas
            <ChevronRight className="h-5 w-5" strokeWidth={2.4} />
          </button>
        </div>

        <div className="divide-y divide-border">
          {recentActivities.map((activity) => (
            <article
              key={`${activity.company}-${activity.time}`}
              className="grid grid-cols-[48px_minmax(0,1fr)_130px_36px] items-center gap-3 py-2.5"
            >
              <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                <activity.icon className="h-5 w-5" strokeWidth={2.1} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold leading-5 text-foreground">
                  {activity.company} — {activity.activity}
                </p>
                <p className="truncate text-[13px] leading-5 text-muted-foreground">{activity.description}</p>
              </div>
              <time className="text-right text-[13px] font-medium text-muted-foreground">{activity.time}</time>
              <button
                type="button"
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-foreground transition hover:bg-accent"
                aria-label={`Ações para ${activity.company}`}
              >
                <MoreVertical className="h-5 w-5" />
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
