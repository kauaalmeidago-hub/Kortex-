import { ElementType, FormEvent, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Building2,
  Check,
  FileText,
  Flag,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  Save,
  Trash2,
  UploadCloud,
  User,
  X,
} from "lucide-react";

export type NewLeadPayload = {
  title: string;
  contact: string;
  company?: string;
  phone?: string;
  email?: string;
  role?: string;
  cnpj?: string;
  city?: string;
  state?: string;
  source?: string;
  notes?: string[];
  files: File[];
};

type LeadWorkspaceModalProps = {
  initialStage: string;
  pipelineName: string;
  onClose: () => void;
  onCreate: (lead: NewLeadPayload) => void;
};

type AttachedFile = {
  id: string;
  file: File;
};

const brazilianStates = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
];

const sourceOptions = ["WhatsApp", "Indicação", "Site", "LinkedIn", "Evento", "Outro"];

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-1.5 text-sm font-semibold text-foreground">
      <span>
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      {children}
      {error && <span className="text-xs font-medium text-destructive">{error}</span>}
    </label>
  );
}

function IconInput({
  icon: Icon,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { icon: ElementType }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        {...props}
        className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
      />
    </div>
  );
}

function SelectBox(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
    />
  );
}

export default function LeadWorkspaceModal({
  initialStage,
  pipelineName,
  onClose,
  onCreate,
}: LeadWorkspaceModalProps) {
  const [activeTab, setActiveTab] = useState<"contact" | "files">("contact");
  const [contact, setContact] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [source, setSource] = useState("");
  const [observations, setObservations] = useState("");
  const [quickNote, setQuickNote] = useState("");
  const [quickNotes, setQuickNotes] = useState<string[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "draft" | "creating">("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const dirty = useMemo(
    () =>
      Boolean(
        contact ||
          role ||
          company ||
          cnpj ||
          phone ||
          email ||
          city ||
          state ||
          source ||
          observations ||
          quickNote ||
          quickNotes.length ||
          files.length,
      ),
    [city, cnpj, company, contact, email, files.length, observations, phone, quickNote, quickNotes.length, role, source, state],
  );

  const addFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const selected = Array.from(fileList).map((file) => ({ id: crypto.randomUUID(), file }));
    setFiles((current) => [...selected, ...current]);
  };

  const closeSafely = () => {
    if (!dirty || window.confirm("Existem alterações não salvas. Deseja fechar mesmo assim?")) {
      onClose();
    }
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!contact.trim()) nextErrors.contact = "Informe o nome do contato.";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = "Informe um e-mail válido.";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const buildPayload = (): NewLeadPayload => ({
    title: company.trim() || contact.trim(),
    contact: contact.trim(),
    company: company.trim() || undefined,
    phone: phone.trim() || undefined,
    email: email.trim() || undefined,
    role: role.trim() || undefined,
    cnpj: cnpj.trim() || undefined,
    city: city.trim() || undefined,
    state: state || undefined,
    source: source || undefined,
    notes: [observations, ...quickNotes].map((note) => note.trim()).filter(Boolean),
    files: files.map((item) => item.file),
  });

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) {
      setActiveTab("contact");
      return;
    }
    setStatus("creating");
    onCreate(buildPayload());
  };

  const saveDraft = () => {
    setStatus("draft");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 px-4 py-5 backdrop-blur-sm">
      <form
        onSubmit={handleCreate}
        className="grid max-h-[92vh] w-full max-w-6xl grid-cols-[260px_minmax(0,1fr)_280px] overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl max-xl:grid-cols-[230px_minmax(0,1fr)] max-lg:grid-cols-1"
      >
        <aside className="border-r border-border bg-muted/25 p-5 max-lg:hidden">
          <div>
            <h2 className="text-xl font-bold">Novo lead</h2>
            <p className="mt-1 text-sm text-muted-foreground">Cadastre o contato e avance a oportunidade.</p>
          </div>

          <div className="mt-7 flex flex-col items-center border-b border-border pb-6">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
              <User className="h-10 w-10 text-primary" />
            </div>
            <p className="mt-3 text-sm font-semibold">{contact || "Contato sem nome"}</p>
            <p className="text-xs text-muted-foreground">{company || "Empresa não definida"}</p>
          </div>

          <div className="mt-6 space-y-4 text-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Flag className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">Etapa no pipeline</p>
                <p className="font-semibold">{initialStage}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Briefcase className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">Pipeline</p>
                <p className="font-semibold">{pipelineName}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">Empresa</p>
                <p className="font-semibold">{company || "Não definida"}</p>
              </div>
            </div>
          </div>

          <div className="mt-7 space-y-3">
            <button
              type="submit"
              disabled={status === "creating"}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              Criar lead
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold transition hover:border-primary hover:text-primary"
            >
              <Save className="h-4 w-4" />
              Salvar rascunho
            </button>
            {status === "draft" && (
              <p className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
                Rascunho mantido nesta sessão. Ainda não há persistência de rascunhos configurada.
              </p>
            )}
          </div>
        </aside>

        <main className="min-w-0 overflow-auto p-5 scrollbar-thin">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Informações do lead</h2>
              <p className="mt-1 text-sm text-muted-foreground">Preencha os dados abaixo para cadastrar um novo lead.</p>
            </div>
            <button
              type="button"
              onClick={closeSafely}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:border-primary hover:text-primary"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 rounded-lg border border-border bg-background p-1">
            <button
              type="button"
              onClick={() => setActiveTab("contact")}
              className={`flex h-10 items-center justify-center gap-2 rounded-md text-sm font-semibold transition ${
                activeTab === "contact" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <User className="h-4 w-4" />
              Contato
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("files")}
              className={`flex h-10 items-center justify-center gap-2 rounded-md text-sm font-semibold transition ${
                activeTab === "files" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileText className="h-4 w-4" />
              Arquivos
            </button>
          </div>

          {activeTab === "contact" ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Nome do contato" required error={errors.contact}>
                <IconInput icon={User} value={contact} onChange={(event) => setContact(event.target.value)} placeholder="Ex.: João Silva" />
              </Field>
              <Field label="Cargo">
                <IconInput icon={Briefcase} value={role} onChange={(event) => setRole(event.target.value)} placeholder="Ex.: Gerente, Diretor, Sócio" />
              </Field>
              <Field label="Empresa">
                <IconInput icon={Building2} value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Ex.: Empresa Ltda." />
              </Field>
              <Field label="CNPJ">
                <IconInput icon={FileText} value={cnpj} onChange={(event) => setCnpj(event.target.value)} placeholder="00.000.000/0000-00" />
              </Field>
              <Field label="Telefone">
                <IconInput icon={Phone} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(31) 98765-4321" />
              </Field>
              <Field label="E-mail" error={errors.email}>
                <IconInput icon={Mail} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="joao@empresa.com" type="email" />
              </Field>
              <Field label="Cidade">
                <IconInput icon={MapPin} value={city} onChange={(event) => setCity(event.target.value)} placeholder="Belo Horizonte" />
              </Field>
              <Field label="Estado">
                <SelectBox value={state} onChange={(event) => setState(event.target.value)}>
                  <option value="">Selecione</option>
                  {brazilianStates.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </SelectBox>
              </Field>
              <Field label="Canal de origem">
                <SelectBox value={source} onChange={(event) => setSource(event.target.value)} className="md:col-span-2">
                  <option value="">Selecione um canal</option>
                  {sourceOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </SelectBox>
              </Field>
              <label className="space-y-1.5 text-sm font-semibold text-foreground md:col-span-2">
                <span>Observações de contato</span>
                <textarea
                  value={observations}
                  onChange={(event) => setObservations(event.target.value.slice(0, 1000))}
                  className="min-h-[108px] w-full resize-none rounded-lg border border-border bg-background px-3 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
                  placeholder="Adicione informações relevantes sobre o contato..."
                />
                <span className="block text-right text-xs text-muted-foreground">{observations.length}/1000</span>
              </label>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addFiles(event.dataTransfer.files);
                }}
                className="flex min-h-[170px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background p-6 text-center"
              >
                <UploadCloud className="h-10 w-10 text-primary" />
                <p className="mt-3 text-sm font-semibold">Arraste arquivos aqui ou selecione para anexar</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Os arquivos ficam anexados apenas nesta sessão porque não há storage configurado no projeto.
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold transition hover:border-primary hover:text-primary"
                >
                  <Paperclip className="h-4 w-4" />
                  Anexar arquivo
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => addFiles(event.target.files)} />
              </div>

              <div>
                <h3 className="text-sm font-bold">Arquivos anexados ({files.length})</h3>
                <div className="mt-3 space-y-2">
                  {files.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
                      Nenhum arquivo selecionado.
                    </div>
                  )}
                  {files.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
                      <FileText className="h-5 w-5 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatSize(item.file.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFiles((current) => current.filter((file) => file.id !== item.id))}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remover ${item.file.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>

        <aside className="border-l border-border bg-muted/20 p-5 max-xl:col-span-2 max-xl:border-l-0 max-xl:border-t max-lg:col-span-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">Notas rápidas</h3>
              <p className="mt-1 text-sm text-muted-foreground">Anotações ficam associadas ao lead criado nesta sessão.</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </span>
          </div>

          <textarea
            value={quickNote}
            onChange={(event) => setQuickNote(event.target.value.slice(0, 2000))}
            className="mt-4 min-h-[210px] w-full resize-none rounded-lg border border-border bg-background px-3 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
            placeholder="Digite sua nota aqui..."
          />
          <div className="mt-1 text-right text-xs text-muted-foreground">{quickNote.length}/2000</div>
          <button
            type="button"
            onClick={() => {
              if (!quickNote.trim()) return;
              setQuickNotes((current) => [quickNote.trim(), ...current]);
              setQuickNote("");
            }}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-primary bg-primary/10 text-sm font-bold text-primary transition hover:bg-primary hover:text-primary-foreground"
          >
            <Save className="h-4 w-4" />
            Salvar nota local
          </button>

          <div className="mt-5 border-t border-border pt-5">
            <h4 className="text-sm font-bold">Anotações recentes</h4>
            <div className="mt-3 space-y-2">
              {quickNotes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-background p-4 text-center text-sm text-muted-foreground">
                  <AlertCircle className="mx-auto mb-2 h-5 w-5" />
                  Nenhuma anotação ainda.
                </div>
              ) : (
                quickNotes.map((note, index) => (
                  <div key={`${note}-${index}`} className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-primary">
                      <Check className="h-3.5 w-3.5" />
                      Nota local
                    </div>
                    <p className="text-muted-foreground">{note}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
