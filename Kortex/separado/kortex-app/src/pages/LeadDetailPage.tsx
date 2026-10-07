import { ElementType, FormEvent, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  Building2,
  Briefcase,
  CalendarDays,
  Download,
  Eye,
  FileText,
  Mail,
  MessageSquare,
  Paperclip,
  Phone,
  Save,
  Send,
  Trash2,
  UploadCloud,
  User,
} from "lucide-react";
import { Lead, leads } from "@/data/mockData";
import { cn } from "@/lib/utils";

type LeadTab = "conversation" | "notes" | "activities" | "files";

type NoteItem = {
  id: string;
  author: string;
  content: string;
  createdAt: Date;
};

type LocalFile = {
  id: string;
  file: File;
  url: string;
};

type LeadDetailRouteState = {
  lead?: Lead;
  returnTo?: string;
  pipelineState?: unknown;
  payload?: {
    role?: string;
    source?: string;
    notes?: string[];
  };
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function TabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-12 items-center justify-center gap-2 border-b-2 px-4 text-[13px] font-black transition focus:outline-none focus:ring-4 focus:ring-primary/10",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function EmptyTab({
  icon: Icon,
  title,
  description,
}: {
  icon: ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <Icon className="h-10 w-10 text-muted-foreground" />
      <h2 className="mt-3 text-lg font-black">{title}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

export default function LeadDetailPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as LeadDetailRouteState | null;
  const stateLead = routeState?.lead;
  const lead = stateLead || leads.find((item) => item.id === leadId);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<LeadTab>("conversation");
  const [contactName, setContactName] = useState(lead?.contact || lead?.name || "Lead não localizado");
  const [role, setRole] = useState(routeState?.payload?.role || "");
  const [phone, setPhone] = useState(lead?.phone || "");
  const [email, setEmail] = useState(lead?.email || (lead?.contact?.includes("@") ? lead.contact : ""));
  const [company, setCompany] = useState(lead?.company || "");
  const [project, setProject] = useState(lead?.pipeline || "");
  const [source, setSource] = useState(routeState?.payload?.source || lead?.tags?.[0] || "");
  const [observations, setObservations] = useState("");
  const [savedState, setSavedState] = useState<"idle" | "saved">("idle");
  const [noteText, setNoteText] = useState("");
  const [notes, setNotes] = useState<NoteItem[]>(() =>
    (routeState?.payload?.notes || []).map((content) => ({
      id: crypto.randomUUID(),
      author: "Nota local",
      content,
      createdAt: new Date(),
    })),
  );
  const [files, setFiles] = useState<LocalFile[]>([]);

  const code = useMemo(() => `#${String(lead?.id ?? leadId ?? "0").padStart(8, "0").slice(0, 9)}`, [lead?.id, leadId]);

  if (!lead) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-black">Lead não encontrado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este lead não está disponível nos dados locais da sessão.
          </p>
          <button
            type="button"
            onClick={() => navigate("/pipeline/atendimento-luisa")}
            className="mt-5 h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground"
          >
            Voltar para Pipelines
          </button>
        </div>
      </div>
    );
  }

  const goBackToPipeline = () => {
    navigate(routeState?.returnTo || `/pipeline/${lead.pipeline}`, {
      state: routeState?.pipelineState ? { pipelineState: routeState.pipelineState } : undefined,
    });
  };

  const saveChanges = () => {
    setSavedState("saved");
    window.setTimeout(() => setSavedState("idle"), 2400);
  };

  const saveNote = (event: FormEvent) => {
    event.preventDefault();
    const content = noteText.trim();
    if (!content) return;
    setNotes((current) => [
      { id: crypto.randomUUID(), author: "Nota local", content, createdAt: new Date() },
      ...current,
    ]);
    setNoteText("");
  };

  const addFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const nextFiles = Array.from(fileList).map((file) => ({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
    }));
    setFiles((current) => [...nextFiles, ...current]);
  };

  return (
    <div className="flex h-full min-h-0 bg-background p-3 text-foreground">
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-auto rounded-xl border border-border bg-card shadow-sm scrollbar-thin">
          <div className="border-b border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-xl font-black tracking-tight">{contactName || lead.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">Responsável: {lead.responsible || "Não informado"}</p>
              </div>
              <button
                type="button"
                onClick={goBackToPipeline}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition hover:border-primary hover:text-primary"
                aria-label="Voltar para Pipelines"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{code}</span>
              <span>•</span>
              <span>{lead.stage}</span>
              <span>•</span>
              <span>{lead.date}</span>
            </div>
          </div>

          <div className="space-y-3 p-3">
            <h2 className="text-base font-black">Dados do lead</h2>
            <label className="block space-y-1.5 text-[13px] font-semibold">
              <span>Nome do contato *</span>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={contactName} onChange={(event) => setContactName(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-[13px] outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
              </div>
            </label>
            <label className="block space-y-1.5 text-[13px] font-semibold">
              <span>Cargo</span>
              <div className="relative">
                <Briefcase className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Não informado" className="h-9 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10" />
              </div>
            </label>
            <label className="block space-y-1.5 text-[13px] font-semibold">
              <span>Telefone</span>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Não informado" className="h-9 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10" />
              </div>
            </label>
            <label className="block space-y-1.5 text-[13px] font-semibold">
              <span>E-mail</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Não informado" className="h-9 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10" />
              </div>
            </label>
            <label className="block space-y-1.5 text-[13px] font-semibold">
              <span>Empresa</span>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Não informada" className="h-9 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10" />
              </div>
            </label>
            <label className="block space-y-1.5 text-[13px] font-semibold">
              <span>Projeto</span>
              <div className="relative">
                <FileText className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={project} onChange={(event) => setProject(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-[13px] outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
              </div>
            </label>
            <label className="block space-y-1.5 text-[13px] font-semibold">
              <span>Canal de origem</span>
              <div className="relative">
                <Paperclip className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Não informado" className="h-9 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10" />
              </div>
            </label>
            <label className="block space-y-1.5 text-[13px] font-semibold">
              <span>Observações</span>
              <textarea
                value={observations}
                onChange={(event) => setObservations(event.target.value.slice(0, 500))}
                className="min-h-[82px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
                placeholder="Adicione informações relevantes sobre o lead..."
              />
              <span className="block text-right text-xs text-muted-foreground">{observations.length}/500</span>
            </label>

            <button
              type="button"
              onClick={saveChanges}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-black text-primary-foreground transition hover:bg-primary/90"
            >
              <Save className="h-4 w-4" />
              Salvar alterações
            </button>
            {savedState === "saved" && (
              <p className="rounded-xl border border-border bg-background p-3 text-xs text-muted-foreground">
                Alterações mantidas nesta sessão. Persistência real depende de conectar este detalhe ao serviço de leads.
              </p>
            )}
          </div>
        </aside>

        <section className="min-h-0 min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex overflow-x-auto border-b border-border scrollbar-thin">
            <TabButton active={activeTab === "conversation"} icon={MessageSquare} label="Conversa" onClick={() => setActiveTab("conversation")} />
            <TabButton active={activeTab === "notes"} icon={FileText} label="Notas" onClick={() => setActiveTab("notes")} />
            <TabButton active={activeTab === "activities"} icon={CalendarDays} label="Atividades" onClick={() => setActiveTab("activities")} />
            <TabButton active={activeTab === "files"} icon={Paperclip} label="Arquivos" onClick={() => setActiveTab("files")} />
          </div>

          <div className="h-[calc(100%_-_49px)] min-h-0 overflow-auto scrollbar-thin">
            {activeTab === "conversation" && (
              <div className="flex h-full min-h-[420px] flex-col">
                <div className="flex items-center gap-3 border-b border-border p-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 font-black text-primary">
                    {initials(contactName || lead.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-black">{contactName || lead.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{company || "Empresa não informada"}</p>
                  </div>
                </div>
                <EmptyTab
                  icon={MessageSquare}
                  title="Nenhuma conversa sincronizada"
                  description="Não há fonte real de conversa conectada para este lead nesta tela. Quando a integração estiver disponível, o histórico do lead será exibido aqui."
                />
                <div className="mt-auto flex items-center gap-3 border-t border-border p-4">
                  <button disabled className="flex h-11 w-11 items-center justify-center rounded-xl border border-border text-muted-foreground opacity-60">
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <input disabled className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm opacity-60 outline-none" placeholder="Mensagem indisponível sem canal conectado" />
                  <button disabled className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-black text-primary-foreground opacity-60">
                    <Send className="h-4 w-4" />
                    Enviar
                  </button>
                </div>
              </div>
            )}

            {activeTab === "notes" && (
              <div className="p-5">
                <form onSubmit={saveNote} className="border-b border-border pb-5">
                  <h2 className="text-lg font-black">Adicionar nota</h2>
                  <textarea
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value.slice(0, 2000))}
                    className="mt-3 min-h-[120px] w-full resize-y rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
                    placeholder="Digite sua nota aqui..."
                  />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{noteText.length}/2000</span>
                    <button className="h-10 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground transition hover:bg-primary/90">
                      Salvar nota
                    </button>
                  </div>
                </form>

                <div className="mt-5">
                  <h3 className="text-lg font-black">Notas registradas</h3>
                  {notes.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
                      Nenhuma nota real registrada para este lead nesta sessão.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {notes.map((note) => (
                        <article key={note.id} className="rounded-xl border border-border bg-background p-4">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-black">{note.author}</p>
                            <time className="text-xs text-muted-foreground">{formatDate(note.createdAt)}</time>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{note.content}</p>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "activities" && (
              <EmptyTab
                icon={Activity}
                title="Nenhuma atividade registrada"
                description="A tabela de atividades existe no backend, mas esta tela ainda não está conectada a consultas por lead."
              />
            )}

            {activeTab === "files" && (
              <div className="p-5">
                <div
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    addFiles(event.dataTransfer.files);
                  }}
                  className="flex min-h-[150px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background p-5 text-center"
                >
                  <UploadCloud className="h-9 w-9 text-primary" />
                  <p className="mt-3 text-sm font-black">Arraste arquivos aqui ou selecione no computador</p>
                  <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                    Upload real depende de bucket/policies do Supabase Storage. Por enquanto os arquivos ficam locais nesta sessão.
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-4 h-10 rounded-xl border border-border px-4 text-sm font-semibold transition hover:border-primary hover:text-primary"
                  >
                    Selecionar arquivos
                  </button>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => addFiles(event.target.files)} />
                </div>

                <div className="mt-5 overflow-hidden rounded-xl border border-border">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Arquivo</th>
                        <th className="px-4 py-3">Categoria</th>
                        <th className="px-4 py-3">Tamanho</th>
                        <th className="px-4 py-3 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                            Nenhum arquivo anexado a este lead.
                          </td>
                        </tr>
                      ) : (
                        files.map((item) => (
                          <tr key={item.id} className="border-b border-border/70 last:border-0">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <FileText className="h-5 w-5 text-primary" />
                                <span className="font-semibold">{item.file.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{item.file.type || "Arquivo"}</td>
                            <td className="px-4 py-3 text-muted-foreground">{formatFileSize(item.file.size)}</td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => window.open(item.url, "_blank")} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary">
                                  <Eye className="h-4 w-4" />
                                </button>
                                <a href={item.url} download={item.file.name} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary">
                                  <Download className="h-4 w-4" />
                                </a>
                                <button type="button" onClick={() => setFiles((current) => current.filter((file) => file.id !== item.id))} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
