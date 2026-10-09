import { useEffect, useId, useRef, useState } from "react";
import { Building2, Eye, EyeOff, LockKeyhole } from "lucide-react";

type Portal = "hapvida" | "ndi";
export function KoaAuthenticationCard({ defaultCompanyCode, portal, notFoundPortals = [], onCancelOperation, onReviewRequest, onSubmitAuthentication }: {
  defaultCompanyCode?: string;
  portal?: Portal;
  notFoundPortals?: Portal[];
  onCancelOperation: () => void;
  onReviewRequest?: () => void;
  onSubmitAuthentication: (input: { password: string; rememberOnDevice: boolean; companyCode?: string }) => Promise<string | undefined>;
}) {
  const id = useId();
  const [companyCode, setCompanyCode] = useState(defaultCompanyCode?.trim() ?? "");
  const [editingCode, setEditingCode] = useState(!defaultCompanyCode?.trim());
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [rememberOnDevice, setRememberOnDevice] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  useEffect(() => {
    if (!editingCode && defaultCompanyCode?.trim()) setCompanyCode(defaultCompanyCode.trim());
  }, [defaultCompanyCode, editingCode]);
  useEffect(() => { setPassword(""); setVisible(false); setError(undefined); }, [portal, defaultCompanyCode]);
  const portalLabel = portal === "ndi" ? "NDI" : "Hapvida";
  const submit = async () => {
    if (inFlight.current) return;
    if (!companyCode.trim()) { setError("Informe o código da empresa."); return; }
    if (!password) { setError("Informe a senha para continuar."); return; }
    inFlight.current = true; setSubmitting(true); setError(undefined);
    try { setError(await onSubmitAuthentication({ companyCode: companyCode.trim(), password, rememberOnDevice })); }
    catch { setError("Não consegui enviar o acesso. Tente novamente."); }
    finally { setPassword(""); setVisible(false); inFlight.current = false; setSubmitting(false); }
  };
  return <form autoComplete="off" onSubmit={event => { event.preventDefault(); void submit(); }} className="max-w-[84%] rounded-2xl rounded-bl-md bg-secondary/80 px-4 py-3 text-left shadow-sm">
    <p className="text-sm font-semibold text-foreground">Preciso autenticar o acesso {portalLabel} para continuar.</p>
    <p className="mt-1 text-sm text-muted-foreground">Informe a senha desse código na {portalLabel}. Com “Salvar acesso” ativado, o acesso validado será guardado de forma protegida para as próximas emissões.</p>
    {notFoundPortals.length > 0 && <div className="mt-3 rounded-xl border border-border p-3 text-sm">
      <p>O acesso funcionou em {notFoundPortals.map(value => value === "ndi" ? "NDI" : "Hapvida").join(" e ")}, mas o beneficiário não foi encontrado com o nome e período informados. Ainda falta validar o acesso {portalLabel} para concluir a busca.</p>
      {onReviewRequest && <button type="button" disabled={submitting} onClick={onReviewRequest} className="mt-2 text-sm font-semibold text-primary">Revisar nome e período</button>}
    </div>}
    <fieldset disabled={submitting} className="mt-4 space-y-3">
      <div className="space-y-1.5 text-sm font-medium text-foreground">
        <label htmlFor={`${id}-code`}>Código da empresa</label>
        <div className="flex min-h-11 items-center gap-3 rounded-xl border border-input bg-card px-3">
          <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
          {editingCode ? <input id={`${id}-code`} name="koa-portal-company-code" autoComplete="off" value={companyCode}
            onChange={event => { setCompanyCode(event.target.value); setError(undefined); }} placeholder="Digite o código da empresa"
            className="min-w-0 flex-1 bg-transparent text-sm font-normal outline-none" />
            : <span id={`${id}-code`} className="min-w-0 flex-1 break-all font-semibold" aria-label="Código da empresa informado">{companyCode}</span>}
          {!editingCode && <button type="button" onClick={() => setEditingCode(true)} className="text-xs font-semibold text-primary">Alterar código</button>}
        </div>
      </div>
      <label className="block space-y-1.5 text-sm font-medium text-foreground" htmlFor={`${id}-password`}>
        <span>Senha {portalLabel}</span>
        <span className="flex h-11 items-center gap-3 rounded-xl border border-input bg-card px-3">
          <LockKeyhole className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input id={`${id}-password`} name="koa-portal-password" type={visible ? "text" : "password"} autoComplete="section-koa-portal current-password"
            value={password} onChange={event => { setPassword(event.target.value); setError(undefined); }} placeholder={`Digite a senha ${portalLabel}`}
            className="min-w-0 flex-1 bg-transparent text-sm font-normal outline-none" />
          <button type="button" onClick={() => setVisible(value => !value)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"} className="h-8 w-8 shrink-0 text-muted-foreground">{visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={rememberOnDevice} onChange={event => setRememberOnDevice(event.target.checked)} className="h-4 w-4 rounded border-border" />Salvar acesso para as próximas emissões</label>
    </fieldset>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    <div className="mt-4 grid grid-cols-2 gap-2">
      <button type="button" onClick={onCancelOperation} disabled={submitting} className="h-10 rounded-xl border border-border px-3 text-xs font-semibold text-muted-foreground disabled:opacity-60">Cancelar</button>
      <button type="submit" disabled={submitting} className="h-10 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60">{submitting ? "Enviando acesso..." : "Entrar e continuar"}</button>
    </div>
  </form>;
}
