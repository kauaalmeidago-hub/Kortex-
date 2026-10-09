import { useRef, useState } from "react";

export interface CardDependentChoice {
  id: string;
  beneficiaryName: string;
  dependentNames: string[];
}

export function KoaCardDependentConfirmation({ confirmation, onConfirm, onCancel }: {
  confirmation: CardDependentChoice;
  onConfirm: (confirmationId: string, includeDependents: boolean) => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const choose = async (includeDependents: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true); setError(undefined);
    try { setError(await onConfirm(confirmation.id, includeDependents)); }
    catch { setError("Não consegui registrar sua escolha. Tente novamente."); }
    finally { inFlight.current = false; setSubmitting(false); }
  };
  return <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-secondary/80 px-4 py-3 text-left shadow-sm">
    <p className="text-sm font-semibold text-foreground">Encontrei dependentes de {confirmation.beneficiaryName}.</p>
    <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground">
      {confirmation.dependentNames.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}
    </ul>
    <p className="mt-3 text-sm text-muted-foreground">Você autoriza emitir as carteirinhas dos dependentes junto com a do beneficiário? A impressão está aguardando sua escolha.</p>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={submitting} onClick={() => void choose(true)} className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">Com dependentes</button>
      <button type="button" disabled={submitting} onClick={() => void choose(false)} className="rounded-xl border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">Sem dependentes</button>
      <button type="button" disabled={submitting} onClick={onCancel} className="rounded-xl border border-border px-3 py-2 text-xs disabled:opacity-50">Cancelar</button>
    </div>
  </div>;
}
