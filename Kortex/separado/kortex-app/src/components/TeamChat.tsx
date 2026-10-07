import { useState, useRef, useEffect } from "react";
import {
  Hash, ChevronDown, ChevronRight, Plus, Search, Send,
  Smile, Paperclip, Mic, Lock, Pin, MoreVertical, Star, UserPlus,
  Settings, MessageSquare, Check, CheckCheck, Clock,
  Reply, Forward, X, Phone, Video, Users, FileText
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───
type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read';

interface Server {
  id: string; name: string; initial: string; color: string; unread?: boolean; mentions?: number;
}

interface Channel { id: string; name: string; type: "text"; private?: boolean; unread?: number; }
interface Category { name: string; channels: Channel[]; }

interface Msg {
  id: string; senderId: string; user: string; initial: string; color: string;
  text: string; time: string; date?: string;
  reactions?: { emoji: string; count: number; me?: boolean }[];
  thread?: number; pinned?: boolean;
  role?: string; status: MessageStatus;
  quotedMessage?: { user: string; text: string };
  contentType?: 'text' | 'document';
  isForwarded?: boolean;
}

interface Member {
  id: string; name: string; initial: string; color: string;
  role: string; status: "online" | "idle" | "dnd" | "offline";
  activity?: string; typing?: boolean;
}

// ─── Data ───
const servers: Server[] = [
  { id: "alliance", name: "Alliance CRM", initial: "A", color: "hsl(var(--primary))", mentions: 3 },
  { id: "vendas", name: "Equipe Vendas", initial: "V", color: "hsl(142, 71%, 45%)" },
  { id: "suporte", name: "Suporte", initial: "S", color: "hsl(45, 93%, 58%)", unread: true },
  { id: "dev", name: "Desenvolvimento", initial: "D", color: "hsl(200, 80%, 50%)" },
];

const categories: Record<string, Category[]> = {
  alliance: [
    { name: "INFORMAÇÕES", channels: [
      { id: "boas-vindas", name: "boas-vindas", type: "text" },
      { id: "regras", name: "regras", type: "text" },
      { id: "anuncios", name: "anúncios", type: "text", unread: 2 },
    ]},
    { name: "GERAL", channels: [
      { id: "geral", name: "geral", type: "text", unread: 3 },
      { id: "off-topic", name: "off-topic", type: "text" },
      { id: "ideias", name: "ideias-e-sugestões", type: "text" },
    ]},
    { name: "PROJETOS", channels: [
      { id: "proj-pme", name: "projeto-pme", type: "text", unread: 1 },
      { id: "proj-pf", name: "projeto-pf", type: "text" },
      { id: "proj-cct", name: "projeto-cct", type: "text" },
      { id: "seguros", name: "seguros", type: "text", private: true },
    ]},
  ],
};

const channelMsgs: Record<string, Msg[]> = {
  geral: [
    { id: "1", senderId: "lm", user: "Luísa Mendes", initial: "LM", color: "hsl(258,74%,58%)", role: "Admin",
      text: "Bom dia equipe! 🌅 Reunião de alinhamento às 10h na sala de voz principal. Pauta: resultados do Q1 e metas do Q2.",
      time: "08:30", date: "Hoje", status: "read",
      reactions: [{ emoji: "👍", count: 5, me: true }, { emoji: "☕", count: 3 }], thread: 4 },
    { id: "2", senderId: "cs", user: "Carlos Silva", initial: "CS", color: "hsl(142,71%,45%)", role: "Comercial",
      text: "Pessoal, atualizei o relatório de vendas do Q1. Os números estão muito bons! Crescimento de **23%** em relação ao trimestre anterior. 📈",
      time: "09:15", status: "read",
      reactions: [{ emoji: "🎉", count: 7 }, { emoji: "🚀", count: 4 }] },
    { id: "3", senderId: "if", user: "Isadora Ferreira", initial: "IF", color: "hsl(330,80%,55%)", role: "Operações",
      text: "Alguém pode me ajudar com o acesso ao novo sistema? Preciso configurar minhas integrações com o pipeline de vendas.",
      time: "09:42", status: "read", thread: 2 },
    { id: "4", senderId: "to", user: "Thiago Oliveira", initial: "TO", color: "hsl(45,93%,47%)", role: "Comercial",
      text: "🎯 Acabei de fechar um contrato importante com a **LogTech**! Valor: R$ 150k/ano. Maior contrato do trimestre!",
      time: "10:05", status: "delivered", pinned: true,
      reactions: [{ emoji: "🎯", count: 4 }, { emoji: "💰", count: 8, me: true }, { emoji: "🔥", count: 6 }] },
    { id: "5", senderId: "fc", user: "Fernanda Costa", initial: "FC", color: "hsl(200,80%,50%)", role: "Marketing",
      text: "Parabéns Thiago!! Isso vai impactar muito positivamente nossas metas. Vou preparar um case study sobre esse deal.",
      time: "10:08", status: "delivered" },
    { id: "6", senderId: "me", user: "Kauã Comercial", initial: "KC", color: "hsl(var(--primary))", role: "Diretoria",
      text: "@Thiago excelente trabalho! Vamos marcar uma call na sala de voz para discutir a implementação e onboarding do cliente.",
      time: "10:12", status: "read", thread: 1,
      quotedMessage: { user: "Thiago Oliveira", text: "🎯 Acabei de fechar um contrato importante com a LogTech!" } },
    { id: "7", senderId: "bot", user: "Bot Alliance", initial: "🤖", color: "hsl(var(--primary))", role: "Bot",
      text: "📊 **Resumo diário**: 45 leads qualificados | 12 propostas enviadas | 3 contratos fechados | Meta: 78% atingida",
      time: "12:00", status: "read" },
  ],
  // DM conversations
  "dm-lm": [
    { id: "dm1", senderId: "lm", user: "Luísa Mendes", initial: "LM", color: "hsl(258,74%,58%)",
      text: "Kauã, preciso da sua aprovação para o orçamento do Q2.", time: "09:00", date: "Hoje", status: "read" },
    { id: "dm2", senderId: "me", user: "Kauã Comercial", initial: "KC", color: "hsl(var(--primary))",
      text: "Pode enviar o documento que eu analiso agora.", time: "09:05", status: "read" },
    { id: "dm3", senderId: "lm", user: "Luísa Mendes", initial: "LM", color: "hsl(258,74%,58%)",
      text: "📄 orcamento_q2_2026.pdf", time: "09:08", status: "read", contentType: "document" },
    { id: "dm4", senderId: "me", user: "Kauã Comercial", initial: "KC", color: "hsl(var(--primary))",
      text: "Aprovado! ✅ Valores dentro do esperado.", time: "09:15", status: "read" },
  ],
  "dm-cs": [
    { id: "dmc1", senderId: "cs", user: "Carlos Silva", initial: "CS", color: "hsl(142,71%,45%)",
      text: "Chefe, o cliente da MegaTech pediu desconto de 15%. Posso conceder?", time: "10:30", date: "Hoje", status: "read" },
    { id: "dmc2", senderId: "me", user: "Kauã Comercial", initial: "KC", color: "hsl(var(--primary))",
      text: "Qual o valor total do contrato?", time: "10:32", status: "read" },
    { id: "dmc3", senderId: "cs", user: "Carlos Silva", initial: "CS", color: "hsl(142,71%,45%)",
      text: "R$ 95k/ano. Com 15% fica R$ 80.750/ano.", time: "10:33", status: "read" },
    { id: "dmc4", senderId: "me", user: "Kauã Comercial", initial: "KC", color: "hsl(var(--primary))",
      text: "Pode dar até 10%. Se insistir, fecha em 12% máximo. 💰", time: "10:35", status: "delivered" },
  ],
  "dm-to": [
    { id: "dmt1", senderId: "me", user: "Kauã Comercial", initial: "KC", color: "hsl(var(--primary))",
      text: "Thiago, parabéns pelo contrato da LogTech! 🎉", time: "10:20", date: "Hoje", status: "read" },
    { id: "dmt2", senderId: "to", user: "Thiago Oliveira", initial: "TO", color: "hsl(45,93%,47%)",
      text: "Valeu chefe! Foi uma negociação intensa, mas conseguimos! 🚀", time: "10:22", status: "read" },
    { id: "dmt3", senderId: "me", user: "Kauã Comercial", initial: "KC", color: "hsl(var(--primary))",
      text: "Vamos agendar o onboarding pra segunda. Prepara a apresentação.", time: "10:25", status: "read" },
  ],
  "dm-fc": [
    { id: "dmf1", senderId: "fc", user: "Fernanda Costa", initial: "FC", color: "hsl(200,80%,50%)",
      text: "Kauã, finalizei a campanha de e-mail marketing. Resultados incríveis!", time: "11:00", date: "Hoje", status: "read" },
    { id: "dmf2", senderId: "fc", user: "Fernanda Costa", initial: "FC", color: "hsl(200,80%,50%)",
      text: "Taxa de abertura de 42% e conversão de 8.5% 📈", time: "11:01", status: "delivered" },
  ],
  "dm-if": [
    { id: "dmi1", senderId: "if", user: "Isadora Ferreira", initial: "IF", color: "hsl(330,80%,55%)",
      text: "Preciso de acesso ao módulo de integrações. Pode liberar?", time: "14:00", date: "Hoje", status: "read" },
    { id: "dmi2", senderId: "me", user: "Kauã Comercial", initial: "KC", color: "hsl(var(--primary))",
      text: "Liberado! Verifica agora por favor.", time: "14:05", status: "read" },
  ],
  "dm-rs": [
    { id: "dmr1", senderId: "rs", user: "Rafael Souza", initial: "RS", color: "hsl(15,80%,55%)",
      text: "Relatório semanal de suporte enviado por e-mail. 5 tickets críticos resolvidos.", time: "16:00", date: "Ontem", status: "read" },
  ],
  "dm-ap": [
    { id: "dma1", senderId: "ap", user: "Ana Paula", initial: "AP", color: "hsl(280,60%,55%)",
      text: "Kauã, as notas fiscais do mês foram todas processadas. ✅", time: "15:30", date: "Ontem", status: "read" },
    { id: "dma2", senderId: "me", user: "Kauã Comercial", initial: "KC", color: "hsl(var(--primary))",
      text: "Perfeito Ana, obrigado! 👍", time: "15:45", status: "read" },
  ],
};

const members: Member[] = [
  { id: "lm", name: "Luísa Mendes", initial: "LM", color: "hsl(258,74%,58%)", role: "Admin", status: "online", activity: "Editando CRM" },
  { id: "cs", name: "Carlos Silva", initial: "CS", color: "hsl(142,71%,45%)", role: "Comercial", status: "online" },
  { id: "to", name: "Thiago Oliveira", initial: "TO", color: "hsl(45,93%,47%)", role: "Comercial", status: "online", activity: "Em chamada" },
  { id: "fc", name: "Fernanda Costa", initial: "FC", color: "hsl(200,80%,50%)", role: "Marketing", status: "idle", typing: true },
  { id: "if", name: "Isadora Ferreira", initial: "IF", color: "hsl(330,80%,55%)", role: "Operações", status: "idle" },
  { id: "rs", name: "Rafael Souza", initial: "RS", color: "hsl(15,80%,55%)", role: "Suporte", status: "dnd", activity: "Não perturbe" },
  { id: "kc", name: "Kauã Comercial", initial: "KC", color: "hsl(var(--primary))", role: "Diretoria", status: "online" },
  { id: "ap", name: "Ana Paula", initial: "AP", color: "hsl(280,60%,55%)", role: "Financeiro", status: "offline" },
];


const roleColors: Record<string, string> = {
  Admin: "text-[hsl(258,74%,58%)]",
  Comercial: "text-[hsl(142,71%,50%)]",
  Marketing: "text-[hsl(200,80%,55%)]",
  "Operações": "text-[hsl(330,80%,55%)]",
  Suporte: "text-[hsl(45,93%,50%)]",
  Bot: "text-primary",
  Diretoria: "text-primary",
  Financeiro: "text-[hsl(280,60%,55%)]",
};

// ─── Status Icon (WhatsApp-style) ───
function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === 'pending') return <Clock className="h-3 w-3 text-muted-foreground" />;
  if (status === 'sent') return <Check className="h-3 w-3 text-muted-foreground" />;
  if (status === 'delivered') return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
  return <CheckCheck className="h-3 w-3 text-sky-500" />;
}

