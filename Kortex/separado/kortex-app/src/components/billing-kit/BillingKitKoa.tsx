import { useRef, useState } from "react";
import { Check, FileText, Ghost, Package, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BillingDialog } from "./BillingKitPrimitives";

function KoaSymbol({ className }: { className: string }) {
  const [missingImage, setMissingImage] = useState(false);
  return missingImage
    ? <Ghost aria-hidden="true" className={`${className} text-primary`} />
    : <img src="/brand/koa-ghost-static.png" alt="" className={`${className} object-contain`} onError={() => setMissingImage(true)} />;
}

export function BillingKitKoa({ companies }: { companies: { id: string; company: string }[] }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [showPresentation, setShowPresentation] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [selectingCompany, setSelectingCompany] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const visibleCompanies = companies.filter((company) => company.company.toLocaleLowerCase("pt-BR").includes(companyQuery.trim().toLocaleLowerCase("pt-BR")));

  return (
    <>
      <Popover open={showPresentation} onOpenChange={setShowPresentation}>
        <PopoverTrigger asChild>
          <Button ref={triggerRef} type="button" variant="outline" size="icon" className="h-9 w-9 rounded-full bg-card" aria-label="Abrir KOA"><KoaSymbol className="h-6 w-6" /></Button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} collisionPadding={12} className="w-[320px] max-w-[calc(100vw-24px)] rounded-lg p-4 font-sans text-sm motion-reduce:!animate-none">
          <div className="flex items-center gap-4">
            <KoaSymbol className="h-16 w-16 shrink-0" />
            <div className="space-y-2">
              <p className="font-semibold">Oi! Eu sou o KOA.</p>
              <p className="text-sm leading-5 text-muted-foreground">Vamos buscar seu kit de faturamento?</p>
              <Button type="button" size="sm" onClick={() => { setNotice(""); setMessage(""); setSelectingCompany(false); setSelectedCompany(""); setCompanyQuery(""); setShowPresentation(false); setShowChat(true); }}>Iniciar a busca</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <BillingDialog open={showChat} onOpenChange={setShowChat} title="KOA" className="max-w-[420px]" triggerRef={triggerRef}>
        <div className="flex h-[520px] min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
            {selectingCompany ? (
              <div className="space-y-3">
                <label htmlFor="koa-billing-company-search" className="text-sm font-medium">Empresa</label>
                <div className="relative">
                  <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="koa-billing-company-search" placeholder="Buscar empresa..." value={companyQuery} onChange={(event) => setCompanyQuery(event.target.value)} className="bg-card pl-9 text-sm" />
                </div>
                <div className="space-y-1">
                  {visibleCompanies.map((company) => (
                    <button type="button" key={company.id} aria-pressed={company.id === selectedCompany} onClick={() => { setSelectedCompany(company.id); setNotice(""); }} className={`flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${company.id === selectedCompany ? "bg-accent" : "hover:bg-muted"}`}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{company.company.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span>
                      <span className="min-w-0 flex-1">{company.company}</span>
                      {company.id === selectedCompany && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  ))}
                  {visibleCompanies.length === 0 && <p className="py-4 text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>}
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4">
                <KoaSymbol className="h-20 w-20" />
                <h2 className="text-lg font-semibold">O que deseja emitir?</h2>
                <div className="flex w-full flex-col items-start gap-2">
                  {["Boleto", "NF", "Kit de faturamento"].map((label) => {
                    const Icon = label === "Kit de faturamento" ? Package : FileText;
                    return <Button type="button" key={label} variant="outline" size="sm" className="rounded-full bg-card font-normal" onClick={() => { setSelectingCompany(true); setNotice(""); }}><Icon aria-hidden="true" />{label}</Button>;
                  })}
                </div>
              </div>
            )}
            {notice && <p role="status" className="mt-3 rounded-md bg-muted p-3 text-sm leading-5">{notice}</p>}
          </div>
          {selectingCompany ? (
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3">
              <Button type="button" variant="outline" size="sm" className="bg-card" onClick={() => { setSelectingCompany(false); setNotice(""); }}>Cancelar</Button>
              <Button type="button" size="sm" disabled={!selectedCompany} onClick={() => setNotice("A busca automática do kit de faturamento ainda não está disponível nesta versão.")}>Iniciar busca</Button>
            </footer>
          ) : (
            <form className="flex shrink-0 items-center gap-2 border-t border-border p-3" onSubmit={(event) => { event.preventDefault(); if (message.trim()) { setSelectingCompany(true); setMessage(""); } }}>
              <Input aria-label="Mensagem para o KOA" placeholder="Digite uma mensagem..." value={message} onChange={(event) => setMessage(event.target.value)} className="border-0 bg-card text-sm shadow-none" />
              <Button type="submit" variant="ghost" size="icon" className="shrink-0 text-primary" disabled={!message.trim()} aria-label="Enviar mensagem"><Send aria-hidden="true" /></Button>
            </form>
          )}
        </div>
      </BillingDialog>
    </>
  );
}
