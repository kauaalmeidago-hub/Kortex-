import type { Locator, Page } from "playwright";
import { AutomationError } from "../../../errors.js";
import type { PortalCredential } from "../../../types.js";

async function firstVisibleEditable(locator: Locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (
      (await candidate.isVisible().catch(() => false)) &&
      (await candidate.isEnabled().catch(() => false)) &&
      (await candidate.evaluate((element) => {
        const input = element as { readOnly?: boolean; offsetParent?: unknown };
        return !input.readOnly && input.offsetParent !== null;
      }).catch(() => false))
    ) {
      return candidate;
    }
  }

  return undefined;
}

export class HapvidaMovementAccessPage {
  constructor(
    private readonly page: Page,
    private readonly portalUrl?: string,
  ) {}

  async open() {
    if (!this.portalUrl) {
      throw new AutomationError("PORTAL_URL_NOT_CONFIGURED", "URL do portal de movimentacao Hapvida nao configurada.", {
        safeDetails: "Configure HAPVIDA_MOVEMENT_PORTAL_URL antes de executar exclusoes.",
        step: "open_movement_portal",
        retryable: false,
      });
    }

    await this.page.goto(this.portalUrl, { waitUntil: "domcontentloaded" });
  }

  codeField() {
    return this.page.locator("input[name='pCodigoEmpresa']:visible, input[name='pNm_Login']:visible");
  }

  passwordField() {
    return this.page.locator("input#pSenha:visible, input[name='pSenha']:visible");
  }

  unitSelectField() {
    return this.page.locator("#pUnidade:visible, select[name='pUnidade']:visible");
  }

  unitPasswordField() {
    return this.page.locator("input[name='pSenhaUnidade']:visible");
  }

  proceedButton() {
    return this.page.locator("#Prosseguir:visible, input[value*='PROSSEGUIR' i]:visible, input[value*='ENTRAR' i]:visible, input[value='OK']:visible");
  }

  authenticatedMenuIndicator() {
    return this.page.getByText(/acesso\s+r[aá]pido|menu\s+principal|sistema[s]?\s+de\s+movimenta[cç][aã]o/i).first();
  }

  periodPageIndicator() {
    return this.page.getByText(/datas?\s+de\s+ades[aã]o/i).first();
  }

  async detectState() {
    if (await this.periodPageIndicator().isVisible().catch(() => false)) return "card_period" as const;
    if (await this.authenticatedMenuIndicator().isVisible().catch(() => false)) return "authenticated_menu" as const;
    if (await firstVisibleEditable(this.codeField())) return "login" as const;
    return "unexpected" as const;
  }

  private async triggerCompanyLookup(codeField: Locator) {
    await codeField.evaluate((element) => {
      const target = element as { dispatchEvent: (event: Event) => boolean };
      target.dispatchEvent(new Event("blur", { bubbles: true }));
    });

    await this.page
      .locator("#pBlocoSenha:visible, #pBloco:visible, input#pSenha:visible, input[name='pSenhaUnidade']:visible")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => undefined);
  }

  async login(credential: PortalCredential) {
    const state = await this.detectState();
    if (state === "authenticated_menu" || state === "card_period") return;
    if (state !== "login") {
      throw new AutomationError("PORTAL_STATE_UNEXPECTED", "Estado inesperado na selecao de acesso Hapvida.", {
        safeDetails: "Nao encontrei menu autenticado, tela de Datas de adesao ou formulario de login visivel.",
        step: "select_company_access",
        retryable: false,
      });
    }

    const codeField = await firstVisibleEditable(this.codeField());
    if (!codeField) {
      throw new AutomationError("COMPANY_ACCESS_NOT_FOUND", "Campo de acesso da empresa nao encontrado.", {
        safeDetails: "Nao encontrei campo visivel/editavel para codigo ou usuario da empresa.",
        step: "select_company_access",
        retryable: false,
      });
    }

    const proceedButton = this.proceedButton().first();
    if (!(await proceedButton.isVisible().catch(() => false))) {
      throw new AutomationError("COMPANY_ACCESS_SELECTION_FAILED", "Botao de prosseguir do acesso nao encontrado.", {
        safeDetails: "Nao encontrei botao Prosseguir/OK visivel no formulario ativo.",
        step: "select_company_access",
        retryable: false,
      });
    }

    await codeField.fill(credential.username);
    await this.triggerCompanyLookup(codeField);

    if (await this.periodPageIndicator().isVisible().catch(() => false)) return;
    if (await this.authenticatedMenuIndicator().isVisible().catch(() => false)) return;

    if (
      (await this.unitSelectField().isVisible().catch(() => false)) ||
      (await this.unitPasswordField().isVisible().catch(() => false))
    ) {
      throw new AutomationError("COMPANY_ACCESS_SELECTION_FAILED", "Acesso Hapvida exige selecao de unidade.", {
        safeDetails: "O portal exibiu o fluxo de Unidade/Senha Unidade. Esse caminho precisa de mapeamento seguro por empresa antes de prosseguir.",
        step: "select_company_access",
        retryable: false,
      });
    }

    const passwordField = await firstVisibleEditable(this.passwordField());
    if (!passwordField) {
      throw new AutomationError("COMPANY_ACCESS_PASSWORD_FIELD_NOT_VISIBLE", "Campo de senha da empresa nao esta visivel.", {
        safeDetails: "Depois de validar o codigo da empresa, nenhum campo pSenha visivel/editavel apareceu no formulario ativo.",
        step: "select_company_access",
        retryable: false,
      });
    }

    await passwordField.fill(credential.password);
    await proceedButton.click();
    await this.authenticatedMenuIndicator()
      .or(this.periodPageIndicator())
      .waitFor({ state: "visible" })
      .catch(() => {
        throw new AutomationError("COMPANY_ACCESS_SELECTION_FAILED", "Nao consegui confirmar o acesso da empresa.", {
          safeDetails: "Depois de clicar em Prosseguir, o portal nao exibiu Menu Principal/Acesso Rapido nem Datas de adesao.",
          step: "select_company_access",
          retryable: false,
        });
      });
  }
}
