import { ElementType, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  Link2,
  MessageCircle,
  Phone,
  QrCode,
  RefreshCw,
  Smartphone,
  Unlink,
} from "lucide-react";
import SettingsLayout from "@/components/SettingsLayout";

type PairingState = "idle" | "unavailable";

function WhatsAppIcon() {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-white shadow-[0_10px_22px_rgba(37,211,102,0.18)]">
      <MessageCircle className="h-6 w-6" />
    </div>
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
    <label className="space-y-2 text-sm font-semibold text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextInput({
  icon: Icon,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { icon: ElementType }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        {...props}
        className="h-10 w-full rounded-xl border border-input bg-card pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
      />
    </div>
  );
}

function StatusBadge({ state }: { state: PairingState }) {
  const unavailable = state === "unavailable";

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
        unavailable
          ? "border border-warning/30 bg-warning/10 text-warning"
          : "border border-border bg-muted text-muted-foreground"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${unavailable ? "bg-warning" : "bg-muted-foreground"}`} />
      {unavailable ? "Integração indisponível" : "Não conectado"}
    </div>
  );
}

function QRPreview({ state }: { state: PairingState }) {
  return (
    <div className="flex min-h-[248px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/35 p-5 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-card text-muted-foreground shadow-sm">
        {state === "unavailable" ? <AlertCircle className="h-9 w-9" /> : <QrCode className="h-9 w-9" />}
      </div>
      <p className="mt-4 max-w-[280px] text-sm font-semibold text-foreground">
        {state === "unavailable" ? "QR Code não disponível" : "Aguardando geração do QR Code"}
      </p>
      <p className="mt-2 max-w-[300px] text-xs leading-5 text-muted-foreground">
        {state === "unavailable"
          ? "A integração de pareamento ainda não está conectada nesta tela. Nenhum QR Code de exemplo será exibido."
          : "Quando a integração real estiver disponível, o QR Code de pareamento aparecerá neste painel."}
      </p>
    </div>
  );
}

function InstructionStep({
  number,
  title,
  description,
  icon: Icon,
}: {
  number: string;
  title: string;
  description: string;
  icon: ElementType;
}) {
  return (
    <article className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-black text-primary">
        {number}
      </div>
      <Icon className="mt-1 h-4 w-4 shrink-0 text-foreground" />
      <div>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </article>
  );
}

export default function WhatsAppConnectionPage() {
  const [connectionName, setConnectionName] = useState("");
  const [expectedNumber, setExpectedNumber] = useState("");
  const [pairingState, setPairingState] = useState<PairingState>("idle");
  const [lastAction, setLastAction] = useState("");

  const statusMessage = useMemo(() => {
    if (pairingState === "unavailable") {
      return "A integração real de pareamento não está disponível neste ambiente.";
    }
    return "Nenhuma conexão de WhatsApp ativa no momento.";
  }, [pairingState]);

  const handleGenerateQr = () => {
    setPairingState("unavailable");
    setLastAction("Não foi possível gerar um QR Code real porque o serviço de pareamento não está conectado.");
  };

  const handleRefreshStatus = () => {
    setPairingState("unavailable");
    setLastAction("Status consultado localmente: não há integração ativa para confirmar conexão.");
  };

  const handleDisconnect = () => {
    setPairingState("idle");
    setLastAction("Nenhuma conexão ativa para desconectar.");
  };

  return (
    <SettingsLayout>
      <div className="h-full overflow-auto bg-background px-4 py-4 text-foreground scrollbar-thin sm:px-5 sm:py-5">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <RefreshCw className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight text-foreground">Conexão do WhatsApp</h1>
            <p className="mt-1 text-sm text-muted-foreground">{statusMessage}</p>
          </div>
        </header>

        <section className="mb-4 flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <WhatsAppIcon />
            <div className="min-w-0">
              <h2 className="text-lg font-black tracking-tight text-card-foreground">WhatsApp</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                Conecte um número à Kortex para atender conversas em um só lugar.
              </p>
            </div>
          </div>
          <StatusBadge state={pairingState} />
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Link2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black tracking-tight text-card-foreground">Parear WhatsApp</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Preencha os dados da conexão e use os controles abaixo quando o serviço real de pareamento estiver disponível.
                </p>
              </div>
            </div>

            <div className="grid gap-4">
              <Field label="Nome da conexão">
                <TextInput
                  icon={Building2}
                  value={connectionName}
                  onChange={(event) => setConnectionName(event.target.value)}
                  placeholder="Ex.: Atendimento comercial"
                />
              </Field>

              <Field label="Número esperado (opcional)">
                <TextInput
                  icon={Phone}
                  value={expectedNumber}
                  onChange={(event) => setExpectedNumber(event.target.value)}
                  placeholder="+55 00 00000-0000"
                />
              </Field>

              {lastAction && (
                <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold leading-5 text-warning">
                  {lastAction}
                </div>
              )}

              <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <button
                  type="button"
                  onClick={handleGenerateQr}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_24px_rgba(13,110,253,0.18)] transition hover:bg-primary/90"
                >
                  <QrCode className="h-4 w-4" />
                  Gerar QR Code
                </button>
                <button
                  type="button"
                  onClick={handleRefreshStatus}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-bold text-foreground transition hover:border-primary hover:text-primary"
                >
                  <RefreshCw className="h-4 w-4" />
                  Atualizar status
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold text-destructive transition hover:bg-destructive/10"
                >
                  <Unlink className="h-4 w-4" />
                  Desconectar
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 text-center shadow-sm">
            <h2 className="text-lg font-black tracking-tight text-card-foreground">Escaneie o QR Code</h2>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              Use este painel apenas quando o QR Code real for retornado pela integração.
            </p>
            <div className="mt-4">
              <QRPreview state={pairingState} />
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Smartphone className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-black text-card-foreground">Como conectar seu WhatsApp</h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <InstructionStep
              number="1"
              title="Abra o WhatsApp"
              description="No celular, abra o aplicativo WhatsApp."
              icon={Smartphone}
            />
            <InstructionStep
              number="2"
              title="Acesse dispositivos conectados"
              description="Entre em dispositivos conectados no menu de configurações."
              icon={Link2}
            />
            <InstructionStep
              number="3"
              title="Escaneie o QR Code real"
              description="Aponte a câmera para o QR Code retornado pela integração."
              icon={QrCode}
            />
          </div>
        </section>
      </div>
      </div>
    </SettingsLayout>
  );
}
