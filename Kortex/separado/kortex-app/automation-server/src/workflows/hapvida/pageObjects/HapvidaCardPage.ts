import type { Locator, Page } from "playwright";
import { AutomationError } from "../../../errors.js";
import { waitForRenderedCards, type CardBeneficiary } from "../cardPreview.js";
import { inspectCardListRows, inspectCardSelectionControls } from "../cardList.js";
import { findCardDependents } from "../cardDependents.js";
import { describeCardDeliveryMembers } from "../cardDeliveryLayout.js";

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
      .getByRole("button", { name: /imprimir\s+(?:(?:os|as)\s+)?selecionad[oa]s/i })
      .or(this.page.getByRole("link", { name: /imprimir\s+(?:(?:os|as)\s+)?selecionad[oa]s/i }))
      .or(this.page.locator('input[value*="imprimir selecionados" i], input[value*="imprimir selecionadas" i]'));
  }

  printAllButton() {
    return this.page.getByRole("button", { name: /imprimir\s+(?:todos|todas|tudo)/i })
      .or(this.page.getByRole("link", { name: /imprimir\s+(?:todos|todas|tudo)/i }))
      .or(this.page.locator('input[value*="imprimir todos" i], input[value*="imprimir todas" i], input[value*="imprimir tudo" i]'));
  }

  private async visibleEnabledButton(buttons: Locator) {
    for (const button of await buttons.all()) {
      if (await button.isVisible() && await button.isEnabled() && await button.getAttribute("aria-disabled") !== "true") return button;
    }
    return undefined;
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

  async selectBeneficiary(input: BeneficiarySearchInput, automaticDependents: BeneficiarySearchInput[] = []) {
    const row = await this.findSingleBeneficiaryRow(input);
    const identity = await this.readRowIdentity(row);
    if (input.cpf && identity.cpf && onlyDigits(input.cpf) !== identity.cpf) {
      throw new AutomationError("BENEFICIARY_NOT_FOUND", "O CPF da linha nao corresponde ao pedido.", { step: "find_beneficiary" });
    }
    const selection = await this.findSelectionControl(row);
    if (!selection) {
      const snapshot = await this.page.locator(ROW_SELECTOR).evaluateAll(inspectCardListRows);
      const index = await row.evaluate(element => Array.from((globalThis as unknown as { document: any }).document.querySelectorAll('tr, [role="row"]')).indexOf(element));
      const holders = snapshot.filter(candidate => candidate.index !== index && candidate.visible && candidate.selectable &&
        findCardDependents(snapshot, candidate.index).some(dependent => dependent.index === index));
      if (holders.length === 1) {
        const holder = holders[0]!;
        const dependents = findCardDependents(snapshot, holder.index);
        await this.selectBeneficiary(holder, dependents);
        return { ...input, cpf: input.cpf ?? identity.cpf, cardIdentifiers: identity.cardIdentifiers, requireIdentifier: identity.requireIdentifier };
      }
      const controls = await row.locator(CONTROL_SELECTOR).count();
      throw new AutomationError("PORTAL_CHANGED", "Nao encontrei o seletor do beneficiario no portal.", {
        safeDetails: `A linha do beneficiario apareceu, mas nao havia um controle habilitado ou um rotulo visivel associado. Controles encontrados: ${controls}.`,
        step: "select_beneficiary",
        retryable: true,
      });
    }

    // Keep linked family controls when the portal forces a joint print; the PDF capture isolates the requested card.
    const permitted = [selection.control];
    for (const dependent of automaticDependents) {
      const linkedRow = await this.findSingleBeneficiaryRow(dependent);
      permitted.push(...await linkedRow.locator(CONTROL_SELECTOR).all());
    }
    await this.clearSelections(permitted);

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
    await this.clearSelections(permitted, true);
    await this.assertSelectedControls([selection.control], permitted);
    return { ...input, cpf: input.cpf ?? identity.cpf, cardIdentifiers: identity.cardIdentifiers, requireIdentifier: identity.requireIdentifier };
  }

  async inspectBeneficiaryFamily(input: BeneficiarySearchInput) {
    const row = await this.findSingleBeneficiaryRow(input);
    const identity = await this.readRowIdentity(row);
    if (input.cpf && identity.cpf && onlyDigits(input.cpf) !== identity.cpf) {
      throw new AutomationError("BENEFICIARY_NOT_FOUND", "O CPF da linha nao corresponde ao pedido.", { step: "find_beneficiary" });
    }
    const index = await row.evaluate(element => Array.from((globalThis as unknown as { document: any }).document.querySelectorAll('tr, [role="row"]')).indexOf(element));
    const snapshot = await this.page.locator(ROW_SELECTOR).evaluateAll(inspectCardListRows);
    const beneficiary = { ...input, beneficiaryName: identity.beneficiaryName || input.beneficiaryName,
      cpf: input.cpf ?? identity.cpf, cardIdentifiers: identity.cardIdentifiers, requireIdentifier: identity.requireIdentifier };
    const dependents = findCardDependents(snapshot, index).map(({ beneficiaryName, cpf, cardIdentifiers, requireIdentifier }) =>
      ({ beneficiaryName, cpf, cardIdentifiers, requireIdentifier }));
    const holders = snapshot.filter(candidate => candidate.index !== index && candidate.visible &&
      findCardDependents(snapshot, candidate.index).some(dependent => dependent.index === index));
    const automaticCompanions = holders.length === 1
      ? [holders[0]!, ...findCardDependents(snapshot, holders[0]!.index)].filter(member => member.index !== index)
        .map(({ beneficiaryName, cpf, cardIdentifiers, requireIdentifier }) => ({ beneficiaryName, cpf, cardIdentifiers, requireIdentifier }))
      : dependents;
    const otherBeneficiaries = snapshot.filter(row => row.visible && row.kind === "beneficiary" && row.index !== index)
      .map(({ beneficiaryName, cpf, cardIdentifiers, requireIdentifier }) => ({ beneficiaryName, cpf, cardIdentifiers, requireIdentifier }));
    return { beneficiary, dependents, otherBeneficiaries, automaticCompanions };
  }

  async selectBeneficiaries(inputs: BeneficiarySearchInput[], automaticFamily = false) {
    if (automaticFamily) {
      const primary = inputs[0];
      if (!primary) return [];
      await this.selectBeneficiary(primary, inputs.slice(1));
      for (const input of inputs.slice(1)) {
        const row = await this.findSingleBeneficiaryRow(input);
        const controls = row.locator(CONTROL_SELECTOR);
        if (!await controls.count()) continue; // Some portals print dependents only through the holder's selection.
        if ((await Promise.all((await controls.all()).map(control => this.isSelected(control)))).some(Boolean)) continue;
        const selection = await this.findSelectionControl(row);
        if (!selection) throw new AutomationError("BENEFICIARY_SELECTION_FAILED", "Um beneficiario autorizado nao possui selecao disponivel.", { step: "confirm_beneficiary_selection" });
        if (/^(checkbox|radio)$/i.test(await selection.control.getAttribute("type") ?? "") && !selection.label) await selection.control.check();
        else await selection.target.click();
      }
      const permitted: Locator[] = [];
      for (const input of inputs) permitted.push(...await (await this.findSingleBeneficiaryRow(input)).locator(CONTROL_SELECTOR).all());
      await this.assertSelectedControls([], permitted);
      return inputs;
    }
    const selections = [];
    for (const input of inputs) {
      const row = await this.findSingleBeneficiaryRow(input);
      const selection = await this.findSelectionControl(row);
      if (!selection) throw new AutomationError("BENEFICIARY_SELECTION_FAILED", "Um beneficiario autorizado nao possui selecao disponivel.", { step: "confirm_beneficiary_selection" });
      selections.push(selection);
    }
    await this.clearSelections();
    try {
      for (const selection of selections) {
        if (await this.isSelected(selection.control)) continue;
        if (/^(checkbox|radio)$/i.test(await selection.control.getAttribute("type") ?? "") && !selection.label) await selection.control.check();
        else await selection.target.click();
      }
      await this.clearSelections(selections.map(selection => selection.control), true);
      await this.assertSelectedControls(selections.map(selection => selection.control));
    } catch {
      throw new AutomationError("BENEFICIARY_SELECTION_FAILED", "O portal nao confirmou todos os beneficiarios autorizados.", { step: "confirm_beneficiary_selection", retryable: true });
    }
    return inputs;
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
    const snapshot = await rows.evaluateAll(inspectCardListRows);
    const selections: Array<{ control: Locator; target: Locator; label: boolean; input: BeneficiarySearchInput }> = [];
    for (const identity of snapshot) {
      if (!identity.visible || !identity.selectable || identity.kind === "header" || identity.kind === "bulk") continue;
      const row = rows.nth(identity.index);
      const selection = await this.findSelectionControl(row);
      if (!selection) continue;
      if (!identity.beneficiaryName) {
        const states = await row.locator(CONTROL_SELECTOR).evaluateAll(inspectCardSelectionControls);
        if (states.every(state => state.bulk)) continue;
        throw new AutomationError("CARD_BATCH_INCOMPLETE", "Nao foi possivel identificar todos os beneficiarios da lista.", {
          safeDetails: "Uma linha selecionavel nao apresentou um nome identificavel. Nenhuma carteirinha foi impressa.", step: "select_beneficiary",
        });
      }
      const { beneficiaryName, cpf, cardIdentifiers, requireIdentifier } = identity;
      selections.push({ ...selection, input: { beneficiaryName, cpf, cardIdentifiers, requireIdentifier } });
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
    const forcedDependents = snapshot.filter(row => row.visible && row.kind === "beneficiary" && !row.selectable &&
      selections.some(selection => {
        const primary = snapshot.find(candidate => normalizeText(candidate.beneficiaryName) === normalizeText(selection.input.beneficiaryName) &&
          (!selection.input.cardIdentifiers?.length || [...(candidate.cardIdentifiers ?? []), ...(candidate.cpf ? [candidate.cpf] : [])].some(id => selection.input.cardIdentifiers?.includes(id))));
        return primary && findCardDependents(snapshot, primary.index).some(dependent => dependent.index === row.index);
      }));
    const permitted = selections.map(selection => selection.control);
    for (const dependent of forcedDependents) permitted.push(...await rows.nth(dependent.index).locator(CONTROL_SELECTOR).all());
    await this.clearSelections(permitted);
    try {
      const controls = this.page.locator(CONTROL_SELECTOR);
      const bulkControls = (await controls.evaluateAll(inspectCardSelectionControls)).filter(state => state.bulk && state.enabled);
      for (const state of bulkControls) {
        const selection = await this.findSelectionControl(this.page.locator("body"), controls.nth(state.index));
        if (!selection) continue;
        if (!await this.isSelected(selection.control)) {
          if (state.native && !selection.label) await selection.control.check();
          else await selection.target.click();
        }
        break;
      }
      for (const selection of selections) {
        if (await this.isSelected(selection.control)) continue;
        const native = /^(checkbox|radio)$/i.test(await selection.control.getAttribute("type") ?? "");
        if (native && !selection.label) await selection.control.check();
        else await selection.target.click();
      }
      await this.assertSelectedControls(selections.map(selection => selection.control), permitted);
    } catch {
      throw new AutomationError("BENEFICIARY_SELECTION_FAILED", "O portal nao confirmou a selecao completa do lote.", {
        safeDetails: "Nenhum PDF foi gerado porque uma ou mais selecoes nao permaneceram marcadas.", step: "confirm_beneficiary_selection", retryable: true,
      });
    }
    return [...selections.map(selection => selection.input), ...forcedDependents.map(({ beneficiaryName, cpf, cardIdentifiers, requireIdentifier }) =>
      ({ beneficiaryName, cpf, cardIdentifiers, requireIdentifier }))];
  }

  private async isSelected(control: Locator) {
    return /^(checkbox|radio)$/i.test(await control.getAttribute("type") ?? "")
      ? control.isChecked() : await control.getAttribute("aria-checked") === "true";
  }

  private async clearSelections(except?: Locator | Locator[], skipBulk = false) {
    const controls = this.page.locator(`${ROW_SELECTOR.split(", ").map(row => `${row} ${CONTROL_SELECTOR.split(", ").join(`, ${row} `)}`).join(", ")}`);
    const exceptHandles = await Promise.all((Array.isArray(except) ? except : except ? [except] : []).map(control => control.elementHandle()));
    try {
      const selected = (await controls.evaluateAll(inspectCardSelectionControls)).filter(state => state.selected && state.enabled);
      for (const state of selected) {
        if (skipBulk && state.bulk) continue;
        const control = controls.nth(state.index);
        if (!await this.isSelected(control)) continue;
        if (exceptHandles.length && await control.evaluate((element, targets) => targets.includes(element), exceptHandles)) continue;
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
    } finally { await Promise.all(exceptHandles.map(handle => handle?.dispose())); }
  }

  private async assertSelectedControls(expected: Locator[], permitted: Locator[] = expected) {
    const handles = await Promise.all(permitted.map(control => control.elementHandle()));
    try {
      const states = await this.page.locator(CONTROL_SELECTOR).evaluateAll(inspectCardSelectionControls, handles);
      if ((await Promise.all(expected.map(control => this.isSelected(control)))).some(selected => !selected)) {
        throw new AutomationError("BENEFICIARY_SELECTION_FAILED", "A selecao nao foi confirmada.", { step: "confirm_beneficiary_selection" });
      }
      if (states.some(state => state.inRow && state.selected && !state.bulk && !state.expected)) {
        throw new AutomationError("BENEFICIARY_SELECTION_FAILED", "O portal manteve uma selecao diferente da solicitada.", { step: "confirm_beneficiary_selection" });
      }
    } finally { await Promise.all(handles.map(handle => handle?.dispose())); }
  }

  private async readRowIdentity(row: Locator): Promise<BeneficiarySearchInput> {
    const identity = (await row.evaluate(inspectCardListRows))[0]!;
    const { beneficiaryName, cpf, cardIdentifiers, requireIdentifier } = identity;
    return { beneficiaryName, cpf, cardIdentifiers, requireIdentifier };
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
        visible(element) && /imprimir\s+(?:(?:os|as)\s+)?(?:selecionad[oa]s|todos|todas|tudo)/i.test(element.innerText || (element as unknown as { value?: string }).value || ""));
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

  async describeSelectedBeneficiaries(selected: BeneficiarySearchInput[]) {
    return describeCardDeliveryMembers(await this.page.locator(ROW_SELECTOR).evaluateAll(inspectCardListRows), selected);
  }

  async requestSelectedCards(beneficiaries: BeneficiarySearchInput[], allBeneficiaries = false,
    onPrinted?: (command: "all" | "selected") => Promise<void>) {
    const allButton = allBeneficiaries ? await this.visibleEnabledButton(this.printAllButton()) : undefined;
    const button = allButton ?? await this.visibleEnabledButton(this.printSelectedButton());
    if (!button) throw new AutomationError("PORTAL_CHANGED", "Nao encontrei o comando de impressao correspondente ao pedido.", {
      step: "print_selected_cards", retryable: true,
    });
    const cancelled = new AbortController();
    let onPopup!: (popup: Page) => void;
    const popup = new Promise<Page>(resolve => { onPopup = resolve; this.page.on("popup", onPopup); });
    try {
      await button.click();
      await onPrinted?.(allButton ? "all" : "selected");
      const inCurrentPage = waitForRenderedCards(this.page, beneficiaries, this.previewTimeoutMs, this.portalUrl, cancelled.signal)
        .then(() => this.page);
      const resultPage = await Promise.race([popup, inCurrentPage]);
      await resultPage.waitForLoadState("domcontentloaded", { timeout: this.previewTimeoutMs });
      return resultPage;
    } finally { cancelled.abort(); this.page.off("popup", onPopup); }
  }

  async waitForCardPreview(input: BeneficiarySearchInput, excluded: BeneficiarySearchInput[] = []) {
    return (await waitForRenderedCards(this.page, [input], this.previewTimeoutMs, this.portalUrl, undefined, excluded))[0];
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
    if (filteredRows.length > 1 && input.cardIdentifiers?.length) {
      const identified: Locator[] = [];
      for (const row of filteredRows) {
        const identity = await this.readRowIdentity(row);
        if (identity.cardIdentifiers?.some(id => input.cardIdentifiers!.includes(id))) identified.push(row);
      }
      filteredRows = identified;
    }
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
    const name = normalizeText(beneficiaryName);
    const expected = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(name)}(?:$|[^a-z0-9])`);
    const snapshot = await candidates.evaluateAll(inspectCardListRows);
    return snapshot.filter(row => row.visible && (row.beneficiaryName
      ? normalizeText(row.beneficiaryName) === name : expected.test(row.text ?? ""))).map(row => candidates.nth(row.index));
  }
}

