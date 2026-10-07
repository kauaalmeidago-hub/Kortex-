import { useState } from "react";
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  Mic, MicOff, Volume2, VolumeX, Pause, Play, UserPlus,
  Clock, Search, MoreVertical, ChevronDown, ChevronRight,
  ArrowUpRight, ArrowDownLeft, X, Hash, Star, Voicemail,
  Settings, Headphones, CircleDot
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Data ───

interface Extension {
  ramal: string;
  nome: string;
  status: "disponível" | "em ligação" | "ausente" | "offline";
  currentCall?: string;
}

const extensions: Extension[] = [
  { ramal: "100", nome: "Isadora Guimarães", status: "em ligação", currentCall: "(31) 9 8765-4321" },
  { ramal: "101", nome: "Fernanda Rezende", status: "disponível" },
];

interface CallLog {
  id: string;
  type: "incoming" | "outgoing" | "missed";
  contact: string;
  number: string;
  time: string;
  date: string;
  duration?: string;
  ramal: string;
}

const callHistory: CallLog[] = [
  { id: "1", type: "outgoing", contact: "Paulo — TRANSLOGMG", number: "(31) 3058-2126", time: "15:42", date: "Hoje", duration: "12:34", ramal: "100" },
  { id: "2", type: "incoming", contact: "Thiago — Comercial", number: "(31) 9 9876-5432", time: "14:15", date: "Hoje", duration: "05:21", ramal: "101" },
  { id: "3", type: "missed", contact: "Número desconhecido", number: "(11) 4002-8922", time: "13:05", date: "Hoje", ramal: "100" },
  { id: "4", type: "outgoing", contact: "Fernanda — LogTech", number: "(31) 3222-1100", time: "11:30", date: "Hoje", duration: "08:45", ramal: "100" },
  { id: "5", type: "incoming", contact: "Maria — Seguros ABC", number: "(21) 2222-3333", time: "10:00", date: "Hoje", duration: "15:12", ramal: "101" },
  { id: "6", type: "outgoing", contact: "João — PME Solutions", number: "(31) 9 8888-7777", time: "16:30", date: "Ontem", duration: "03:50", ramal: "100" },
  { id: "7", type: "missed", contact: "Carlos — Investidor", number: "(11) 9 7654-3210", time: "09:15", date: "Ontem", ramal: "101" },
  { id: "8", type: "incoming", contact: "Ana — RH Corp", number: "(31) 3333-4444", time: "08:00", date: "Ontem", duration: "22:10", ramal: "100" },
];

const favorites = [
  { name: "Paulo — TRANSLOGMG", number: "(31) 3058-2126" },
  { name: "Suporte FalePaco", number: "(31) 3058-2126" },
  { name: "Luísa Mendes", number: "(31) 9 9999-1111" },
];

