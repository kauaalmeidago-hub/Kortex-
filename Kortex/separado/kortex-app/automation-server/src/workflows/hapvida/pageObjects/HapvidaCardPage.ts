import type { Locator, Page } from "playwright";
import { AutomationError } from "../../../errors.js";

export interface BeneficiarySearchInput {
  beneficiaryName: string;
  cpf?: string;
  birthDate?: string;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

async function firstVisible(locators: Locator[]) {
  const fallback = locators[0];
  if (!fallback) throw new Error("At least one locator is required.");

  for (const locator of locators) {
    if (await locator.first().isVisible().catch(() => false)) {
      return locator.first();
    }
  }

  return fallback.first();
}

export class HapvidaCardPage {
  constructor(private readonly page: Page) {}

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
      .or(this.page.locator('input[value*="imprimir" i]'));
  }

  cardPreviewTitle() {
    return this.page.getByText(/carteira\s+provis[oó]ria/i).first();
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
  }

  async selectBeneficiary(input: BeneficiarySearchInput) {
    const row = await this.findSingleBeneficiaryRow(input);
    const checkbox = row.getByRole("checkbox").first();

    if (!(await checkbox.isVisible().catch(() => false))) {
      throw new AutomationError("PORTAL_CHANGED", "Nao encontrei o seletor do beneficiario no portal.", {
        safeDetails: "A linha do beneficiario apareceu, mas nao havia checkbox visivel para selecao.",
        step: "select_beneficiary",
        retryable: false,
      });
    }

    await checkbox.check().catch(async () => checkbox.click());
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
    await this.cardPreviewTitle().waitFor({ state: "visible" });
    const pageText = normalizeText((await this.page.locator("body").innerText().catch(() => "")) ?? "");
    const expectedName = normalizeText(input.beneficiaryName);

    if (!pageText.includes(expectedName)) {
      throw new AutomationError("CARD_VALIDATION_FAILED", "A carteirinha gerada nao corresponde ao beneficiario solicitado.", {
        safeDetails: "O nome do beneficiario nao foi encontrado na pre-visualizacao da carteirinha.",
        step: "validate_card_preview",
        retryable: false,
      });
    }
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

    let filteredRows = exactNameRows;
    const cpf = onlyDigits(input.cpf);
    if (filteredRows.length > 1 && cpf) {
      const byCpf: Locator[] = [];
      for (const row of filteredRows) {
        const rowDigits = onlyDigits(await row.innerText().catch(() => ""));
        if (rowDigits.includes(cpf)) byCpf.push(row);
      }
      filteredRows = byCpf;
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
    const byRole = this.page.getByRole("row").filter({ hasText: new RegExp(escapeRegExp(beneficiaryName), "i") });
    const byTable = this.page.locator("tr").filter({ hasText: new RegExp(escapeRegExp(beneficiaryName), "i") });
    const preferred = await firstVisible([byRole, byTable]);
    const count = await preferred.count();
    const rows: Locator[] = [];

    for (let index = 0; index < count; index += 1) {
      rows.push(preferred.nth(index));
    }

    return rows;
  }
}