// ─── Server Bar (Slack) ───
function ServerBar({ active, setActive }: { active: string; setActive: (id: string) => void }) {
  return (
    <div className="flex w-[64px] min-w-[64px] flex-col items-center gap-2 overflow-y-auto bg-secondary/80 py-3 scrollbar-thin">
      <button
        onClick={() => setActive("alliance")}
        className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold transition-all duration-200 cursor-pointer ${
          active === "alliance" ? "bg-primary text-primary-foreground rounded-xl" : "bg-card text-foreground hover:bg-primary hover:text-primary-foreground hover:rounded-xl"
        }`}
      >A</button>
      <div className="w-8 h-[2px] bg-border rounded-full" />
      {servers.slice(1).map(s => (
        <div key={s.id} className="relative">
          <button
            onClick={() => setActive(s.id)}
            title={s.name}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-bold transition-all duration-200 cursor-pointer ${
              active === s.id ? "rounded-xl text-primary-foreground" : "bg-card text-foreground hover:rounded-xl hover:text-primary-foreground"
            }`}
            style={{ background: active === s.id ? s.color : undefined }}
            onMouseEnter={e => { if (active !== s.id) (e.currentTarget.style.background = s.color); }}
            onMouseLeave={e => { if (active !== s.id) (e.currentTarget.style.background = ""); }}
          >{s.initial}</button>
          {s.unread && active !== s.id && <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 rounded-full bg-foreground" />}
          {s.mentions && s.mentions > 0 && active !== s.id && (
            <div className="absolute -bottom-0.5 -right-0.5 bg-destructive text-destructive-foreground text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-secondary/80">
              {s.mentions}
            </div>
          )}
        </div>
      ))}
      <div className="w-8 h-[2px] bg-border rounded-full" />
      <button className="w-12 h-12 rounded-2xl bg-card flex items-center justify-center text-success hover:bg-success hover:text-primary-foreground hover:rounded-xl transition-all duration-200 cursor-pointer">
        <Plus size={20} />
      </button>
    </div>
  );
}

