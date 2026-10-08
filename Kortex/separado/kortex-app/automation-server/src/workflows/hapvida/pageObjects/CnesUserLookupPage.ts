import type { Page } from "playwright";
import { AutomationError } from "../../../errors.js";
import { type CnsLookupResult } from "../inclusionUtils.js";

export class CnesUserLookupPage {
  constructor(
    private readonly page: Page,
    private readonly lookupUrl?: string,
  ) {}

  async open() {
    if (!this.lookupUrl) {
      throw new AutomationError("PORTAL_URL_NOT_CONFIGURED", "URL de consulta CNS nao configurada.", {
        safeDetails: "Configure CNS_LOOKUP_URL para consultar o CNS automaticamente.",
        step: "checking_cns",
        retryable: false,
      });
    }

    await this.page.goto(this.lookupUrl, { waitUntil: "domcontentloaded" });
  }

  cpfField() {
    return this.page
      .getByLabel(/^cpf$/i)
      .or(this.page.getByPlaceholder(/cpf/i))
      .or(this.page.locator("input[name*='cpf' i], input[id*='cpf' i]").first());
  }

  birthDateField() {
    return this.page
      .getByLabel(/nascimento|data\s+de\s+nascimento/i)
      .or(this.page.getByPlaceholder(/nascimento|dd\/mm\/aaaa/i))
      .or(this.page.locator("input[name*='nasc' i], input[id*='nasc' i]").first());
  }

  submitButton() {
    return this.page
      .getByRole("button", { name: /consultar|pesquisar|buscar|prosseguir|avancar|avançar/i })
      .or(this.page.locator("input[type='submit'], input[type='button']").filter({ hasText: /consultar|pesquisar|buscar|prosseguir/i }))
      .or(this.page.locator("input[value*='consultar' i], input[value*='pesquisar' i], input[value*='buscar' i]").first());
  }

  async fillLookup(cpf: string, birthDate: string) {
    await this.cpfField().fill(cpf.replace(/\D/g, ""));
    await this.birthDateField().fill(birthDate);
  }

  async submitLookup() {
    if (await this.hasCaptcha()) {
      throw new AutomationError("CNS_CAPTCHA_REQUIRED", "Consulta CNS exige validacao humana.", {
        safeDetails: "O site apresentou CAPTCHA. O Koa nao tenta resolver CAPTCHA automaticamente.",
        step: "checking_cns",
        retryable: false,
      });
    }

    await this.submitButton().click();
  }

  async hasCaptcha() {
    return this.page
      .locator("iframe[src*='captcha' i], iframe[src*='hcaptcha' i], iframe[src*='recaptcha' i], .h-captcha, .g-recaptcha")
      .first()
      .isVisible()
      .catch(() => false);
  }

  async readResult(): Promise<CnsLookupResult> {
    const body = ((await this.page.locator("body").innerText().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
    return {
      cnsNumber: readLabel(body, /cns|cart[aã]o\s+nacional\s+de\s+sa[uú]de/i) ?? readCnsNumber(body),
      returnedName: readLabel(body, /nome/i),
      returnedCpf: readLabel(body, /^cpf$/i) ?? readCpf(body),
      returnedBirthDate: readLabel(body, /nascimento|data\s+de\s+nascimento/i) ?? readDate(body),
    };
  }
}

function readLabel(text: string, label: RegExp) {
  const match = new RegExp(`${label.source}\\s*:?\\s*([^|;\\n]+?)(?=\\s{2,}|\\s+[A-Za-zÀ-ÿ ]+\\s*:|$)`, "i").exec(text);
  return match?.[1]?.trim();
}

function readCpf(text: string) {
  return /(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/.exec(text)?.[1];
}

function readDate(text: string) {
  return /(\d{2}\/\d{2}\/\d{4})/.exec(text)?.[1];
}

function readCnsNumber(text: string) {
  return /\b(\d{15})\b/.exec(text)?.[1];
}
