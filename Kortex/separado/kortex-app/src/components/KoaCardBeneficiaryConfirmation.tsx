import { useRef, useState } from "react";

export interface CardBeneficiaryChoice {
  id: string;
  beneficiaryName: string;
  options: Array<{ id: string; beneficiaryName: string; cardNumbers: string[]; cpfMasked?: string; description: string }>;
}

export function KoaCardBeneficiaryConfirmation({ confirmation, onConfirm, onCancel }: {
  confirmation: CardBeneficiaryChoice;
  onConfirm: (confirmationId: string, optionId: string) => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const submit = async () => {
    if (!selected || inFlight.current) return;
    inFlight.current = true; setSubmitting(true); setError(undefined);
    try { setError(await onConfirm(confirmation.id, selected)); }
    catch { setError("Não consegui registrar a carteirinha escolhida. Tente novamente."); }
    finally { inFlight.current = false; setSubmitting(false); }
  };
  return <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-secondary/80 px-4 py-3 text-left shadow-sm">
    <p className="text-sm font-semibold text-foreground">Encontrei mais de um registro para {confirmation.beneficiaryName}.</p>
    <p className="mt-2 text-sm text-muted-foreground">Escolha a carteirinha que deseja emitir. Confira o número e os dados apresentados pelo portal.</p>
    <fieldset className="mt-3 space-y-2" disabled={submitting}>
      <legend className="sr-only">Carteirinha do beneficiário</legend>
      {confirmation.options.map((option, index) => <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-background/70 p-3">
        <input type="radio" name={`beneficiary-${confirmation.id}`} value={option.id} checked={selected === option.id}
          onChange={() => { setSelected(option.id); setError(undefined); }} className="mt-1 shrink-0" />
        <span className="min-w-0 text-sm">
          <span className="block font-semibold">Opção {index + 1}: {option.beneficiaryName}</span>
          {option.cardNumbers.length > 0 && <span className="mt-1 block break-all">Carteirinha: {option.cardNumbers.join(", ")}</span>}
          {option.cpfMasked && <span className="block">CPF: {option.cpfMasked}</span>}
          <span className="mt-1 block break-words text-xs text-muted-foreground">{option.description}</span>
        </span>
      </label>)}
    </fieldset>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={!selected || submitting} onClick={() => void submit()} className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{submitting ? "Continuando..." : "Emitir carteirinha escolhida"}</button>
      <button type="button" disabled={submitting} onClick={onCancel} className="rounded-xl border border-border px-3 py-2 text-xs disabled:opacity-50">Cancelar</button>
    </div>
  </div>;
}
