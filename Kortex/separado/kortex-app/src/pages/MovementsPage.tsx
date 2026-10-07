import { ElementType, FormEvent, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Calendar,
  CheckCircle2,
  CreditCard,
  FileCheck2,
  FileText,
  Lock,
  MoreVertical,
  Paperclip,
  Search,
  Send,
  Smile,
  Upload,
  User,
  UserMinus,
  UserPlus,
} from "lucide-react";

type FlowId = "inclusao" | "exclusao" | "carteirinha";

type FlowConfig = {
  id: FlowId;
  title: string;
  icon: ElementType;
  emptyState: string;
};

type FlowState = Record<FlowId, boolean>;

const flows: FlowConfig[] = [
  {
    id: "inclusao",
    title: "Inclusão de beneficiário",
    icon: UserPlus,
    emptyState: "Fluxo fixo para iniciar uma inclusão.",
  },
  {
    id: "exclusao",
    title: "Exclusão de beneficiário",
    icon: UserMinus,
    emptyState: "Fluxo fixo para iniciar uma exclusão.",
  },
  {
    id: "carteirinha",
    title: "Emissão de carteirinha",
    icon: CreditCard,
    emptyState: "Fluxo fixo para solicitar emissão.",
  },
];

function getActiveFlow(value?: string): FlowId {
  return value === "exclusao" || value === "carteirinha" || value === "inclusao" ? value : "inclusao";
}

function ChatBubble({
  children,
  fromUser = false,
  time,
}: {
  children: React.ReactNode;
  fromUser?: boolean;
  time?: string;
}) {
  return (
    <div className={`flex items-end gap-2.5 ${fromUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-full rounded-2xl border px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm sm:px-4 sm:py-3 md:max-w-[680px] ${
          fromUser
            ? "border-blue-300/30 bg-blue-600 text-white"
            : "border-white/12 bg-slate-900/70 text-slate-100"
        }`}
      >
        {children}
        {time && <div className={`mt-2 text-right text-xs ${fromUser ? "text-blue-100" : "text-slate-400"}`}>{time}</div>}
      </div>
      {fromUser && (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-300/35 bg-slate-900 text-sm font-bold text-blue-100">
          KA
        </div>
      )}
    </div>
  );
}

