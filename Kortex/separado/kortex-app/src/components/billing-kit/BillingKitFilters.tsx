import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BillingSelect, OperatorLogo } from "./BillingKitPrimitives";
import { emptyKitFilters, type KitFilters } from "./billingKitData";
const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function BillingKitFilters({ filters, years, onApply }: { filters: KitFilters; years: string[]; onApply: (filters: KitFilters) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const activeCount = Number(filters.operators.length !== 2) + Number(filters.month !== "all") + Number(filters.year !== "all") + Number(filters.availability !== "all");

  return (
    <Popover open={open} onOpenChange={(next) => { if (next) setDraft(filters); setOpen(next); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="bg-card">
          <Filter aria-hidden="true" /> Filtros
          {activeCount > 0 && <span className="rounded bg-accent px-1.5 text-xs text-accent-foreground" aria-label={`${activeCount} filtros ativos`}>{activeCount}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Filtros do kit faturamento" align="end" side="bottom" sideOffset={8} collisionPadding={12} className="flex max-h-[min(480px,var(--radix-popover-content-available-height))] w-[380px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg p-0 font-sans text-sm shadow-lg motion-reduce:!animate-none">
        <form className="flex min-h-0 flex-col" onSubmit={(event) => { event.preventDefault(); onApply(draft); setOpen(false); }}>
          <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold">Filtros</h2>
            <PopoverPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label="Fechar filtros"><X aria-hidden="true" /></Button>
            </PopoverPrimitive.Close>
          </header>
          <div className="min-h-0 space-y-5 overflow-y-auto p-4 scrollbar-thin">
            <fieldset>
              <legend className="mb-3 text-sm font-medium">Operadora</legend>
              <div className="grid grid-cols-2 gap-3">
                {(["Hapvida", "NDI"] as const).map((operator) => (
                  <label key={operator} className="flex cursor-pointer items-center gap-2.5">
                    <Checkbox aria-label={operator} checked={draft.operators.includes(operator)} onCheckedChange={(checked) => setDraft((current) => ({ ...current, operators: checked === true ? [...current.operators, operator] : current.operators.filter((item) => item !== operator) }))} />
                    <OperatorLogo operator={operator} />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-sm font-medium">Competência</legend>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5 text-xs text-muted-foreground"><span>Mês</span>
                  <BillingSelect aria-label="Mês" className="h-9" value={draft.month} onChange={(event) => setDraft({ ...draft, month: event.target.value })}>
                    <option value="all">Todos os meses</option>
                    {monthNames.map((name, index) => <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>)}
                  </BillingSelect>
                </label>
                <label className="space-y-1.5 text-xs text-muted-foreground"><span>Ano</span>
                  <BillingSelect aria-label="Ano" className="h-9" value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value })}>
                    <option value="all">Todos os anos</option>
                    {years.map((year) => <option key={year}>{year}</option>)}
                  </BillingSelect>
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-sm font-medium">Status do kit</legend>
              <RadioGroup value={draft.availability} onValueChange={(availability: KitFilters["availability"]) => setDraft({ ...draft, availability })} className="gap-3">
                {([["all", "Todos"], ["download", "Disponíveis"], ["request", "Pendentes"], ["track", "Em processamento"]] as const).map(([value, label]) => (
                  <label key={value} className="flex cursor-pointer items-center gap-2.5 text-sm font-normal"><RadioGroupItem value={value} />{label}</label>
                ))}
              </RadioGroup>
            </fieldset>
          </div>
          <footer className="grid shrink-0 grid-cols-2 gap-3 border-t border-border p-4">
            <Button type="button" variant="outline" size="sm" className="bg-card" onClick={() => setDraft(emptyKitFilters())}>Limpar</Button>
            <Button type="submit" size="sm">Aplicar filtros</Button>
          </footer>
        </form>
      </PopoverContent>
    </Popover>
  );
}