// ─── Channel Sidebar (Slack) ───
function ChannelSidebar({
  serverId, activeChannel, setActiveChannel
}: {
  serverId: string; activeChannel: string; setActiveChannel: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const serverName = servers.find(s => s.id === serverId)?.name || serverId;
  const cats = categories[serverId] || categories.alliance;

  const toggleCat = (name: string) =>
    setCollapsed(p => p.includes(name) ? p.filter(n => n !== name) : [...p, name]);

  return (
    <div className="flex w-[220px] min-w-[220px] flex-col border-r border-border bg-card xl:w-[232px] xl:min-w-[232px]">
      <button className="flex items-center justify-between px-4 py-3 border-b border-border hover:bg-muted/50 transition-colors cursor-pointer">
        <span className="text-[14px] font-bold text-foreground truncate">{serverName}</span>
        <ChevronDown size={16} className="text-muted-foreground shrink-0" />
      </button>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
        {cats.map(cat => (
          <div key={cat.name} className="mb-1">
            <button
              onClick={() => toggleCat(cat.name)}
              className="w-full flex items-center gap-0.5 px-1 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer group"
            >
              {collapsed.includes(cat.name) ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
              <span>{cat.name}</span>
              <Plus size={12} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground" />
            </button>
            {!collapsed.includes(cat.name) && cat.channels.map(ch => (
              <button
                key={ch.id}
                onClick={() => ch.type === "text" && setActiveChannel(ch.id)}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[13px] transition-all cursor-pointer group ${
                  activeChannel === ch.id
                    ? "bg-muted/80 text-foreground font-medium"
                    : ch.unread ? "text-foreground font-medium hover:bg-muted/50" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                {ch.private ? <Lock size={16} className="shrink-0 opacity-60" />
                  : <Hash size={16} className="shrink-0 opacity-60" />}
                <span className="truncate flex-1 text-left">{ch.name}</span>
                {ch.unread && ch.unread > 0 && (
                  <span className="bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{ch.unread}</span>
                )}
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <UserPlus size={12} className="text-muted-foreground hover:text-foreground" />
                  <Settings size={12} className="text-muted-foreground hover:text-foreground" />
                </div>
              </button>
            ))}
          </div>
        ))}

        {/* DM section — WhatsApp-style private conversations */}
        <div className="mt-2 pt-2 border-t border-border">
          <button
            onClick={() => toggleCat("MENSAGENS DIRETAS")}
            className="w-full flex items-center gap-0.5 px-1 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer group"
          >
            {collapsed.includes("MENSAGENS DIRETAS") ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
            <span>MENSAGENS DIRETAS</span>
            <Plus size={12} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground" />
          </button>
          {!collapsed.includes("MENSAGENS DIRETAS") && members.filter(m => m.id !== "kc").map(m => {
            const dmId = `dm-${m.id}`;
            const dmMsgs = channelMsgs[dmId];
            const lastMsg = dmMsgs?.[dmMsgs.length - 1];
            const hasUnread = m.id === "fc" || m.id === "rs";
            return (
              <button
                key={dmId}
                onClick={() => setActiveChannel(dmId)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-2 rounded-md transition-all cursor-pointer group",
                  activeChannel === dmId
                    ? "bg-muted/80"
                    : "hover:bg-muted/50"
                )}
              >
                <div className="relative shrink-0">
                  <div
                    className={cn("w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-primary-foreground", m.status === "offline" && "opacity-50")}
                    style={{ background: m.color }}
                  >
                    {m.initial}
                  </div>
                  <div className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card",
                    m.status === "online" ? "bg-emerald-500" : m.status === "idle" ? "bg-amber-500" : m.status === "dnd" ? "bg-destructive" : "bg-muted-foreground/40"
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={cn("text-[12px] font-medium truncate", activeChannel === dmId ? "text-foreground" : "text-foreground/80")}>{m.name}</span>
                    {lastMsg && (
                      <span className="text-[9px] text-muted-foreground shrink-0">{lastMsg.time}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 min-w-0 flex-1">
                      {m.typing ? (
                        <span className="text-[10px] text-emerald-500 italic truncate">digitando...</span>
                      ) : lastMsg ? (
                        <>
                          {lastMsg.senderId === "me" && <StatusIcon status={lastMsg.status} />}
                          <span className="text-[10px] text-muted-foreground truncate">{lastMsg.text}</span>
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic truncate">Iniciar conversa</span>
                      )}
                    </div>
                    {hasUnread && (
                      <div className="min-w-[18px] h-[18px] rounded-full bg-emerald-500 flex items-center justify-center text-[9px] font-bold text-white px-1 shrink-0 ml-1">
                        {m.id === "fc" ? 2 : 1}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* User panel */}
      <div className="border-t border-border px-2 py-2 flex items-center gap-2 bg-secondary/50">
        <div className="relative">
          <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-bold text-primary">KC</div>
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-success border-2 border-card" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-foreground truncate">Kauã Comercial</div>
          <div className="text-[10px] text-muted-foreground truncate">Online</div>
        </div>
        <div className="flex gap-0.5">
          {[Settings].map((Icon, i) => (
            <button key={i} className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer">
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Chat Area (WhatsApp-style messages inside Slack layout) ───
function ChatArea({
  channelId, msgs, onSend
}: {
  channelId: string; msgs: Msg[]; onSend: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput("");
    setReplyTo(null);
  };

  const isDm = channelId.startsWith("dm-");
  const dmMember = isDm ? members.find(m => m.id === channelId.replace("dm-", "")) : null;
  const ch = !isDm ? (categories.alliance || []).flatMap(c => c.channels).find(c => c.id === channelId) : null;
  const chName = isDm ? dmMember?.name || channelId : (ch?.name || channelId);

  // Find typing members
  const typingMembers = isDm
    ? (dmMember?.typing ? [dmMember] : [])
    : members.filter(m => m.typing);

  const presenceText = isDm && dmMember
    ? dmMember.typing ? "digitando..." : dmMember.status === "online" ? "online" : dmMember.status === "idle" ? "ausente" : dmMember.status === "dnd" ? "não perturbe" : "offline"
    : null;

  let lastDate = "";

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-background">
      {/* Header — adapts for DM vs Channel */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card shrink-0 shadow-sm">
        <div className="flex items-center gap-2">
          {isDm && dmMember ? (
            <>
              <div className="relative">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[9px] font-bold text-primary-foreground" style={{ background: dmMember.color }}>
                  {dmMember.initial}
                </div>
                <div className={cn(
                  "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card",
                  dmMember.status === "online" ? "bg-emerald-500" : dmMember.status === "idle" ? "bg-amber-500" : dmMember.status === "dnd" ? "bg-destructive" : "bg-muted-foreground/40"
                )} />
              </div>
              <div>
                <span className="text-[14px] font-bold text-foreground">{dmMember.name}</span>
                <p className={cn(
                  "text-[11px]",
                  dmMember.typing ? "text-emerald-500 font-medium" : "text-muted-foreground"
                )}>
                  {presenceText}
                </p>
              </div>
            </>
          ) : (
            <>
              <Hash size={18} className="text-muted-foreground" />
              <span className="text-[14px] font-bold text-foreground">{chName}</span>
              <div className="h-4 w-[1px] bg-border mx-1" />
              <span className="text-[12px] text-muted-foreground truncate">Canal para discussões gerais da equipe</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {[Phone, Video, Pin, Users, Search].map((Icon, i) => (
            <button key={i} className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <Icon size={16} />
            </button>
          ))}
          <div className="flex items-center gap-1 ml-1 bg-secondary border border-border rounded-md px-2 py-1">
            <Search size={13} className="text-muted-foreground" />
            <input className="bg-transparent border-none outline-none text-[12px] w-[120px] text-foreground placeholder:text-muted-foreground" placeholder="Buscar" />
          </div>
        </div>
      </div>

      {/* WhatsApp-style messages */}
      <div
        className="flex-1 overflow-y-auto scrollbar-thin px-6 py-3 flex flex-col"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      >
        {/* Welcome + E2E */}
        <div className="mt-auto mb-2 pt-4">
          {isDm && dmMember ? (
            <>
              <div className="w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold text-primary-foreground mb-3"
                style={{ background: dmMember.color }}>
                {dmMember.initial}
              </div>
              <h3 className="text-xl font-bold text-foreground mb-1">{dmMember.name}</h3>
              <p className="text-sm text-muted-foreground mb-2">{dmMember.role} · {dmMember.status === "online" ? "Online" : "Offline"}</p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <Hash size={28} className="text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-1">Bem-vindo ao #{chName}!</h3>
              <p className="text-sm text-muted-foreground mb-2">Este é o início do canal #{chName}.</p>
            </>
          )}
          <div className="self-center inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-4">
            <Lock className="h-3 w-3 text-amber-600" />
            <span className="text-[10px] text-amber-600">Mensagens protegidas com criptografia de ponta a ponta</span>
          </div>
        </div>

        {msgs.map((m) => {
          const showDate = m.date && m.date !== lastDate;
          if (m.date) lastDate = m.date;
          const isMe = m.senderId === "me";

          return (
            <div key={m.id}>
              {showDate && (
                <div className="flex justify-center my-3">
                  <span className="bg-card px-3 py-1 rounded-lg text-[11px] text-muted-foreground shadow-sm border border-border">
                    {m.date}
                  </span>
                </div>
              )}
              <div className={cn("flex mb-1.5 group", isMe ? "justify-end" : "justify-start")}>
                {/* Avatar (left side for others) */}
                {!isMe && (
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[9px] font-bold text-primary-foreground shrink-0 mt-auto mr-2"
                    style={{ background: m.color }}>
                    {m.initial}
                  </div>
                )}

                <div
                  className={cn(
                    "relative max-w-[74%] rounded-lg px-3 py-2 shadow-sm xl:max-w-[680px]",
                    isMe
                      ? "bg-emerald-500/15 border border-emerald-500/10 rounded-br-sm"
                      : "bg-card border border-border rounded-bl-sm"
                  )}
                >
                  {/* Sender name + role */}
                  {!isMe && (
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[12px] font-bold ${roleColors[m.role || ""] || "text-foreground"}`}>{m.user}</span>
                      {m.role && m.role !== "Bot" && (
                        <span className="text-[9px] font-medium bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{m.role}</span>
                      )}
                      {m.role === "Bot" && (
                        <span className="text-[9px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded">BOT</span>
                      )}
                    </div>
                  )}

                  {/* Forwarded */}
                  {m.isForwarded && (
                    <p className="text-[10px] text-muted-foreground italic flex items-center gap-1 mb-0.5">
                      <Forward className="h-3 w-3" /> Encaminhada
                    </p>
                  )}

                  {/* Quoted message */}
                  {m.quotedMessage && (
                    <div className="bg-muted/50 border-l-2 border-primary rounded px-2 py-1 mb-1.5">
                      <p className="text-[10px] font-semibold text-primary">{m.quotedMessage.user}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{m.quotedMessage.text}</p>
                    </div>
                  )}

                  {/* Pinned badge */}
                  {m.pinned && (
                    <div className="flex items-center gap-1 text-[9px] text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded-full w-fit mb-1">
                      <Pin size={8} /> Fixado
                    </div>
                  )}

                  {/* Content */}
                  {m.contentType === 'document' ? (
                    <div className="flex items-center gap-2 bg-muted/30 rounded px-2 py-1.5 mb-1">
                      <FileText className="h-8 w-8 text-primary shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-foreground">{m.text}</p>
                        <p className="text-[10px] text-muted-foreground">PDF · 2.4 MB</p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[13px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
                      {m.text.split(/(\*\*.*?\*\*)/g).map((part, i) =>
                        part.startsWith("**") && part.endsWith("**")
                          ? <strong key={i} className="font-bold text-foreground">{part.slice(2, -2)}</strong>
                          : <span key={i}>{part}</span>
                      )}
                    </div>
                  )}

                  {/* Reactions */}
                  {m.reactions && m.reactions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {m.reactions.map((r, ri) => (
                        <button key={ri} className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] transition-all cursor-pointer ${
                          r.me ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/30"
                        }`}>
                          <span>{r.emoji}</span>
                          <span className="font-medium">{r.count}</span>
                        </button>
                      ))}
                      <button className="w-5 h-5 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:border-primary/30 transition-all cursor-pointer opacity-0 group-hover:opacity-100">
                        <Smile size={10} />
                      </button>
                    </div>
                  )}

                  {/* Thread */}
                  {m.thread && (
                    <button className="flex items-center gap-1 mt-1.5 text-[10px] text-primary hover:underline cursor-pointer bg-primary/5 px-2 py-1 rounded-md w-fit">
                      <MessageSquare size={11} />
                      {m.thread} {m.thread === 1 ? "resposta" : "respostas"}
                    </button>
                  )}

                  {/* Time + Status (WhatsApp-style) */}
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">{m.time}</span>
                    {isMe && <StatusIcon status={m.status} />}
                  </div>

                  {/* Hover actions */}
                  <div className="absolute -top-3 right-1 hidden group-hover:flex gap-0.5 bg-card border border-border rounded-md shadow-sm px-0.5 py-0.5 z-10">
                    {[Smile, Reply, Forward, Star, MoreVertical].map((Icon, i) => (
                      <button
                        key={i}
                        onClick={() => { if (Icon === Reply) setReplyTo(m); }}
                        className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all cursor-pointer"
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Avatar (right side for me) */}
                {isMe && (
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[9px] font-bold text-primary-foreground shrink-0 mt-auto ml-2"
                    style={{ background: m.color }}>
                    {m.initial}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Typing indicator */}
      {typingMembers.length > 0 && (
        <div className="px-6 py-1 border-t border-border/50">
          <span className="text-[11px] text-emerald-500 italic">
            {typingMembers.map(m => m.name.split(' ')[0]).join(', ')} {typingMembers.length === 1 ? 'está' : 'estão'} digitando...
          </span>
        </div>
      )}

      {/* Reply bar */}
      {replyTo && (
        <div className="px-4 pt-2 flex items-center gap-2 border-t border-border bg-card">
          <div className="flex-1 bg-muted/50 border-l-2 border-primary rounded px-3 py-1.5">
            <p className="text-[10px] font-semibold text-primary">{replyTo.user}</p>
            <p className="text-[11px] text-muted-foreground truncate">{replyTo.text}</p>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* WhatsApp-style input */}
      <div className="px-4 py-2 shrink-0 flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <button className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors cursor-pointer">
            <Smile size={20} />
          </button>
          <button className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors cursor-pointer">
            <Paperclip size={20} />
          </button>
        </div>
        <div className="flex-1 flex items-center bg-card border border-border rounded-lg px-3 py-1 focus-within:border-primary/50 transition-all">
          <textarea
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            className="flex-1 bg-transparent border-none outline-none text-foreground text-[14px] resize-none max-h-24 leading-relaxed placeholder:text-muted-foreground py-2"
            placeholder={isDm ? `Mensagem para ${chName}` : `Conversar em #${chName}`}
          />
        </div>
        {input.trim() ? (
          <button onClick={handleSend} className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white hover:bg-emerald-600 transition-colors cursor-pointer">
            <Send size={18} />
          </button>
        ) : (
          <button className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white hover:bg-emerald-600 transition-colors cursor-pointer">
            <Mic size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Members Sidebar (Slack) ───
function MembersSidebar() {
  const grouped: Record<string, Member[]> = {};
  members.forEach(m => {
    const group = m.status === "offline" ? "OFFLINE" : m.status === "dnd" ? "NÃO PERTURBE" : "ONLINE";
    (grouped[group] = grouped[group] || []).push(m);
  });
  const order = ["ONLINE", "NÃO PERTURBE", "OFFLINE"];

  return (
    <div className="hidden w-[232px] min-w-[232px] flex-col overflow-y-auto border-l border-border bg-card scrollbar-thin 2xl:flex">
      {order.map(group => grouped[group] && (
        <div key={group} className="px-3 pt-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
            {group} — {grouped[group].length}
          </div>
          {grouped[group].map((m) => (
            <button key={m.id} className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors cursor-pointer group">
              <div className="relative shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-primary-foreground ${m.status === "offline" ? "opacity-40" : ""}`}
                  style={{ background: m.color }}>
                  {m.initial}
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${
                  m.status === "online" ? "bg-success" : m.status === "idle" ? "bg-warning" : m.status === "dnd" ? "bg-destructive" : "bg-muted-foreground/40"
                }`} />
              </div>
              <div className={`flex-1 min-w-0 ${m.status === "offline" ? "opacity-40" : ""}`}>
                <span className={`text-[13px] font-medium block truncate ${roleColors[m.role] || "text-foreground"}`}>{m.name}</span>
                {m.typing ? (
                  <span className="text-[10px] text-emerald-500 italic block truncate">digitando...</span>
                ) : m.activity ? (
                  <span className="text-[10px] text-muted-foreground block truncate">{m.activity}</span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Main ───
export default function TeamChat() {
  const [activeServer, setActiveServer] = useState("alliance");
  const [activeChannel, setActiveChannel] = useState("geral");
  const [messages, setMessages] = useState<Record<string, Msg[]>>(channelMsgs);

  const currentMsgs = messages[activeChannel] || [];

  const handleSend = (text: string) => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const newId = Date.now().toString();
    const newMsg: Msg = {
      id: newId, senderId: "me", user: "Kauã Comercial", initial: "KC",
      color: "hsl(var(--primary))", role: "Diretoria", text, time, status: "sent",
    };
    setMessages(prev => ({ ...prev, [activeChannel]: [...(prev[activeChannel] || []), newMsg] }));

    // Simulate WhatsApp status progression
    setTimeout(() => {
      setMessages(prev => ({
        ...prev,
        [activeChannel]: (prev[activeChannel] || []).map(m => m.id === newId ? { ...m, status: 'delivered' as MessageStatus } : m),
      }));
    }, 1000);
    setTimeout(() => {
      setMessages(prev => ({
        ...prev,
        [activeChannel]: (prev[activeChannel] || []).map(m => m.id === newId ? { ...m, status: 'read' as MessageStatus } : m),
      }));
    }, 3000);
  };

  return (
    <div className="flex h-full overflow-hidden">
      <ServerBar active={activeServer} setActive={setActiveServer} />
      <ChannelSidebar serverId={activeServer} activeChannel={activeChannel} setActiveChannel={setActiveChannel} />
      <ChatArea channelId={activeChannel} msgs={currentMsgs} onSend={handleSend} />
      <MembersSidebar />
    </div>
  );
}