function FormCard({
  title,
  description,
  icon: Icon,
  children,
  buttonLabel,
  onSubmit,
}: {
  title: string;
  description: string;
  icon: ElementType;
  children: React.ReactNode;
  buttonLabel: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-[780px] rounded-2xl border border-blue-300/25 bg-blue-500/[0.07] p-3.5 shadow-[0_18px_60px_rgba(0,91,255,0.12)] sm:p-4"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-200">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-50">{title}</h2>
          <p className="mt-1 text-sm text-slate-300">{description}</p>
        </div>
      </div>
      {children}
      <button
        type="submit"
        className="mt-4 flex h-10 w-full items-center justify-center gap-3 rounded-xl bg-blue-600 text-sm font-black text-white shadow-[0_14px_30px_rgba(0,91,255,0.22)] transition hover:bg-blue-500"
      >
        {buttonLabel}
        <Send className="h-5 w-5" />
      </button>
    </form>
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

function InputWithIcon({
  icon: Icon,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { icon: ElementType }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-blue-200" />
      <input
        {...props}
        className="h-10 w-full rounded-xl border border-white/15 bg-slate-950/45 pl-11 pr-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-500/15"
      />
    </div>
  );
}

function UploadBox() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
      <label className="flex min-h-[92px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-slate-950/35 text-center text-sm text-slate-300 transition hover:border-blue-300 hover:text-blue-100">
        <Upload className="mb-2 h-8 w-8" />
        <span>Arraste os arquivos aqui</span>
        <span>ou clique para selecionar</span>
        <input type="file" multiple className="hidden" />
      </label>
      <div className="rounded-xl border border-white/12 bg-slate-950/35 p-3 text-sm">
        <p className="mb-2 font-bold text-slate-100">Documentos obrigatórios:</p>
        {["Documento de identidade (RG/CNH)", "CPF", "Comprovante de vínculo"].map((item) => (
          <div key={item} className="mt-2 flex items-center gap-2 text-slate-300">
            <CheckCircle2 className="h-4 w-4 text-blue-300" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function InclusionForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <FormCard
      title="Dados do beneficiário"
      description="Preencha as informações abaixo para iniciar a solicitação."
      icon={UserPlus}
      buttonLabel="Enviar solicitação"
      onSubmit={onSubmit}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Field label="Código do contrato">
          <InputWithIcon icon={FileText} name="contract" placeholder="Digite o código do contrato" />
        </Field>
        <Field label="Senha">
          <InputWithIcon icon={Lock} name="password" placeholder="Digite sua senha" type="password" />
        </Field>
        <Field label="Nome completo">
          <InputWithIcon icon={User} name="name" placeholder="Digite o nome completo" />
        </Field>
        <Field label="CPF">
          <InputWithIcon icon={FileCheck2} name="cpf" placeholder="000.000.000-00" />
        </Field>
        <Field label="Data de nascimento">
          <InputWithIcon icon={Calendar} name="birthDate" placeholder="DD/MM/AAAA" />
        </Field>
        <Field label="Grau de parentesco">
          <select
            name="kinship"
            className="h-10 w-full rounded-xl border border-white/15 bg-slate-950/45 px-4 text-sm text-slate-100 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-500/15"
            defaultValue=""
          >
            <option value="" disabled>Selecione</option>
            <option>Filha (dependente)</option>
            <option>Cônjuge</option>
            <option>Titular</option>
            <option>Filho (dependente)</option>
          </select>
        </Field>
      </div>
      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="mb-3 flex items-center gap-3 text-slate-100">
          <Paperclip className="h-5 w-5 text-blue-200" />
          <span className="font-bold">Upload de documentos</span>
        </div>
        <UploadBox />
      </div>
    </FormCard>
  );
}

function ExclusionForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <FormCard
      title="Dados para exclusão"
      description="Preencha as informações abaixo para iniciarmos a solicitação."
      icon={UserMinus}
      buttonLabel="Enviar solicitação"
      onSubmit={onSubmit}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Field label="Código do contrato">
          <InputWithIcon icon={FileText} name="contract" placeholder="Digite o código do contrato" />
        </Field>
        <Field label="Senha">
          <InputWithIcon icon={Lock} name="password" placeholder="Digite sua senha" type="password" />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Beneficiário a ser excluído">
          <InputWithIcon icon={Search} name="name" placeholder="Digite o nome completo do beneficiário" />
        </Field>
      </div>
    </FormCard>
  );
}

function CardIssueForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <FormCard
      title="Dados para emissão da carteirinha"
      description="Preencha as informações para localizar a movimentação e emitir a carteirinha."
      icon={CreditCard}
      buttonLabel="Emitir carteirinha"
      onSubmit={onSubmit}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Field label="Código do contrato">
          <InputWithIcon icon={FileText} name="contract" placeholder="Digite o código do contrato" />
        </Field>
        <Field label="Senha">
          <InputWithIcon icon={Lock} name="password" placeholder="Digite sua senha" type="password" />
        </Field>
        <Field label="Data inicial">
          <InputWithIcon icon={Calendar} name="startDate" placeholder="DD/MM/AAAA" />
        </Field>
        <Field label="Data final">
          <InputWithIcon icon={Calendar} name="endDate" placeholder="DD/MM/AAAA" />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Nome completo do beneficiário">
          <InputWithIcon icon={User} name="name" placeholder="Digite o nome completo do beneficiário" />
        </Field>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Informe o período da movimentação em que o beneficiário foi incluído.
      </p>
    </FormCard>
  );
}

