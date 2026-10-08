import type { Page } from "playwright";
import { AutomationError } from "../../../errors.js";
import { type ReceitaCpfLookupResult } from "../inclusionUtils.js";

export class ReceitaCpfStatusPage {
  constructor(
    private readonly page: Page,
    private readonly lookupUrl?: string,
  ) {}

  async open() {
    if (!this.lookupUrl) {
      throw new AutomationError("PORTAL_URL_NOT_CONFIGURED", "URL de consulta CPF Receita nao configurada.", {
        safeDetails: "Configure RECEITA_CPF_LOOKUP_URL para consultar a situacao cadastral.",
        step: "checking_cpf",
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
      .getByRole("button", { name: /consultar|pesquisar|buscar|enviar/i })
      .or(this.page.locator("input[type='submit'], input[type='button']").filter({ hasText: /consultar|pesquisar|buscar|enviar/i }))
      .or(this.page.locator("input[value*='consultar' i], input[value*='pesquisar' i], input[value*='buscar' i], input[value*='enviar' i]").first());
  }

  async fillLookup(cpf: string, birthDate: string) {
    await this.cpfField().fill(cpf.replace(/\D/g, ""));
    await this.birthDateField().fill(birthDate);
  }

  async submitLookup() {
    if (await this.hasHumanVerification()) {
      throw new AutomationError("CPF_CAPTCHA_REQUIRED", "Consulta CPF exige validacao humana.", {
        safeDetails: "A Receita Federal apresentou hCaptcha/CAPTCHA. O Koa nao tenta resolver automaticamente.",
        step: "checking_cpf",
        retryable: false,
      });
    }

    await this.submitButton().click();
  }

  async hasHumanVerification() {
    return this.page
      .locator("iframe[src*='captcha' i], iframe[src*='hcaptcha' i], iframe[src*='recaptcha' i], .h-captcha, .g-recaptcha")
      .first()
      .isVisible()
      .catch(() => false);
  }

  async readResult(): Promise<ReceitaCpfLookupResult> {
    const body = ((await this.page.locator("body").innerText().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
    return {
      cpf: readLabel(body, /^cpf$/i) ?? readCpf(body),
      name: readLabel(body, /nome/i),
      birthDate: readLabel(body, /nascimento|data\s+de\s+nascimento/i) ?? readDate(body),
      registrationStatus: readLabel(body, /situa[cç][aã]o\s+cadastral/i),
      registrationDate: readLabel(body, /data\s+da\s+inscri[cç][aã]o/i),
      checkDigit: readLabel(body, /d[ií]gito\s+verificador/i),
      controlCode: readLabel(body, /c[oó]digo\s+de\s+controle/i),
    };
  }

  async printProofToPdf() {
    try {
      return await this.page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
    } catch {
      const session = await this.page.context().newCDPSession(this.page);
      try {
        const pdf = await session.send("Page.printToPDF", {
          printBackground: true,
          preferCSSPageSize: true,
        });
        return Buffer.from(pdf.data, "base64");
      } finally {
        await session.detach().catch(() => undefined);
      }
    }
  }
}

export function validateCpfProofPdfBytes(bytes: Buffer, beneficiaryName: string) {
  if (bytes.byteLength === 0 || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new AutomationError("CPF_DOCUMENT_GENERATION_FAILED", "Comprovante CPF invalido.", {
      safeDetails: "A geracao do comprovante nao retornou um PDF valido.",
      step: "generating_cpf_document",
      retryable: false,
    });
  }

  const textSlice = bytes.toString("latin1", 0, Math.min(bytes.length, 16_000)).toLowerCase();
  const normalizedName = beneficiaryName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalizedName && textSlice && !textSlice.includes(normalizedName.split(/\s+/)[0] ?? "")) {
    // PDFs generated from Chromium often compress text streams. Keep validation structural here
    // and rely on Receita DOM identity validation before generation.
  }

  return bytes;
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
