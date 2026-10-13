import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Eye, FileText, MoreVertical, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { BillingKitFilters } from "@/components/billing-kit/BillingKitFilters";
import { BillingKitKoa } from "@/components/billing-kit/BillingKitKoa";
import { BillingKitManualRequest } from "@/components/billing-kit/BillingKitManualRequest";
import { BillingDialog, BillingSelect, OperatorLogo } from "@/components/billing-kit/BillingKitPrimitives";
import { billingItems, emptyKitFilters, type BillingKitItem, type KitAvailability, type KitFilters } from "@/components/billing-kit/billingKitData";

const availabilityLabels: Record<KitAvailability, string> = { download: "Disponível", request: "Pendente", track: "Em processamento" };
type SortField = "company" | "operator" | "competence" | "updatedAt";
const dateKey = (value: string) => value.split("/").reverse().join("");
const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export default function BillingKitPage() {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<KitFilters>(emptyKitFilters);
  const [sort, setSort] = useState<{ field: SortField; ascending: boolean }>({ field: "updatedAt", ascending: false });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manualRequest, setManualRequest] = useState<{ companyId?: string } | null>(null);
  const [details, setDetails] = useState<BillingKitItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const years = [...new Set(billingItems.map((item) => item.competence.split("/")[1]))].sort().reverse();

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !document.querySelector('[role="dialog"]')) {
        event.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const filteredItems = useMemo(() => {
    const search = normalizeSearch(query.trim());
    return billingItems.filter((item) => {
      const [month, year] = item.competence.split("/");
      return (!search || normalizeSearch(item.company).includes(search))
        && filters.operators.includes(item.operator)
        && (filters.availability === "all" || item.action === filters.availability)
        && (filters.month === "all" || month === filters.month)
        && (filters.year === "all" || year === filters.year);
    }).sort((a, b) => {
      const left = sort.field === "competence" || sort.field === "updatedAt" ? dateKey(a[sort.field]) : a[sort.field];
      const right = sort.field === "competence" || sort.field === "updatedAt" ? dateKey(b[sort.field]) : b[sort.field];
      return left.localeCompare(right, "pt-BR") * (sort.ascending ? 1 : -1);
    });
  }, [filters, query, sort]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedVisible = visibleItems.filter((item) => selected.has(item.id)).length;

  const toggleSelection = (id: string) => setSelected((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const selectPage = (checked: boolean) => setSelected((current) => {
    const next = new Set(current); visibleItems.forEach((item) => { if (checked) next.add(item.id); else next.delete(item.id); }); return next;
  });
  const exportItems = () => {
    const rows = selected.size ? filteredItems.filter((item) => selected.has(item.id)) : filteredItems;
    const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [["Empresa", "Operadora", "Competência", "Última atualização", "Status"], ...rows.map((item) => [item.company, item.operator, item.competence, item.updatedAt, availabilityLabels[item.action]])].map((row) => row.map(cell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "kit-faturamento.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const renderSort = (field: SortField, label: string) => {
    const Icon = sort.field !== field ? ArrowUpDown : sort.ascending ? ArrowUp : ArrowDown;
    return <button type="button" className="inline-flex items-center gap-2 rounded-sm text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setSort({ field, ascending: sort.field === field ? !sort.ascending : true }); setPage(1); }}>{label}<Icon aria-hidden="true" className={`h-3.5 w-3.5 ${sort.field === field ? "text-primary" : "text-muted-foreground"}`} /></button>;
  };
  const ariaSort = (field: SortField): "ascending" | "descending" | "none" => sort.field === field ? sort.ascending ? "ascending" : "descending" : "none";

  return (
    <section aria-label="Kit faturamento" className="flex h-full min-h-0 flex-col gap-4 bg-card p-4 font-sans text-sm text-foreground sm:p-6">
      <h1 className="sr-only">Kit faturamento</h1>
      <div role="toolbar" aria-label="Ações do kit faturamento" className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <div className="relative min-w-0 basis-full sm:w-[280px] sm:basis-auto lg:w-[320px]">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} type="search" aria-label="Buscar empresa" placeholder="Buscar empresa..." value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} className="h-9 bg-card pl-9 pr-16 text-sm" />
          <kbd aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">Ctrl K</kbd>
        </div>
        <BillingKitKoa companies={billingItems} />
        <BillingKitFilters filters={filters} years={years} onApply={(next) => { setFilters(next); setPage(1); }} />
        <Button type="button" variant="outline" size="sm" className="bg-card" disabled={filteredItems.length === 0} onClick={exportItems}><Download aria-hidden="true" /> Exportar</Button>
        <Button type="button" size="sm" onClick={() => setManualRequest({})}><Plus aria-hidden="true" /> Novo pedido</Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <table className="w-full min-w-[740px] border-separate border-spacing-0 text-left text-sm">
            <caption className="sr-only">Kits de faturamento por empresa, operadora e competência</caption>
            <thead className="sticky top-0 z-10 bg-muted">
              <tr className="text-muted-foreground">
                <th scope="col" className="w-12 border-b border-border px-4 py-3"><Checkbox aria-label="Selecionar empresas desta página" disabled={visibleItems.length === 0} checked={visibleItems.length > 0 && selectedVisible === visibleItems.length ? true : selectedVisible > 0 ? "indeterminate" : false} onCheckedChange={(checked) => selectPage(checked === true)} /></th>
                <th scope="col" aria-sort={ariaSort("company")} className="border-b border-border px-3 py-3">{renderSort("company", "Empresa")}</th>
                <th scope="col" aria-sort={ariaSort("operator")} className="border-b border-border px-3 py-3">{renderSort("operator", "Operadora")}</th>
                <th scope="col" aria-sort={ariaSort("competence")} className="border-b border-border px-3 py-3">{renderSort("competence", "Competência")}</th>
                <th scope="col" aria-sort={ariaSort("updatedAt")} className="border-b border-border px-3 py-3">{renderSort("updatedAt", "Última atualização")}</th>
                <th scope="col" className="w-24 border-b border-border px-3 py-3 text-xs font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const Icon = item.action === "download" ? Download : item.action === "request" ? FileText : Eye;
                const actionLabel = item.action === "download" ? "Baixar kit" : item.action === "request" ? "Solicitar pedido" : "Acompanhar kit";
                return (
                  <tr key={item.id} className={selected.has(item.id) ? "bg-accent/40" : "hover:bg-muted/40"}>
                    <td className="border-b border-border px-4 py-3"><Checkbox aria-label={`Selecionar ${item.company}`} checked={selected.has(item.id)} onCheckedChange={() => toggleSelection(item.id)} /></td>
                    <td className="border-b border-border px-3 py-3">
                      <div className="flex items-center gap-3">
                        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-dimmer">{initials(item.company)}</span>
                        <div><p className="font-medium leading-5">{item.company}</p><p className="text-xs leading-5 text-muted-foreground">{availabilityLabels[item.action]}</p></div>
                      </div>
                    </td>
                    <td className="border-b border-border px-3 py-3"><OperatorLogo operator={item.operator} /></td>
                    <td className="border-b border-border px-3 py-3 tabular-nums">{item.competence}</td>
                    <td className="border-b border-border px-3 py-3 tabular-nums text-muted-dimmer">{item.updatedAt}</td>
                    <td className="border-b border-border px-3 py-3">
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8 bg-card" aria-label={`${actionLabel}: ${item.company}`} onClick={() => item.action === "request" ? setManualRequest({ companyId: item.id }) : setDetails(item)}><Icon aria-hidden="true" /></Button>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`Detalhes: ${item.company}`} onClick={() => setDetails(item)}><MoreVertical aria-hidden="true" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleItems.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">Nenhuma empresa encontrada com esses filtros.</td></tr>}
            </tbody>
          </table>
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <p role="status">Mostrando {filteredItems.length ? (currentPage - 1) * pageSize + 1 : 0} a {Math.min(currentPage * pageSize, filteredItems.length)} de {filteredItems.length} empresas</p>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8 bg-card" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft aria-hidden="true" /></Button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <Button key={number} type="button" variant="outline" size="icon" aria-label={`Página ${number}`} aria-current={number === currentPage ? "page" : undefined} onClick={() => setPage(number)} className={`h-8 w-8 ${number === currentPage ? "border-primary bg-accent text-accent-foreground" : "bg-card"}`}>{number}</Button>)}
            <Button type="button" variant="outline" size="icon" className="h-8 w-8 bg-card" aria-label="Próxima página" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight aria-hidden="true" /></Button>
            <BillingSelect aria-label="Empresas por página" className="h-8 text-xs" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
              {[5, 10, 25].map((size) => <option key={size} value={size}>{size} por página</option>)}
            </BillingSelect>
          </div>
        </footer>
      </div>
      {manualRequest && <BillingKitManualRequest open onOpenChange={(open) => { if (!open) setManualRequest(null); }} companies={billingItems} initialCompanyId={manualRequest.companyId} />}
      <BillingDialog open={details !== null} onOpenChange={(open) => { if (!open) setDetails(null); }} title="Detalhes do kit" className="max-w-[420px]">
        {details && <div className="min-h-0 space-y-3 overflow-y-auto p-5"><p className="font-medium">{details.company}</p><OperatorLogo operator={details.operator} /><p className="text-muted-foreground">Competência: {details.competence}</p><p>{details.pendingAction}</p>{details.action === "download" && <p className="text-sm text-muted-foreground">O download dos documentos ainda não está disponível nesta versão.</p>}</div>}
      </BillingDialog>
    </section>
  );
}
