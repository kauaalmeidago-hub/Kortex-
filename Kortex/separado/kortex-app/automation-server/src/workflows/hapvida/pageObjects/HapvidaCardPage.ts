import type { Locator, Page } from "playwright";
import { AutomationError } from "../../../errors.js";
import { waitForRenderedCards, type CardBeneficiary } from "../cardPreview.js";

export interface BeneficiarySearchInput extends CardBeneficiary {}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f\u00ad\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function onlyDigits(value: string | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ROW_SELECTOR = 'tr, [role="row"]';
const CONTROL_SELECTOR = 'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]';

export class HapvidaCardPage {
  constructor(private readonly page: Page, private readonly previewTimeoutMs = 30_000, private readonly portalUrl?: string) {}

  periodHeading() {
    return this.page.getByText(/datas?\s+de\s+ades[aã]o/i).first();
  }

  startDateField() {
    return this.page
      .getByLabel(/data\s+inicial|in[ií]cio|ades[aã]o\s+inicial/i)
      .or(this.page.getByPlaceholder(/data\s+inicial|dd\/mm\/aaaa/i).first())
      .or(this.page.locator('input[type="text"], input:not([type])').nth(0));
  }

  endDateField() {
    return this.page
      .getByLabel(/data\s+final|fim|ades[aã]o\s+final/i)
      .or(this.page.getByPlaceholder(/data\s+final|dd\/mm\/aaaa/i).last())
      .or(this.page.locator('input[type="text"], input:not([type])').nth(1));
  }

  periodSubmitButton() {
    return this.page
      .getByRole("button", { name: /^ok$/i })
      .or(this.page.getByRole("button", { name: /consultar|pesquisar|buscar|prosseguir/i }))
      .or(this.page.locator('input[type="submit"][value="OK"], input[type="button"][value="OK"], input[value*="consultar" i], input[value*="pesquisar" i], input[value*="buscar" i]'));
  }

  printSelectedButton() {
    return this.page
      .getByRole("button", { name: /imprimir\s+selecionados/i })
      .or(this.page.getByRole("link", { name: /imprimir\s+selecionados/i }))
      .or(this.page.locator('input[value*="imprimir selecionados" i], input[value*="imprimir selecionadas" i]'));
  }

  async waitForPeriodForm() {
    await this.periodHeading().waitFor({ state: "visible" });
  }

  async fillPeriod(startDate: string, endDate: string) {
    await this.startDateField().fill(startDate);
    await this.endDateField().fill(endDate);
  }

  async submitPeriod() {
    await this.periodSubmitButton().click();
    await this.waitForBeneficiaryList();
  }

  async selectBeneficiary(input: BeneficiarySearchInput) {
    const row = await this.findSingleBeneficiaryRow(input);
    const selection = await this.findSelectionControl(row);
    if (!selection) {
      const controls = await row.locator(CONTROL_SELECTOR).count();
      throw new AutomationError("PORTAL_CHANGED", "Nao encontrei o seletor do beneficiario no portal.", {
        safeDetails: `A linha do beneficiario apareceu, mas nao havia um controle habilitado ou um rotulo visivel associado. Controles encontrados: ${controls}.`,
        step: "select_beneficiary",
        retryable: true,
      });
    }

    const identity = await this.readRowIdentity(row);
    if (input.cpf && identity.cpf && onlyDigits(input.cpf) !== identity.cpf) {
      throw new AutomationError("BENEFICIARY_NOT_FOUND", "O CPF da linha nao corresponde ao pedido.", { step: "find_beneficiary" });
    }
    // Old portal lists can contain preselected rows. Never print another person's card with this request.
    await this.clearSelections(selection.control);

    try {
      const native = /^(checkbox|radio)$/i.test(await selection.control.getAttribute("type") ?? "");
      const checked = native ? await selection.control.isChecked() : await selection.control.getAttribute("aria-checked") === "true";
      if (!checked) {
        if (selection.label || !native) await selection.target.click();
        else await selection.control.check();
      }
      const confirmed = native ? await selection.control.isChecked() : await selection.control.getAttribute("aria-checked") === "true";
      if (!confirmed) throw new Error("Selection was not confirmed");
    } catch {
      throw new AutomationError("BENEFICIARY_SELECTION_FAILED", "Nao foi possivel confirmar a selecao do beneficiario.", {
        safeDetails: "A emissao foi interrompida antes de imprimir porque o portal nao confirmou o controle selecionado.",
        step: "confirm_beneficiary_selection", retryable: true,
      });
    }
    await this.assertSelectedControls([selection.control]);
    return { ...input, cpf: input.cpf ?? identity.cpf, cardIdentifiers: identity.cardIdentifiers, requireIdentifier: identity.requireIdentifier };
  }

  async selectAllBeneficiaries(): Promise<BeneficiarySearchInput[]> {
    const nextPage = this.page.getByRole("link", { name: /^(?:proxima|próxima|seguinte|next)(?:\s+p[aá]gina)?$/i })
      .or(this.page.getByRole("button", { name: /^(?:proxima|próxima|seguinte|next)(?:\s+p[aá]gina)?$/i }));
    for (let index = 0; index < await nextPage.count(); index += 1) {
      if (await nextPage.nth(index).isVisible() && await nextPage.nth(index).isEnabled() &&
          await nextPage.nth(index).getAttribute("aria-disabled") !== "true") {
        throw new AutomationError("CARD_BATCH_INCOMPLETE", "O portal apresentou uma lista paginada para emissao em lote.", {
          safeDetails: "Nao foi entregue um lote parcial. Consulte um periodo que retorne a lista completa.", step: "select_beneficiary",
        });
      }
    }
    const rows = this.page.locator(ROW_SELECTOR);
    const selections: Array<{ control: Locator; target: Locator; label: boolean; input: BeneficiarySearchInput }> = [];
    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index);
      if (!await row.isVisible() || await row.locator(ROW_SELECTOR).count() || await row.locator("th").count()) continue;
      const selection = await this.findSelectionControl(row);
      if (!selection) continue;
      const identity = await this.readRowIdentity(row);
      if (!identity.beneficiaryName) {
        throw new AutomationError("CARD_BATCH_INCOMPLETE", "Nao foi possivel identificar todos os beneficiarios da lista.", {
          safeDetails: "Uma linha selecionavel nao apresentou um nome identificavel. Nenhuma carteirinha foi impressa.", step: "select_beneficiary",
        });
      }
      selections.push({ ...selection, input: identity });
    }
    if (!selections.length) throw new AutomationError("BENEFICIARY_NOT_FOUND", "Nao ha beneficiarios disponiveis no periodo informado.", { step: "find_beneficiary" });
    const identityCandidates = new Map(selections.map(selection => [selection, [...(selection.input.cardIdentifiers ?? []), ...(selection.input.cpf ? [selection.input.cpf] : [])]]));
    for (const selection of selections) {
      const homonyms = selections.filter(other => normalizeText(other.input.beneficiaryName) === normalizeText(selection.input.beneficiaryName));
      if (homonyms.length > 1) {
        const ids = identityCandidates.get(selection)!;
        const uniqueIds = ids.filter(id => homonyms.filter(other => identityCandidates.get(other)!.includes(id)).length === 1);
        if (!uniqueIds.length) {
          throw new AutomationError("BENEFICIARY_AMBIGUOUS", "Ha nomes repetidos sem identificador individual para conferir o lote.", { step: "find_beneficiary" });
        }
        selection.input.cardIdentifiers = uniqueIds;
        if (selection.input.cpf && !uniqueIds.includes(selection.input.cpf)) selection.input.cpf = undefined;
        selection.input.requireIdentifier = true;
      }
    }
    await this.clearSelections();
    try {
      for (const selection of selections) {
        const native = /^(checkbox|radio)$/i.test(await selection.control.getAttribute("type") ?? "");
        if (native && !selection.label) await selection.control.check();
        else if (!await this.isSelected(selection.control)) await selection.target.click();
      }
      await this.assertSelectedControls(selections.map(selection => selection.control));
    } catch {
      throw new AutomationError("BENEFICIARY_SELECTION_FAILED", "O portal nao confirmou a selecao completa do lote.", {
        safeDetails: "Nenhum PDF foi gerado porque uma ou mais selecoes nao permaneceram marcadas.", step: "confirm_beneficiary_selection", retryable: true,
      });
    }
    return selections.map(selection => selection.input);
  }

  private async isSelected(control: Locator) {
    return /^(checkbox|radio)$/i.test(await control.getAttribute("type") ?? "")
      ? control.isChecked() : await control.getAttribute("aria-checked") === "true";
  }

  private async clearSelections(except?: Locator) {
    const controls = this.page.locator(`${ROW_SELECTOR.split(", ").map(row => `${row} ${CONTROL_SELECTOR.split(", ").join(`, ${row} `)}`).join(", ")}`);
    const exceptHandle = except ? await except.elementHandle() : undefined;
    try {
      for (let index = 0; index < await controls.count(); index += 1) {
        const control = controls.nth(index);
        if (!await control.isEnabled() || !await this.isSelected(control)) continue;
        if (exceptHandle && await control.evaluate((element, target) => element === target, exceptHandle)) continue;
        const type = await control.getAttribute("type");
        if (type === "radio") continue;
        if (type === "checkbox" && await control.isVisible()) await control.uncheck();
        else {
          const row = control.locator('xpath=ancestor::*[self::tr or @role="row"][1]');
          const selection = await this.findSelectionControl(row, control);
          if (!selection) throw new AutomationError("BENEFICIARY_SELECTION_FAILED", "Nao foi possivel limpar uma selecao anterior.", { step: "confirm_beneficiary_selection" });
          await selection.target.click();
        }
      }
    } finally { await exceptHandle?.dispose(); }
  }

  private async assertSelectedControls(expected: Locator[]) {
    for (const control of expected) if (!await this.isSelected(control)) throw new AutomationError("BENEFICIARY_SELECTION_FAILED", "A selecao nao foi confirmada.", { step: "confirm_beneficiary_selection" });
    const checked = this.page.locator('tr input:checked, [role="row"] input:checked, tr [aria-checked="true"], [role="row"] [aria-checked="true"]');
    if (await checked.count() !== expected.length) throw new AutomationError("BENEFICIARY_SELECTION_FAILED", "O portal manteve uma selecao diferente da solicitada.", { step: "confirm_beneficiary_selection" });
  }

  private async readRowIdentity(row: Locator): Promise<BeneficiarySearchInput> {
    return row.evaluate(element => {
      const node = element as any;
      const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
      const cells = Array.from(node.children as any[]).filter(cell => /^(TD|TH)$/.test(cell.tagName) || cell.getAttribute("role") === "cell");
      const table = node.closest("table");
      const header = table && (Array.from(table.querySelectorAll("tr") as any[]).find(row => row.querySelector("th") && !row.querySelector("tr")));
      const headings = header ? Array.from(header.children as any[]).map(cell => normalize(cell.innerText ?? "")) : [];
      let nameIndex = headings.findIndex(label => /\bnome\b/.test(label));
      if (nameIndex < 0) nameIndex = headings.findIndex(label => /^(beneficiario|usuario|segurado)$/.test(label));
      const candidates = cells.map(cell => (cell.innerText ?? "").trim()).filter(text => /^[\p{L} .'-]+$/u.test(text) &&
        text.split(/\s+/).length >= 2 && !/\b(plano|selecionar|imprimir|carteira|contrato|titular|dependente)\b/i.test(text));
      const beneficiaryName = nameIndex >= 0 ? (cells[nameIndex]?.innerText ?? "").trim() : candidates.length === 1 ? candidates[0] : "";
      const cardIdentifiers: string[] = [];
      let cpf: string | undefined;
      let requireIdentifier = false;
      headings.forEach((label, index) => {
        const digits = (cells[index]?.innerText ?? "").replace(/\D/g, "");
        if (/\bcpf\b/.test(label) && digits.length === 11) cpf = digits;
        if (/\b(carteira|carteirinha|matricula)\b|(codigo|cd\.?|cod\.?).*(beneficiario|usuario|segurado)/.test(label) && digits.length >= 6 && !/^0+$/.test(digits)) {
          cardIdentifiers.push(digits);
          if (/\b(carteira|carteirinha)\b/.test(label)) requireIdentifier = true;
        }
      });
      for (const input of node.querySelectorAll('input[name*="cd_beneficiario"], input[name*="cd_usuario"], input[name*="carteira"], input[name*="matricula"]')) {
        const digits = (input.value ?? "").replace(/\D/g, ""); if (digits.length >= 6 && !/^0+$/.test(digits)) cardIdentifiers.push(digits);
      }
      return { beneficiaryName, cpf, cardIdentifiers: [...new Set(cardIdentifiers)], requireIdentifier };
    });
  }

  private async waitForBeneficiaryList() {
    const ready = await this.page.waitForFunction(() => {
      const scope = globalThis as unknown as { document: {
        body?: { innerText: string };
        querySelectorAll(selector: string): ArrayLike<{ innerText: string; getBoundingClientRect(): { width: number; height: number }; querySelector(selector: string): unknown }>;
      }; getComputedStyle(element: unknown): { display: string; visibility: string } };
      const visible = (element: { getBoundingClientRect(): { width: number; height: number } }) => {
        const rect = element.getBoundingClientRect(), style = scope.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const doc = scope.document;
      if (Array.from(doc.querySelectorAll('[aria-busy="true"], [role="progressbar"]')).some(visible)) return false;
      const text = (doc.body?.innerText ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (/nenhum\s+(?:beneficiario|usuario|registro)|sem\s+(?:registros|resultados|beneficiarios)|nao\s+(?:foi|foram)\s+encontrad/.test(text)) return true;
      const print = Array.from(doc.querySelectorAll('button, input[type="button"], input[type="submit"], a')).some(element =>
        visible(element) && /imprimir\s+selecionados/i.test(element.innerText || (element as unknown as { value?: string }).value || ""));
      return print && Array.from(doc.querySelectorAll('tr, [role="row"]')).some(row =>
        visible(row) && !row.querySelector('tr, [role="row"]') && Boolean(row.innerText.trim()));
    }, undefined, { timeout: this.previewTimeoutMs }).catch(() => {
      throw new AutomationError("PORTAL_RESULTS_NOT_READY", "O portal nao confirmou o carregamento da lista de beneficiarios.", {
        safeDetails: "A consulta nao ficou pronta para selecionar e imprimir. Essa falha nao confirma ausencia do beneficiario.",
        step: "find_beneficiary", retryable: true,
      });
    });
    await ready.dispose();
  }

  private async findSelectionControl(row: Locator, specificControl?: Locator) {
    const controls = specificControl ?? row.locator(CONTROL_SELECTOR);
    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index);
      if (!(await control.isEnabled().catch(() => false))) continue;
      if (await control.isVisible().catch(() => false)) return { control, target: control, label: false };
      const id = await control.getAttribute("id");
      const labels = row.locator("label");
      for (let labelIndex = 0; labelIndex < await labels.count(); labelIndex += 1) {
        const label = labels.nth(labelIndex);
        if (id && await label.getAttribute("for") === id && await label.isVisible().catch(() => false)) {
          return { control, target: label, label: true };
        }
      }
      const wrappingLabel = control.locator("xpath=ancestor::label[1]");
      if (await wrappingLabel.count() && await wrappingLabel.isVisible().catch(() => false)) {
        return { control, target: wrappingLabel, label: true };
      }
    }
    return undefined;
  }

  async requestSelectedCards() {
    const popupPromise = this.page.waitForEvent("popup", { timeout: 5000 }).catch(() => undefined);
    await this.printSelectedButton().click();
    const popup = await popupPromise;
    const resultPage = popup ?? this.page;
    await resultPage.waitForLoadState("domcontentloaded").catch(() => undefined);
    return resultPage;
  }

  async waitForCardPreview(input: BeneficiarySearchInput) {
    return (await waitForRenderedCards(this.page, [input], this.previewTimeoutMs, this.portalUrl))[0];
  }

  async waitForCardPreviews(inputs: BeneficiarySearchInput[]) {
    return waitForRenderedCards(this.page, inputs, this.previewTimeoutMs, this.portalUrl);
  }

  private async findSingleBeneficiaryRow(input: BeneficiarySearchInput) {
    const expectedName = normalizeText(input.beneficiaryName);
    const candidateRows = await this.collectCandidateRows(input.beneficiaryName);

    if (candidateRows.length === 0) {
      throw new AutomationError("BENEFICIARY_NOT_FOUND", "Beneficiario nao encontrado.", {
        safeDetails: "Nenhuma linha do portal corresponde ao nome informado.",
        step: "find_beneficiary",
        retryable: false,
      });
    }

    const exactNameRows: Locator[] = [];
    for (const row of candidateRows) {
      const text = normalizeText((await row.innerText().catch(() => "")) ?? "");
      if (text.includes(expectedName)) exactNameRows.push(row);
    }

    const selectableRows: Locator[] = [];
    for (const row of exactNameRows) if (await this.findSelectionControl(row)) selectableRows.push(row);
    let filteredRows = selectableRows.length ? selectableRows : exactNameRows;
    const cpf = onlyDigits(input.cpf);
    if (filteredRows.length > 1 && cpf) {
      const byCpf: Locator[] = [];
      for (const row of filteredRows) {
        const rowDigits = onlyDigits(await row.innerText().catch(() => ""));
        if (rowDigits.includes(cpf)) byCpf.push(row);
      }
      filteredRows = byCpf;
    }

    const birthDate = input.birthDate?.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1");
    if (filteredRows.length > 1 && birthDate) {
      const byBirthDate: Locator[] = [];
      for (const row of filteredRows) {
        if (onlyDigits(await row.innerText().catch(() => "")).includes(onlyDigits(birthDate))) byBirthDate.push(row);
      }
      filteredRows = byBirthDate;
    }

    if (filteredRows.length === 0) {
      throw new AutomationError("BENEFICIARY_NOT_FOUND", "Beneficiario nao encontrado.", {
        safeDetails: "As linhas retornadas nao conferem com os dados informados.",
        step: "find_beneficiary",
        retryable: false,
      });
    }

    if (filteredRows.length > 1) {
      throw new AutomationError("BENEFICIARY_AMBIGUOUS", "Mais de um beneficiario encontrado.", {
        safeDetails: "Informe CPF, codigo ou outro identificador antes de emitir a carteirinha.",
        step: "find_beneficiary",
        retryable: false,
      });
    }

    return filteredRows[0]!;
  }

  private async collectCandidateRows(beneficiaryName: string) {
    const candidates = this.page.locator(ROW_SELECTOR);
    const count = await candidates.count();
    const expected = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(normalizeText(beneficiaryName))}(?:$|[^a-z0-9])`);
    const rows: Locator[] = [];

    for (let index = 0; index < count; index += 1) {
      const row = candidates.nth(index);
      if (!(await row.isVisible().catch(() => false)) || await row.locator(ROW_SELECTOR).count()) continue;
      if (expected.test(normalizeText(await row.innerText().catch(() => "")))) rows.push(row);
    }

    return rows;
  }
}

