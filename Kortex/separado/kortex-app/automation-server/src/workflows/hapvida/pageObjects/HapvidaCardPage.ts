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

const ROW_SELECTOR = 'tr, [role="row"]';
const CONTROL_SELECTOR = 'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]';

export class HapvidaCardPage {
  constructor(private readonly page: Page, private readonly previewTimeoutMs = 30_000) {}

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

  private async findSelectionControl(row: Locator) {
    const controls = row.locator(CONTROL_SELECTOR);
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
    const expectedName = normalizeText(input.beneficiaryName);
    if (!expectedName) {
      throw new AutomationError("MISSING_REQUIRED_DATA", "Nome do beneficiario nao informado.", {
        step: "validate_card_preview", retryable: false,
      });
    }

    try {
      const confirmed = await this.page.waitForFunction(({ expectedName }) => {
        // The portal can put "Carteira Provisoria" only in <title>, which is
        // metadata and never visible. Validate the rendered document instead.
        const scope = globalThis as unknown as {
          document: {
            title: string;
            body?: { innerText: string; getBoundingClientRect(): { width: number; height: number } };
            querySelector(selector: string): unknown;
          };
          getComputedStyle(element: unknown): { display: string; visibility: string };
        };
        const document = scope.document;
        const body = document.body;
        if (!body) return false;
        const bounds = body.getBoundingClientRect();
        const style = scope.getComputedStyle(body);
        if (!bounds.width || !bounds.height || style.display === "none" || style.visibility === "hidden") return false;
        const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ").trim().toLowerCase();
        const text = normalize(body.innerText);
        const cardDocument = /carteira\s+provisoria|carteirinha|cartao\s+(?:do\s+beneficiario|de\s+identificacao)/
          .test(`${normalize(document.title)} ${text}`);
        const operationForm = document.querySelector('input[type="checkbox"], input[type="password"], #p_cd_empresa, #p_cd_senha');
        const portalError = /identificacao\s+invalida|sessao\s+expirada|acesso\s+negado|nao\s+foi\s+possivel\s+(?:emitir|gerar)/.test(text);
        return cardDocument && !operationForm && !portalError && text.includes(expectedName);
      }, { expectedName }, { timeout: this.previewTimeoutMs });
      await confirmed.dispose();
    } catch {
      const text = normalizeText(await this.page.locator("body").innerText().catch(() => ""));
      if (text && !text.includes(expectedName)) {
        throw new AutomationError("CARD_VALIDATION_FAILED", "A carteirinha gerada nao corresponde ao beneficiario solicitado.", {
          safeDetails: "O nome do beneficiario nao foi encontrado no conteudo renderizado da carteirinha.",
          step: "validate_card_preview", retryable: false,
        });
      }
      throw new AutomationError("CARD_PREVIEW_NOT_FOUND", "Nao foi possivel confirmar a previa da carteirinha.", {
        safeDetails: "O documento nao ficou pronto com o nome solicitado. Titulos de aba, formularios de login e listas de selecao nao confirmam uma carteirinha.",
        step: "validate_card_preview", retryable: false,
      });
    }

    const pageText = normalizeText((await this.page.locator("body").innerText().catch(() => "")) ?? "");

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

