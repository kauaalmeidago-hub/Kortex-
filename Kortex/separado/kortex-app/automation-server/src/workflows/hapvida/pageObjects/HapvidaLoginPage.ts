import type { Page } from "playwright";
import { AutomationError } from "../../../errors.js";
import type { PortalCredential } from "../../../types.js";

export class HapvidaLoginPage {
  constructor(
    private readonly page: Page,
    private readonly portalUrl?: string,
  ) {}

  async open() {
    if (!this.portalUrl) {
      throw new AutomationError("PORTAL_URL_NOT_CONFIGURED", "URL do portal Hapvida nao configurada.", {
        safeDetails: "Configure HAPVIDA_CARD_PORTAL_URL para validar o fluxo em modo debug.",
        retryable: false,
      });
    }

    await this.page.goto(this.portalUrl, { waitUntil: "domcontentloaded" });
  }

  companyField() {
    return this.page
      .getByLabel(/empresa|c[oó]digo|login|usu[aá]rio|usuario|email/i)
      .or(this.page.getByPlaceholder(/empresa|c[oó]digo|login|usu[aá]rio|usuario|email/i))
      .or(this.page.getByRole("textbox").first());
  }

  passwordField() {
    return this.page
      .getByLabel(/senha/i)
      .or(this.page.getByPlaceholder(/senha/i))
      .or(this.page.locator('input[type="password"]').first());
  }

  submitButton() {
    return this.page
      .getByRole("button", { name: /entrar|acessar|login|ok/i })
      .or(this.page.locator('input[type="submit"][value="OK"], input[type="button"][value="OK"], input[value*="entrar" i], input[value*="acessar" i]').first());
  }

  async login(credential: PortalCredential) {
    await this.companyField().fill(credential.username);
    await this.passwordField().fill(credential.password);
    await this.submitButton().click();
  }
}
