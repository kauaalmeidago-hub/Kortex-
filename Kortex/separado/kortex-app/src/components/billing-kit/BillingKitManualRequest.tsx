import { type FormEvent, useState } from "react";
import { Calendar, FileText, Package, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { BillingDialog, BillingSelect } from "./BillingKitPrimitives";
import { type BillingOperator } from "./billingKitData";

const requestTypes = ["Boleto mensal", "Relatório copart", "NFS", "Kit faturamento completo"];

export function BillingKitManualRequest({ open, onOpenChange, companies, initialCompanyId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: { id: string; company: string; operator: BillingOperator; competence: string }[];
  initialCompanyId?: string;
}) {
  const initialCompany = companies.find((item) => item.id === initialCompanyId) ?? companies[0];
  const [companyId, setCompanyId] = useState(initialCompany?.id ?? "");
  const [operator, setOperator] = useState<BillingOperator>(initialCompany?.operator ?? "Hapvida");
  const [competence, setCompetence] = useState(initialCompany?.competence ?? "");
  const [requestType, setRequestType] = useState(requestTypes[0]);
  const [priority, setPriority] = useState(false);
  const [notice, setNotice] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Preserva a resposta honesta do fluxo existente, que ainda não envia pedidos.
    setNotice("O envio de pedidos manuais ainda não está disponível nesta versão.");
  };

  return (
    <BillingDialog open={open} onOpenChange={onOpenChange} title="Novo pedido manual">
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4 scrollbar-thin">
          <div className="space-y-1.5">
            <label htmlFor="billing-company" className="text-sm font-medium">Empresa</label>
            <BillingSelect id="billing-company" required value={companyId} onChange={(event) => {
              const company = companies.find((item) => item.id === event.target.value);
              setCompanyId(event.target.value);
              if (company) { setOperator(company.operator); setCompetence(company.competence); }
              setNotice("");
            }}>
              {companies.map((item) => <option key={item.id} value={item.id}>{item.company}</option>)}
            </BillingSelect>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="billing-operator" className="text-sm font-medium">Operadora</label>
            <BillingSelect id="billing-operator" value={operator} onChange={(event) => setOperator(event.target.value as BillingOperator)}>
              <option>Hapvida</option><option>NDI</option>
            </BillingSelect>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="billing-competence" className="text-sm font-medium">Competência</label>
            <div className="relative">
              <Calendar aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="billing-competence" required inputMode="numeric" pattern="(0[1-9]|1[0-2])/[0-9]{4}" title="Use o formato MM/AAAA" placeholder="MM/AAAA" maxLength={7} value={competence} onChange={(event) => setCompetence(event.target.value)} className="bg-card pl-10 text-sm" />
            </div>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Tipo de pedido</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {requestTypes.map((type) => {
                const Icon = type === "Kit faturamento completo" ? Package : FileText;
                return (
                  <button key={type} type="button" aria-pressed={requestType === type} onClick={() => { setRequestType(type); setNotice(""); }} className={`flex min-h-20 min-w-0 flex-col items-start gap-2 rounded-lg border p-3 text-left text-xs font-medium leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${requestType === type ? "border-primary bg-accent text-accent-foreground" : "border-input bg-card text-foreground hover:bg-muted"}`}>
                    <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                    <span>{type}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex items-center gap-3 py-1">
            <Switch id="billing-priority" checked={priority} onCheckedChange={setPriority} />
            <div className="min-w-0">
              <label htmlFor="billing-priority" className="cursor-pointer text-sm font-medium">Marcar como prioridade</label>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Sinaliza o pedido para atendimento prioritário.</p>
            </div>
          </div>
          {notice && <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">{notice}</p>}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" size="sm" className="bg-card" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" size="sm"><Send aria-hidden="true" /> Solicitar pedido</Button>
        </footer>
      </form>
    </BillingDialog>
  );
}
