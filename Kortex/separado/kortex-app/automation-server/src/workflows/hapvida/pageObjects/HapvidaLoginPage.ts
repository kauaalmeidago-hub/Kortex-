import type { Page, Request } from "playwright";
import { AutomationError } from "../../../errors.js";
import type { PortalCredential } from "../../../types.js";

export class HapvidaLoginPage {
  constructor(
    private readonly page: Page,
    private readonly portalUrl?: string,
    private readonly authTimeoutMs = 20_000,
    private readonly portalLabel = "Hapvida",
  ) {}

  async open() {
    if (!this.portalUrl) {
      throw new AutomationError("PORTAL_URL_NOT_CONFIGURED", `URL do portal ${this.portalLabel} nao configurada.`, {
        safeDetails: `Configure ${this.portalLabel === "NDI" ? "NDI" : "HAPVIDA"}_CARD_PORTAL_URL para validar o fluxo em modo debug.`,
        retryable: false,
      });
    }

    await this.page.goto(this.portalUrl, { waitUntil: "domcontentloaded", timeout: this.authTimeoutMs }).catch(() => {
      throw this.portalUnavailable(`O portal ${this.portalLabel} nao abriu a tela de login dentro do tempo esperado.`);
    });
  }

  companyField() {
    return this.page
      .locator("#p_cd_empresa, input[name='p_cd_empresa']")
      .or(this.page.getByLabel(/empresa|c[oó]digo|login|usu[aá]rio|usuario|email/i))
      .or(this.page.getByPlaceholder(/empresa|c[oó]digo|login|usu[aá]rio|usuario|email/i))
      .or(this.page.getByRole("textbox").first());
  }

  passwordField() {
    return this.page
      .locator("#p_cd_senha, input[name='p_cd_senha']")
      .or(this.page.getByLabel(/senha/i))
      .or(this.page.getByPlaceholder(/senha/i))
      .or(this.page.locator('input[type="password"]').first());
  }

  submitButton() {
    return this.page
      .locator("#btn_entrar")
      .or(this.page.getByRole("button", { name: /entrar|acessar|login|ok/i }))
      .or(this.page.locator('input[type="submit"][value="OK"], input[type="button"][value="OK"], input[value*="entrar" i], input[value*="acessar" i]').first());
  }

  invalidIdentificationMessage() {
    return this.page.getByText(/identifica[cç][aã]o\s+inv[aá]lida/i);
  }

  passwordStillVisible() {
    return this.passwordField().first().isVisible().catch(() => false);
  }

  async waitForReady() {
    if (!(await this.page.locator("#pTokenCaptcha").count())) return;

    await this.page.waitForFunction(() => {
      const captcha = (globalThis as { grecaptcha?: { ready?: unknown; execute?: unknown } }).grecaptcha;
      return typeof captcha?.ready === "function" && typeof captcha?.execute === "function";
    }, undefined, { timeout: this.authTimeoutMs }).catch(() => {
      throw this.portalUnavailable("O reCAPTCHA do portal nao carregou. Verifique o acesso aos recursos de verificacao do portal.");
    });
  }

  async login(credential: PortalCredential) {
    try {
      await this.submitLogin(credential);
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw this.portalUnavailable(this.describeUnexpectedLoginFailure(error));
    }
  }

  private async submitLogin(credential: PortalCredential) {
    await this.waitForReady();
    await this.companyField().fill(credential.username);
    await this.passwordField().fill(credential.password);

    const form = this.page.locator("#cd_form_login_emp");
    if (!(await form.count())) {
      await this.submitButton().click();
      return;
    }

    const action = await form.getAttribute("action");
    if (!action) throw this.portalUnavailable("O formulario de login do portal nao informou o destino de envio.");
    const target = new URL(action, this.page.url());
    const isLoginRequest = (request: Request) => {
      const url = new URL(request.url());
      return request.method() === "POST" && request.isNavigationRequest() &&
        url.origin === target.origin && url.pathname === target.pathname;
    };

    // Arm both listeners before clicking. The portal obtains its own reCAPTCHA
    // token and submits the form asynchronously; a click alone proves nothing.
    const submitted = this.page.waitForRequest(isLoginRequest, { timeout: this.authTimeoutMs }).catch(() => undefined);
    const responded = this.page.waitForResponse((response) => isLoginRequest(response.request()), {
      timeout: this.authTimeoutMs,
    }).catch(() => undefined);
    await this.submitButton().click();

    if (!(await submitted)) {
      throw this.portalUnavailable("O portal nao enviou o formulario de login apos o clique. A verificacao do portal pode estar indisponivel; a senha nao foi rejeitada.");
    }
    const response = await responded;
    if (!response || response.status() >= 400) {
      throw this.portalUnavailable("O envio do login nao recebeu uma resposta valida do portal. A falha nao foi classificada como senha incorreta.");
    }
    await this.page.waitForLoadState("domcontentloaded", { timeout: this.authTimeoutMs }).catch(() => {
      throw this.portalUnavailable("O portal nao terminou de carregar a resposta do login.");
    });
  }

  private describeUnexpectedLoginFailure(error: unknown) {
    if (error instanceof Error && /closed|crash|detached|navigation|timeout/i.test(error.message)) {
      return `A pagina do portal ${this.portalLabel} ficou indisponivel durante a autenticacao. A tentativa pode ser refeita com o mesmo acesso.`;
    }
    return `O portal ${this.portalLabel} falhou durante a autenticacao. A tentativa pode ser refeita com o mesmo acesso.`;
  }

  private portalUnavailable(safeDetails: string) {
    return new AutomationError("PORTAL_AUTH_UNAVAILABLE", `Verificacao de acesso ao portal ${this.portalLabel} indisponivel.`, {
      safeDetails, step: "authenticate", retryable: true,
    });
  }
}