// ─── Sidebar: Extensions & History ───
function PhoneSidebar({
  activeTab, setActiveTab, selectedCall, setSelectedCall
}: {
  activeTab: "recentes" | "ramais" | "favoritos";
  setActiveTab: (t: "recentes" | "ramais" | "favoritos") => void;
  selectedCall: string | null;
  setSelectedCall: (id: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="w-[300px] min-w-[300px] bg-card border-r border-border flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Phone size={14} className="text-primary-foreground" />
            </div>
            <div>
              <div className="text-[13px] font-bold text-foreground">Telefone</div>
              <div className="text-[10px] text-muted-foreground">FalePaco · (31) 3058-2126</div>
            </div>
          </div>
          <button className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer">
            <Settings size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-2.5 py-1.5">
          <Search size={13} className="text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-foreground text-[12px] w-full placeholder:text-muted-dimmer"
            placeholder="Buscar contato ou número..."
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(["recentes", "ramais", "favoritos"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 text-[11px] font-semibold py-2.5 transition-colors cursor-pointer capitalize ${
              activeTab === tab ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {activeTab === "recentes" && (
          <div className="py-1">
            {callHistory.filter(c =>
              !searchQuery || c.contact.toLowerCase().includes(searchQuery.toLowerCase()) || c.number.includes(searchQuery)
            ).map(call => {
              const Icon = call.type === "incoming" ? ArrowDownLeft : call.type === "outgoing" ? ArrowUpRight : PhoneMissed;
              const iconColor = call.type === "missed" ? "text-destructive" : call.type === "incoming" ? "text-success" : "text-primary";
              return (
                <button
                  key={call.id}
                  onClick={() => setSelectedCall(call.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer ${
                    selectedCall === call.id ? "bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-full bg-muted flex items-center justify-center ${iconColor}`}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className={`text-[12.5px] font-semibold truncate ${call.type === "missed" ? "text-destructive" : "text-foreground"}`}>
                      {call.contact}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{call.number}</span>
                      <span>·</span>
                      <span>Ramal {call.ramal}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-muted-foreground">{call.time}</div>
                    {call.duration && <div className="text-[9px] text-muted-dimmer">{call.duration}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {activeTab === "ramais" && (
          <div className="py-2 px-3 space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1 mb-2">
              Ramais ativos · {extensions.length}
            </div>
            {extensions.map(ext => (
              <div key={ext.ramal} className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/50 border border-border">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center text-[11px] font-bold text-primary">
                    {ext.nome.split(" ").map(n => n[0]).join("").slice(0, 2)}
                  </div>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${
                    ext.status === "disponível" ? "bg-success" : ext.status === "em ligação" ? "bg-destructive" : ext.status === "ausente" ? "bg-warning" : "bg-muted-foreground/40"
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-foreground truncate">{ext.nome}</div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Hash size={9} />
                    <span>Ramal {ext.ramal}</span>
                    <span>·</span>
                    <span className={`font-medium ${
                      ext.status === "disponível" ? "text-success" : ext.status === "em ligação" ? "text-destructive" : ""
                    }`}>{ext.status}</span>
                  </div>
                  {ext.currentCall && (
                    <div className="flex items-center gap-1 text-[9px] text-destructive mt-0.5">
                      <CircleDot size={8} className="animate-pulse" />
                      <span>{ext.currentCall}</span>
                    </div>
                  )}
                </div>
                <button className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center text-success hover:bg-success hover:text-primary-foreground transition-all cursor-pointer">
                  <Phone size={13} />
                </button>
              </div>
            ))}

            {/* Server info */}
            <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-border">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Servidor SIP</div>
              <div className="space-y-1">
                <InfoRow label="Host" value="95099.falepaco.com.br" />
                <InfoRow label="Porta" value="5060" />
                <InfoRow label="Protocolo" value="SIP" />
                <InfoRow label="DID" value="(31) 3058-2126" />
                <InfoRow label="Canais" value="5" />
                <InfoRow label="Plano" value="Fale Ilimitado 15" />
              </div>
            </div>
          </div>
        )}

        {activeTab === "favoritos" && (
          <div className="py-2 px-3 space-y-1">
            {favorites.map((f, i) => (
              <button key={i} className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                <div className="w-9 h-9 rounded-full bg-warning/10 flex items-center justify-center">
                  <Star size={14} className="text-warning fill-warning" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[12px] font-semibold text-foreground truncate">{f.name}</div>
                  <div className="text-[10px] text-muted-foreground">{f.number}</div>
                </div>
                <button className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center text-success hover:bg-success hover:text-primary-foreground transition-all cursor-pointer">
                  <Phone size={13} />
                </button>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground font-mono text-[10px]">{value}</span>
    </div>
  );
}

// ─── Dialer / Call View ───
function DialerView() {
  const [number, setNumber] = useState("");
  const [inCall, setInCall] = useState(false);
  const [callTime, setCallTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isHeld, setIsHeld] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [selectedRamal, setSelectedRamal] = useState("100");

  const dialPad = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["*", "0", "#"],
  ];
  const subLabels: Record<string, string> = {
    "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL",
    "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ",
    "0": "+",
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  // Simulate call timer
  useState(() => {
    if (inCall) {
      const interval = setInterval(() => setCallTime(t => t + 1), 1000);
      return () => clearInterval(interval);
    }
  });

  const startCall = () => {
    if (number.length >= 8) {
      setInCall(true);
      setCallTime(0);
    }
  };

  const endCall = () => {
    setInCall(false);
    setCallTime(0);
    setIsMuted(false);
    setIsHeld(false);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-background">
      {!inCall ? (
        /* ── Dialer ── */
        <div className="flex flex-col items-center w-full max-w-[320px]">
          {/* Ramal selector */}
          <div className="flex items-center gap-2 mb-6 bg-secondary border border-border rounded-lg px-3 py-2">
            <Headphones size={14} className="text-muted-foreground" />
            <select
              value={selectedRamal}
              onChange={e => setSelectedRamal(e.target.value)}
              className="bg-transparent text-[12px] font-medium text-foreground outline-none cursor-pointer"
            >
              {extensions.map(ext => (
                <option key={ext.ramal} value={ext.ramal}>Ramal {ext.ramal} — {ext.nome}</option>
              ))}
            </select>
          </div>

          {/* Number display */}
          <div className="w-full mb-4">
            <div className="flex items-center justify-center gap-2 bg-card border border-border rounded-xl px-4 py-4 min-h-[56px]">
              <input
                value={number}
                onChange={e => setNumber(e.target.value.replace(/[^0-9*#+]/g, ""))}
                className="bg-transparent border-none outline-none text-center text-2xl font-semibold text-foreground tracking-widest w-full placeholder:text-muted-foreground/40"
                placeholder="(31) 0000-0000"
              />
              {number && (
                <button onClick={() => setNumber(n => n.slice(0, -1))} className="text-muted-foreground hover:text-foreground cursor-pointer">
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          {/* Dial pad */}
          <div className="grid grid-cols-3 gap-2 w-full mb-6">
            {dialPad.flat().map(key => (
              <button
                key={key}
                onClick={() => setNumber(n => n + key)}
                className="h-14 rounded-xl bg-card border border-border flex flex-col items-center justify-center hover:bg-muted transition-all cursor-pointer active:scale-95"
              >
                <span className="text-lg font-semibold text-foreground">{key}</span>
                {subLabels[key] && <span className="text-[8px] tracking-widest text-muted-foreground mt-[-2px]">{subLabels[key]}</span>}
              </button>
            ))}
          </div>

          {/* Call button */}
          <button
            onClick={startCall}
            disabled={number.length < 8}
            className="w-16 h-16 rounded-full bg-success flex items-center justify-center text-primary-foreground hover:bg-success/80 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-success/30"
          >
            <Phone size={24} />
          </button>
        </div>
      ) : (
        /* ── In-call ── */
        <div className="flex flex-col items-center gap-6">
          {/* Contact info */}
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3 animate-pulse">
              <Phone size={32} className="text-success" />
            </div>
            <div className="text-xl font-bold text-foreground">{number || "(31) 3058-2126"}</div>
            <div className="text-sm text-muted-foreground mt-1">Ligando via Ramal {selectedRamal}</div>
            <div className="text-2xl font-mono font-bold text-primary mt-3">
              {formatTime(callTime)}
            </div>
            {isHeld && (
              <div className="flex items-center gap-1.5 justify-center mt-2 text-warning text-xs font-medium">
                <Pause size={12} /> Em espera
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="grid grid-cols-3 gap-4">
            <CallControl icon={isMuted ? MicOff : Mic} label={isMuted ? "Desmut." : "Mutar"} active={isMuted} danger={isMuted} onClick={() => setIsMuted(!isMuted)} />
            <CallControl icon={isHeld ? Play : Pause} label={isHeld ? "Retomar" : "Espera"} active={isHeld} onClick={() => setIsHeld(!isHeld)} />
            <CallControl icon={isSpeaker ? VolumeX : Volume2} label="Alto-falante" active={isSpeaker} onClick={() => setIsSpeaker(!isSpeaker)} />
            <CallControl icon={UserPlus} label="Transferir" onClick={() => {}} />
            <CallControl icon={Hash} label="Teclado" onClick={() => {}} />
            <CallControl icon={Voicemail} label="Gravar" onClick={() => {}} />
          </div>

          {/* End call */}
          <button
            onClick={endCall}
            className="w-16 h-16 rounded-full bg-destructive flex items-center justify-center text-destructive-foreground hover:bg-destructive/80 transition-all cursor-pointer shadow-lg shadow-destructive/30 mt-4"
          >
            <PhoneOff size={24} />
          </button>
        </div>
      )}
    </div>
  );
}

function CallControl({ icon: Icon, label, active, danger, onClick }: {
  icon: React.ElementType; label: string; active?: boolean; danger?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 cursor-pointer transition-all`}
    >
      <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
        danger ? "bg-destructive text-destructive-foreground" :
        active ? "bg-primary text-primary-foreground" :
        "bg-card border border-border text-foreground hover:bg-muted"
      }`}>
        <Icon size={18} />
      </div>
      <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
    </button>
  );
}

// ─── Stats Panel ───
function StatsPanel() {
  const stats = {
    today: { total: 24, incoming: 10, outgoing: 11, missed: 3 },
    avgDuration: "08:32",
    activeLines: 1,
    totalLines: 5,
  };

  return (
    <div className="w-[260px] min-w-[260px] bg-card border-l border-border flex flex-col overflow-y-auto scrollbar-thin">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-[13px] font-bold text-foreground">Painel de Chamadas</span>
      </div>

      {/* Today stats */}
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Hoje</div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Total" value={stats.today.total.toString()} icon={Phone} />
          <StatCard label="Recebidas" value={stats.today.incoming.toString()} icon={PhoneIncoming} color="text-success" />
          <StatCard label="Realizadas" value={stats.today.outgoing.toString()} icon={PhoneOutgoing} color="text-primary" />
          <StatCard label="Perdidas" value={stats.today.missed.toString()} icon={PhoneMissed} color="text-destructive" />
        </div>
        <div className="mt-2 flex justify-between text-[11px] bg-secondary rounded-lg px-3 py-2">
          <span className="text-muted-foreground">Duração média</span>
          <span className="font-semibold text-foreground font-mono">{stats.avgDuration}</span>
        </div>
      </div>

      {/* Lines status */}
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Linhas</div>
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-success rounded-full" style={{ width: `${(stats.activeLines / stats.totalLines) * 100}%` }} />
          </div>
          <span className="text-[11px] font-semibold text-foreground">{stats.activeLines}/{stats.totalLines}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {stats.totalLines - stats.activeLines} linhas disponíveis
        </div>
      </div>

      {/* Business hours */}
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Horário de Atendimento</div>
        <div className="space-y-1">
          <InfoRow label="Seg - Sex" value="08:30 - 17:00" />
          <InfoRow label="Almoço" value="12:00 - 13:00" />
          <InfoRow label="Sábado" value="08:00 - 12:00" />
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-success text-[10px] font-medium">
          <CircleDot size={8} className="animate-pulse" />
          Dentro do horário de atendimento
        </div>
      </div>

      {/* Quick dial */}
      <div className="px-4 py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Discagem Rápida</div>
        <div className="space-y-1.5">
          {favorites.map((f, i) => (
            <button key={i} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary">
                {f.name.split(" ")[0][0]}{f.name.split(" ").slice(-1)[0]?.[0] || ""}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="text-[11px] font-medium text-foreground truncate">{f.name}</div>
                <div className="text-[9px] text-muted-foreground">{f.number}</div>
              </div>
              <Phone size={12} className="text-success" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color?: string }) {
  return (
    <div className="bg-secondary rounded-lg p-2.5 flex items-center gap-2">
      <Icon size={14} className={color || "text-muted-foreground"} />
      <div>
        <div className="text-[14px] font-bold text-foreground">{value}</div>
        <div className="text-[9px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

// ─── Page ───
export default function PhonePage() {
  const [activeTab, setActiveTab] = useState<"recentes" | "ramais" | "favoritos">("recentes");
  const [selectedCall, setSelectedCall] = useState<string | null>(null);

  return (
    <div className="flex h-full overflow-hidden">
      <PhoneSidebar activeTab={activeTab} setActiveTab={setActiveTab} selectedCall={selectedCall} setSelectedCall={setSelectedCall} />
      <DialerView />
      <StatsPanel />
    </div>
  );
}
