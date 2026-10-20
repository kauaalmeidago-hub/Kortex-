import {
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { X } from "lucide-react";
import KoaChatComposer from "./KoaChatComposer";

const shortcuts = ["Boleto", "NF", "Kit de faturamento"] as const;
type BillingShortcut = (typeof shortcuts)[number];
const unavailableByShortcut: Record<BillingShortcut, string> = {
  Boleto:
    "A busca de boletos, incluindo coparticipação quando aplicável, ainda não está conectada.",
  NF: "A busca de notas fiscais do faturamento ainda não está conectada.",
  "Kit de faturamento":
    "A busca do conjunto de boletos, notas fiscais e relatórios aplicáveis ainda não está conectada.",
};

export default function BillingKoaPanel({
  phase,
  onClose,
  focusRef,
  companies,
  companyState,
  companyFeedback,
}: {
  phase: "closed" | "open" | "closing";
  onClose: () => void;
  focusRef: RefObject<HTMLInputElement>;
  companies: Array<{ id: string; name: string }>;
  companyState: string;
  companyFeedback: ReactNode;
}) {
  const [shortcut, setShortcut] = useState<BillingShortcut>();
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [operator, setOperator] = useState("");
  const [competence, setCompetence] = useState("");
  const [message, setMessage] = useState("");
  const [messageFeedback, setMessageFeedback] = useState("");
  const companySearchRef = useRef<HTMLInputElement>(null);
  const companyMatches = companies.filter((company) =>
    company.name
      .toLocaleLowerCase("pt-BR")
      .includes(companyQuery.trim().toLocaleLowerCase("pt-BR")),
  );
  const selectedCompanyId = companies.some(
    (company) => company.id === companyId,
  )
    ? companyId
    : "";

  useEffect(() => {
    if (shortcut) {
      if (companySearchRef.current?.disabled) focusRef.current?.focus();
      else companySearchRef.current?.focus();
    }
    // Returning to a preserved selection should focus the composer, not reset it.
  }, [shortcut, focusRef]);

  return (
    <aside
      id="billing-koa-panel"
      aria-label="KOA do Kit Faturamento"
      aria-hidden={phase !== "open" ? true : undefined}
      hidden={phase === "closed"}
      {...(phase === "closing" ? { inert: "" } : {})}
      data-state={phase}
      className={`billing-kit-koa-panel ${phase === "closing" ? "koa-panel-exit" : "koa-panel-enter"}`}
    >
      <header className="billing-kit-koa-header">
        <span className="sr-only">KOA — Kit Faturamento</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar KOA do faturamento"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-primary transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </header>
      <div className="billing-kit-koa-body scrollbar-thin">
        {!shortcut ? (
          <div className="billing-kit-koa-home">
            <div className="billing-kit-koa-welcome">
              <BillingKoaBrand active={phase === "open"} />
              <h2 className="billing-kit-koa-title font-semibold leading-tight">
                O que deseja emitir?
              </h2>
            </div>
            <div className="billing-kit-koa-shortcuts">
              {shortcuts.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setShortcut(option);
                    setMessageFeedback("");
                  }}
                  className="flex min-h-10 max-w-full items-center gap-3 rounded-xl border border-input bg-secondary/50 px-3 py-2 text-left text-sm transition hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <img
                    src="/brand/billing-empty-folder-transparent.png"
                    alt=""
                    aria-hidden="true"
                    className="h-7 w-7 shrink-0 object-contain"
                  />
                  <span>{option}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p
              aria-label="Tipo de faturamento escolhido"
              className="w-fit rounded-lg bg-accent px-3 py-2 text-sm text-primary"
            >
              {shortcut}
            </p>
            <fieldset className="min-w-0 space-y-3">
              <legend className="mb-2 text-sm font-medium">Empresa</legend>
              <input
                ref={companySearchRef}
                type="search"
                value={companyQuery}
                onChange={(event) => setCompanyQuery(event.target.value)}
                disabled={companyState !== "ready"}
                aria-label="Buscar empresa no KOA"
                placeholder="Buscar empresa..."
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
              />
              {companyState === "session" ? (
                <p className="text-[13px] text-muted-foreground">
                  Entre em um workspace para carregar suas empresas.
                </p>
              ) : (
                companyFeedback
              )}
              {companyState === "ready" && (
                <div className="overflow-hidden rounded-lg border border-border">
                  {companyMatches.map((company) => (
                    <label
                      key={company.id}
                      className={`flex cursor-pointer items-center gap-3 border-b border-border px-3 py-3 text-sm last:border-0 hover:bg-secondary ${selectedCompanyId === company.id ? "bg-accent" : ""}`}
                    >
                      <input
                        type="radio"
                        name="billing-koa-company"
                        value={company.id}
                        checked={selectedCompanyId === company.id}
                        onChange={() => setCompanyId(company.id)}
                        className="h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 break-words">
                        {company.name}
                      </span>
                    </label>
                  ))}
                  {!companyMatches.length && (
                    <p className="px-3 py-4 text-[13px] text-muted-foreground">
                      Nenhuma empresa encontrada.
                    </p>
                  )}
                </div>
              )}
            </fieldset>
            <label className="block space-y-2">
              <span className="text-sm font-medium">Operadora</span>
              <select
                value={operator}
                onChange={(event) => setOperator(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") event.stopPropagation();
                }}
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              >
                <option value="">Selecione a operadora</option>
                <option value="Hapvida">Hapvida</option>
                <option value="NDI">NDI</option>
              </select>
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium">Competência</span>
              <input
                value={competence}
                onChange={(event) => setCompetence(event.target.value)}
                placeholder="MM/AAAA"
                inputMode="numeric"
                maxLength={7}
                pattern="(0[1-9]|1[0-2])/[0-9]{4}"
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </label>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {unavailableByShortcut[shortcut]} Nenhuma solicitação será
              enviada.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setShortcut(undefined);
                  focusRef.current?.focus();
                }}
                className="h-10 rounded-lg border border-input px-4 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled
                title="Integração de faturamento ainda indisponível"
                className="h-10 min-w-0 flex-1 rounded-lg bg-primary px-3 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Iniciar busca
              </button>
            </div>
          </div>
        )}
        {messageFeedback && (
          <p
            role="status"
            className="mt-4 rounded-lg bg-secondary px-3 py-3 text-[13px] leading-relaxed text-muted-foreground"
          >
            {messageFeedback}
          </p>
        )}
      </div>
      <div className="billing-kit-koa-composer">
        <KoaChatComposer
          value={message}
          onChange={setMessage}
          onSubmit={() => {
            if (message.trim())
              setMessageFeedback(
                "O envio de mensagens de faturamento ainda não está conectado. O texto foi mantido no campo.",
              );
          }}
          disabled={!message.trim()}
          inputRef={focusRef}
          inputLabel="Mensagem para o KOA do faturamento"
          attachmentDisabled
          attachmentTitle="Anexos ainda não disponíveis no faturamento"
        />
      </div>
    </aside>
  );
}

const BillingKoaBrand = memo(function BillingKoaBrand({
  active,
}: {
  active: boolean;
}) {
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const sync = () => setReducedMotion(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) void video.play()?.catch(() => setFailed(true));
    else video.pause();
  }, [active, reducedMotion]);

  return (
    <span
      role="img"
      aria-label="KOA com pasta de faturamento"
      className="billing-kit-koa-brand"
    >
      {reducedMotion || failed ? (
        <img
          src="/brand/koa-billing-folder-poster.png"
          alt=""
          aria-hidden="true"
        />
      ) : (
        <video
          ref={videoRef}
          src="/brand/koa-billing-folder.mp4"
          poster="/brand/koa-billing-folder-poster.png"
          muted
          loop
          playsInline
          autoPlay
          aria-hidden="true"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
});
