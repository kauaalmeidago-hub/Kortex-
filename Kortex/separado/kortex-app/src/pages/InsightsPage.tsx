import PageHeader from "@/components/PageHeader";
import { insightsData } from "@/data/mockData";
import {
  MessageSquare,
  CheckCircle,
  Clock,
  Star,
  TrendingUp,
  TrendingDown,
  BarChart2,
  ArrowUpRight,
  Settings,
} from "lucide-react";

const insightCards = [
  { label: "Mensagens Recebidas", value: String(insightsData.messagesReceived), delta: "+12%", positive: true, icon: MessageSquare },
  { label: "Conversas Atuais", value: String(insightsData.currentConversations), delta: String(insightsData.conversationsDelta), positive: insightsData.conversationsDelta >= 0, icon: CheckCircle },
  { label: "Tempo de Resposta", value: insightsData.responseTime, delta: "-18%", positive: true, icon: Clock },
  { label: "Leads Ganhos", value: String(insightsData.leadsWon), delta: "+8%", positive: true, icon: Star },
];

const weekData = [40, 65, 50, 80, 72, 90, 60];
const weekLabels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export default function InsightsPage() {
  const maxVal = Math.max(...weekData);

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Insights">
        <div className="flex items-center gap-2 ml-4">
          <input
            type="text"
            placeholder="Buscar"
            className="bg-secondary border border-border rounded-xl px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground w-64"
          />
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* Page header */}
          <div>
            <h2 className="text-2xl font-bold text-foreground">Alliancecorretora - Diretoria</h2>
            <p className="text-sm text-muted-foreground mt-1">Visão geral do desempenho da equipe</p>
            <div className="flex items-center gap-2 mt-4">
              {["Hoje", "Ontem", "Semana", "Mês", "Período"].map(period => (
                <button
                  key={period}
                  className={`px-4 py-2 text-xs rounded-full transition-colors ${
                    period === "Semana"
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {period}
                </button>
              ))}
              <span className="mx-2 text-border">|</span>
              <button className="px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full">Todos</button>
              <button className="px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full">Selecionar usuário ▾</button>
              <button className="flex items-center gap-1 px-4 py-2 text-xs border border-border rounded-full text-muted-foreground hover:text-foreground ml-2">
                <Settings size={12} /> Configurações
              </button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {insightCards.map(({ label, value, delta, positive, icon: Icon }) => (
              <div key={label} className="bg-card rounded-2xl p-5 shadow-sm border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Icon size={18} className="text-primary" />
                  </div>
                  <span className={`text-xs font-semibold flex items-center gap-1 ${positive ? "text-green-500" : "text-red-400"}`}>
                    {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {delta}
                  </span>
                </div>
                <p className="text-2xl font-bold text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Chart + Channels */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

            {/* Bar Chart */}
            <div className="xl:col-span-2 bg-card rounded-2xl p-6 shadow-sm border border-border">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="font-semibold text-foreground">Conversas esta semana</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Total de mensagens por dia</p>
                </div>
                <BarChart2 size={18} className="text-primary/60" />
              </div>
              <div className="flex items-end gap-3 h-36">
                {weekData.map((v, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t-lg bg-gradient-to-t from-primary to-primary/60 transition-all"
                      style={{ height: `${(v / maxVal) * 100}%` }}
                    />
                    <span className="text-xs text-muted-foreground">{weekLabels[i]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Channel breakdown */}
            <div className="bg-card rounded-2xl p-6 shadow-sm border border-border">
              <p className="font-semibold text-foreground mb-1">Fontes de Mensagens</p>
              <p className="text-xs text-muted-foreground mb-5">Origem das conversas</p>
              <div className="space-y-4">
                {insightsData.messageSources.map(({ name, count }) => {
                  const total = insightsData.messagesReceived || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={name}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-foreground font-medium">{name}</span>
                        <span className="text-muted-foreground">{count} ({pct}%)</span>
                      </div>
                      <div className="h-2 rounded-full bg-primary/10 overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Bottom stats */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-card rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <MessageSquare size={18} className="text-primary" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{insightsData.unansweredChats}</p>
              <p className="text-xs text-muted-foreground mt-1">Chats sem Respostas</p>
            </div>
            <div className="bg-card rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Clock size={18} className="text-primary" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{insightsData.longestWait}</p>
              <p className="text-xs text-muted-foreground mt-1">Mais Tempo Esperando</p>
            </div>
            <div className="bg-card rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Star size={18} className="text-primary" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{insightsData.activeLeads}</p>
              <p className="text-xs text-muted-foreground mt-1">Leads Ativos</p>
            </div>
            <div className="bg-card rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <CheckCircle size={18} className="text-primary" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{insightsData.leadsWon}</p>
              <p className="text-xs text-muted-foreground mt-1">Leads Ganhos</p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
