import type { SalesClient, SalesDraft, SalesQuote } from "../../../supabase/functions/_shared/salesAssistant";

export type { SalesClient, SalesDraft, SalesQuote, SalesAnalysis, SalesAction } from "../../../supabase/functions/_shared/salesAssistant";

export const productLabels = { saude: "Saúde", odonto: "Odontológico", vida: "Vida" };

export function createSalesId(): string {
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
}

export function createSalesQuote(): SalesQuote {
  return { id: createSalesId(), insurer: "", plan: "", monthlyAmount: "", source: "", validUntil: "", conditions: "" };
}

export function createSalesDraft(client: SalesClient): SalesDraft {
  return { product: "saude", modality: "", lives: "", region: [client.city, client.state].filter(Boolean).join(" / "),
    needs: "", leadId: "", quotes: [createSalesQuote()] };
}

// Input follows the pt-BR field label; do not silently interpret 1.234 as 1,23.
export function parseMonthlyCents(value: string): number | null {
  const normalized = value.trim().replace(/^R\$\s*/, "");
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(normalized)) return null;
  const [integer, fraction = ""] = normalized.replace(/\./g, "").split(",");
  const cents = Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function todayInBrazil(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function proposalIssues(draft: SalesDraft, now = new Date()): string[] {
  const issues: string[] = [];
  if (!draft.modality.trim()) issues.push("Informe a modalidade de contratação.");
  if (!/^\d+$/.test(draft.lives) || Number(draft.lives) < 1 || Number(draft.lives) > 100000) issues.push("Informe o total de vidas confirmado.");
  if (!draft.region.trim()) issues.push("Informe a região de atendimento.");
  if (!draft.quotes.length) issues.push("Adicione uma cotação da operadora.");
  draft.quotes.forEach((quote, index) => {
    const label = `Opção ${index + 1}`;
    if (!quote.insurer.trim() || !quote.plan.trim()) issues.push(`${label}: informe operadora e produto.`);
    if (parseMonthlyCents(quote.monthlyAmount) === null) issues.push(`${label}: informe o valor mensal total em reais (ex.: 1.234,56).`);
    if (!quote.source.trim()) issues.push(`${label}: identifique a origem da cotação.`);
    const parsedDate = new Date(`${quote.validUntil}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(quote.validUntil) || Number.isNaN(parsedDate.valueOf()) ||
        parsedDate.toISOString().slice(0, 10) !== quote.validUntil || quote.validUntil < todayInBrazil(now)) {
      issues.push(`${label}: informe uma validade vigente para a cotação.`);
    }
    if (!quote.conditions.trim()) issues.push(`${label}: informe as condições apresentadas pela operadora.`);
  });
  return issues;
}

export function buildProposalText(client: SalesClient, draft: SalesDraft, now = new Date()): string {
  if (proposalIssues(draft, now).length) throw new Error("PROPOSAL_INCOMPLETE");
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  return [
    `Olá, ${client.name}! Seguem as opções de ${productLabels[draft.product].toLowerCase()} para ${client.company || "sua contratação"}.`,
    `Modalidade: ${draft.modality}\nTotal de vidas informado: ${draft.lives}\nRegião: ${draft.region}`,
    ...draft.quotes.map((quote, index) => [
      `Opção ${index + 1}: ${quote.insurer} — ${quote.plan}`,
      `Valor mensal total: ${money.format(parseMonthlyCents(quote.monthlyAmount)! / 100)}`,
      `Condições: ${quote.conditions}`,
      `Cotação: ${quote.source}\nValidade: ${quote.validUntil.split("-").reverse().join("/")}`,
    ].join("\n")),
    "Esta apresentação comercial segue as cotações indicadas. A contratação depende da documentação, análise e formalização pela operadora.",
    "Qual opção você gostaria de avaliar?",
  ].join("\n\n");
}