function FlowIntro({ flow }: { flow: FlowId }) {
  const copy: Record<FlowId, string> = {
    inclusao: "Preencha os dados necessários para iniciar uma inclusão de beneficiário.",
    exclusao: "Preencha os dados necessários para iniciar uma exclusão de beneficiário.",
    carteirinha: "Preencha os dados necessários para localizar a movimentação e solicitar a carteirinha.",
  };

  return (
    <ChatBubble>
      <p>{copy[flow]}</p>
      <p className="mt-2 text-slate-400">
        O formulário permanece dentro desta conversa. Nenhum envio ou comprovante é simulado sem integração real.
      </p>
    </ChatBubble>
  );
}

function IntegrationNotice() {
  return (
    <ChatBubble>
      <p className="font-bold">Envio não realizado.</p>
      <p className="mt-2">
        A integração de movimentações ainda não está conectada nesta tela. Os campos continuam disponíveis para preenchimento, mas não há confirmação, comprovante ou execução real para exibir.
      </p>
    </ChatBubble>
  );
}

export default function MovementsPage() {
  const navigate = useNavigate();
  const params = useParams();
  const activeFlow = getActiveFlow(params.flowId);
  const [submitted, setSubmitted] = useState<FlowState>({
    inclusao: false,
    exclusao: false,
    carteirinha: false,
  });
  const flow = useMemo(() => flows.find((item) => item.id === activeFlow) || flows[0], [activeFlow]);
  const FlowIcon = flow.icon;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted((current) => ({ ...current, [activeFlow]: true }));
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[#020c16] p-2 text-slate-100 lg:p-3">
      <aside className="mr-3 hidden w-[252px] shrink-0 flex-col rounded-2xl border border-blue-300/18 bg-slate-950/52 lg:flex">
        <div className="p-3">
          <div className="space-y-2">
            {flows.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeFlow;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(`/movimentacoes/${item.id}`)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                    active ? "border-blue-300 bg-blue-500/12" : "border-transparent hover:border-white/10 hover:bg-white/5"
                  }`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/18 text-blue-200">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{item.title}</p>
                    <p className="mt-1 truncate text-sm text-slate-400">{item.emptyState}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-blue-300/22 bg-[radial-gradient(circle_at_80%_0%,rgba(0,91,255,0.18),transparent_32%),rgba(2,12,22,0.92)]">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-500/18 text-blue-200">
              <FlowIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight">{flow.title}</h1>
              <p className="text-sm text-slate-400">Formulário inline de movimentação</p>
            </div>
          </div>
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/8">
            <MoreVertical className="h-6 w-6" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 scrollbar-thin sm:px-5">
          <div className="flex flex-col gap-4">
            <div className="grid gap-2 lg:hidden">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Fluxos fixos</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {flows.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === activeFlow;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate(`/movimentacoes/${item.id}`)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-bold transition ${
                        active ? "border-blue-300 bg-blue-500/12 text-slate-50" : "border-white/10 text-slate-300 hover:border-blue-300/50"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <FlowIntro flow={activeFlow} />
            {activeFlow === "inclusao" && <InclusionForm onSubmit={handleSubmit} />}
            {activeFlow === "exclusao" && <ExclusionForm onSubmit={handleSubmit} />}
            {activeFlow === "carteirinha" && <CardIssueForm onSubmit={handleSubmit} />}
            {submitted[activeFlow] && <IntegrationNotice />}
          </div>
        </div>

        <footer className="border-t border-white/10 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button type="button" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 text-slate-300 transition hover:border-blue-300 hover:text-blue-200" aria-label="Anexar arquivo">
              <Paperclip className="h-5 w-5" />
            </button>
            <button type="button" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 text-slate-300 transition hover:border-blue-300 hover:text-blue-200" aria-label="Inserir emoji">
              <Smile className="h-5 w-5" />
            </button>
            <input
              className="h-12 min-w-0 flex-1 rounded-xl border border-white/15 bg-slate-950/45 px-4 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-300 focus:ring-4 focus:ring-blue-500/15"
              placeholder="Digite sua mensagem..."
            />
            <button type="button" className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(0,91,255,0.26)] transition hover:bg-blue-500">
              <Send className="h-5 w-5" />
              <span className="hidden sm:inline">Enviar</span>
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
