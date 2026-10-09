import type { CardBeneficiary } from "./cardPreview.js";

export interface CardListRow extends CardBeneficiary {
  index: number;
  kind: "beneficiary" | "header" | "bulk" | "unknown";
  visible: boolean;
  selectable: boolean;
  tableIndex: number;
  memberType?: "holder" | "dependent";
  holderReferences: string[];
  holderName?: string;
  text?: string;
  identityText?: string;
}

// These functions are serialized into the browser. Keep their DOM helpers inside the function.
export function inspectCardListRows(input: unknown | unknown[]): CardListRow[] {
  const elements: any[] = Array.isArray(input) ? input : [input];
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f\u00ad\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
  const nameHeading = /^(?:nome(?:\s+(?:completo|do|da|beneficiario|usuario|segurado))*|beneficiario|usuario|segurado)$/;
  const controls = 'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]';
  const visible = (element: any) => {
    const rect = element.getBoundingClientRect(), style = element.ownerDocument.defaultView.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const cellsOf = (row: any): any[] => Array.from(row.children as any[]).filter(cell =>
    /^(TD|TH)$/.test(cell.tagName) || /^(cell|columnheader|rowheader)$/.test(cell.getAttribute("role") ?? ""));
  const headers = new Map<any, string[]>();
  const tables = new Map<any, number>();
  return elements.map((node, index) => {
    const cells = cellsOf(node), texts = cells.map(cell => (cell.innerText ?? "").trim());
    const labels = texts.map(normalize).filter(Boolean);
    const headerRow = labels.some(label => nameHeading.test(label));
    const rowText = normalize(node.innerText ?? "");
    const bulkRow = /^(?:(?:selecionar|marcar|desmarcar|imprimir)\s+)?(?:todos|todas|tudo)(?:\s+(?:os|as))?(?:\s+(?:beneficiarios|carteirinhas))?$/.test(rowText);
    const leaf = !node.querySelector('tr, [role="row"]');
    const selectable = leaf && Array.from(node.querySelectorAll(controls) as any[]).some(control => !control.disabled &&
      control.getAttribute("aria-disabled") !== "true" && (visible(control) ||
        Array.from(control.labels ?? []).some(visible) || (control.closest("label") && visible(control.closest("label")))));
    const table = node.closest('table, [role="table"], [role="grid"]');
    if (table && !tables.has(table)) tables.set(table, tables.size);
    if (table && !headers.has(table)) {
      const heading = Array.from(table.querySelectorAll('tr, [role="row"]') as any[]).find(row => {
        if (row.querySelector('tr, [role="row"]')) return false;
        return cellsOf(row).some(cell => nameHeading.test(normalize(cell.innerText ?? "")));
      });
      headers.set(table, heading ? cellsOf(heading).map(cell => normalize(cell.innerText ?? "")) : []);
    }
    const headings = headers.get(table) ?? [];
    const nameIndex = headings.findIndex(label => nameHeading.test(label));
    const candidates = texts.filter(text => /^[\p{L} .'-]+$/u.test(text) && text.split(/\s+/).length >= 2 &&
      !/\b(plano|selecionar|imprimir|carteira|contrato|titular|dependente)\b/i.test(text));
    const beneficiaryName = !headerRow && !bulkRow
      ? nameIndex >= 0 ? texts[nameIndex] ?? "" : candidates.length === 1 ? candidates[0]! : "" : "";
    const cardIdentifiers: string[] = [];
    let cpf: string | undefined, requireIdentifier = false, memberType: CardListRow["memberType"], holderName: string | undefined;
    const holderReferences: string[] = [];
    headings.forEach((label, cellIndex) => {
      const value = texts[cellIndex] ?? "", normalized = normalize(value);
      const digits = (texts[cellIndex] ?? "").replace(/\D/g, "");
      if (/tipo|vinculo|parentesco|condicao|titularidade/.test(label)) {
        if (/^(titular|t)$/.test(normalized)) memberType = "holder";
        else if (/^(dependente|d|filh[oa]|conjuge|espos[oa]|companheir[oa]|entead[oa])(?:\s|$)/.test(normalized)) memberType = "dependent";
      }
      if (/titular/.test(label) && /codigo|cd\b|cod\b|matricula|carteira/.test(label) && normalized) holderReferences.push(normalized.replace(/[\s.\/-]/g, ""));
      else if (/^(?:nome\s+(?:do\s+)?titular|titular)$/.test(label) && normalized.split(" ").length > 1) holderName = value;
      if (/\bcpf\b/.test(label) && !/\btitular\b/.test(label) && digits.length === 11) cpf = digits;
      if (!/\btitular\b/.test(label) && /\b(carteira|carteirinha|matricula)\b|(codigo|cd\.?|cod\.?).*(beneficiario|usuario|segurado)/.test(label) && digits.length >= 6 && !/^0+$/.test(digits)) {
        cardIdentifiers.push(digits);
        if (/\b(carteira|carteirinha)\b/.test(label)) requireIdentifier = true;
      }
    });
    for (const control of node.querySelectorAll('input[name*="cd_beneficiario"], input[name*="cd_usuario"], input[name*="carteira"], input[name*="matricula"]')) {
      if (/titular/i.test(control.name ?? "")) continue;
      const digits = (control.value ?? "").replace(/\D/g, "");
      if (digits.length >= 6 && !/^0+$/.test(digits)) cardIdentifiers.push(digits);
    }
    for (const control of node.querySelectorAll('input[name*="cd_titular"], input[name*="codigo_titular"], input[name*="matricula_titular"]')) {
      const value = normalize(control.value ?? "").replace(/[\s.\/-]/g, ""); if (value) holderReferences.push(value);
    }
    const holderReference = node.getAttribute("data-holder-code") ?? node.getAttribute("data-titular-code");
    if (holderReference) holderReferences.push(normalize(holderReference).replace(/[\s.\/-]/g, ""));
    const type = normalize(node.getAttribute("data-member-type") ?? "");
    if (type === "holder" || type === "titular") memberType = "holder";
    if (type === "dependent" || type === "dependente") memberType = "dependent";
    let identityText = rowText;
    if (leaf && beneficiaryName) {
      const copy = node.cloneNode(true);
      for (const control of copy.querySelectorAll('input,button,select,label,[role="checkbox"],[role="radio"]')) control.remove();
      identityText = normalize(copy.textContent ?? "");
    }
    return { index, beneficiaryName, cpf, cardIdentifiers: [...new Set(cardIdentifiers)], requireIdentifier,
      kind: headerRow ? "header" : bulkRow ? "bulk" : beneficiaryName ? "beneficiary" : "unknown",
      visible: leaf && visible(node), selectable, tableIndex: tables.get(table) ?? -1, memberType,
      holderReferences: [...new Set(holderReferences)], holderName, text: rowText, identityText };
  });
}

export function inspectCardSelectionControls(elements: unknown[], expected: unknown[] = []) {
  const expectedSet = new Set(expected);
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return (elements as any[]).map((control, index) => {
    const native = /^(checkbox|radio)$/i.test(control.type ?? "");
    const row = control.closest('tr, [role="row"]');
    const label = normalize([control.getAttribute("aria-label"), control.title,
      ...Array.from(control.labels ?? []).map((element: any) => element.innerText), control.closest("label")?.innerText].filter(Boolean).join(" "));
    const hints = normalize([control.id, control.name, control.getAttribute("onclick")].filter(Boolean).join(" "));
    const header = row && (row.closest("thead") || Array.from(row.children as any[]).some(cell =>
      /^(nome(?:\s+(?:completo|do|da|beneficiario|usuario|segurado))*|beneficiario|usuario|segurado)$/.test(normalize(cell.innerText ?? ""))));
    const bulk = Boolean(header) || /^(?:(?:selecionar|marcar|desmarcar)\s+)?(?:todos|todas|tudo|all)(?:\s+(?:os|as))?(?:\s+(?:beneficiarios|carteirinhas))?$/.test(label) ||
      /(?:seleciona\w*|marca\w*|check|select)[_\s-]*(?:todos|todas|tudo|all)|(?:^|[_\s-])(?:todos|todas|tudo|all)(?:$|[_\s-])/.test(hints) ||
      /^(?:(?:selecionar|marcar|desmarcar)\s+)?(?:todos|todas|tudo)(?:\s+(?:os|as))?(?:\s+beneficiarios)?$/.test(normalize(row?.innerText ?? ""));
    return { index, selected: native ? Boolean(control.checked) : control.getAttribute("aria-checked") === "true",
      enabled: !control.disabled && control.getAttribute("aria-disabled") !== "true", native, bulk,
      inRow: Boolean(row), expected: expectedSet.has(control) };
  });
}
