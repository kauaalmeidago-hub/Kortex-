import type { Page } from "playwright";
import { AutomationError } from "../../../errors.js";

export interface HolderRegistrationData {
  cpf: string;
  beneficiaryName: string;
  birthDate: string;
  gender?: string;
  maritalStatus?: string;
  identity?: string;
  issuingAgency?: string;
  issuingUf?: string;
  motherName?: string;
  pisPasep?: string;
  ctps?: string;
  ctpsSeries?: string;
  cnsNumber: string;
  admissionDate?: string;
  companyEnrollment?: string;
  sequentialEnrollment?: string;
  role?: string;
  liveBirthDeclaration?: string;
  mobilePhone?: string;
  email?: string;
  zipCode?: string;
  streetType?: string;
  address?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  residentialPhone?: string;
  referencePoint?: string;
}

export class HapvidaHolderRegistrationPage {
  constructor(private readonly page: Page) {}

  heading() {
    return this.page.getByText(/dados\s+cadastrais|nome\s+titular|informa[cç][oõ]es\s+do\s+titular/i).first();
  }

  async waitForLoaded() {
    await this.heading().waitFor({ state: "visible" });
  }

  async fillRegistration(data: HolderRegistrationData) {
    await this.fillIfVisible(/cpf/i, data.cpf.replace(/\D/g, ""));
    await this.fillIfVisible(/nome\s+titular|nome/i, data.beneficiaryName);
    await this.fillIfVisible(/nascimento/i, data.birthDate);
    await this.fillIfVisible(/identidade|rg/i, data.identity);
    await this.fillIfVisible(/[oó]rg[aã]o\s+emissor|emissor/i, data.issuingAgency);
    await this.selectIfVisible(/uf\s+[oó]rg[aã]o|uf/i, data.issuingUf);
    await this.selectIfVisible(/sexo/i, data.gender);
    await this.selectIfVisible(/estado\s+civil/i, data.maritalStatus);
    await this.fillIfVisible(/m[aã]e/i, data.motherName);
    await this.fillIfVisible(/pis|pasep/i, data.pisPasep);
    await this.fillIfVisible(/ctps(?!.*s[eé]rie)/i, data.ctps);
    await this.fillIfVisible(/s[eé]rie\s+ctps|serie\s+ctps/i, data.ctpsSeries);
    await this.fillIfVisible(/^cns$|cart[aã]o\s+nacional/i, data.cnsNumber);
    await this.fillIfVisible(/admiss[aã]o/i, data.admissionDate);
    await this.fillIfVisible(/matr[ií]cula\s+empresa/i, data.companyEnrollment);
    await this.fillIfVisible(/mat\.\s+sequencial|matr[ií]cula\s+sequencial/i, data.sequentialEnrollment);
    await this.fillIfVisible(/cargo/i, data.role);
    await this.fillIfVisible(/declara[cç][aã]o\s+de\s+nascido\s+vivo|dnv/i, data.liveBirthDeclaration);
    await this.fillIfVisible(/celular/i, data.mobilePhone);
    await this.fillIfVisible(/e-?mail|email/i, data.email);
  }

  async fillAddress(data: HolderRegistrationData) {
    await this.fillIfVisible(/cep/i, data.zipCode);
    await this.selectIfVisible(/logradouro/i, data.streetType);
    await this.fillIfVisible(/endere[cç]o/i, data.address);
    await this.fillIfVisible(/n[uú]mero|numero/i, data.number);
    await this.fillIfVisible(/complemento/i, data.complement);
    await this.fillIfVisible(/bairro/i, data.district);
    await this.fillIfVisible(/cidade/i, data.city);
    await this.selectIfVisible(/^uf$|estado/i, data.state);
    await this.fillIfVisible(/fone\s+residencial|telefone\s+residencial/i, data.residentialPhone);
    await this.fillIfVisible(/refer[eê]ncia/i, data.referencePoint);
  }

  async selectPlan(input: { unit?: string; plan?: string }) {
    if (!input.unit || !input.plan) {
      throw new AutomationError("PLAN_SELECTION_REQUIRED", "Unidade Empresa e Plano precisam estar configurados.", {
        safeDetails: "Nao selecionei plano automaticamente porque nao ha configuracao segura.",
        step: "selecting_plan",
        retryable: false,
      });
    }

    await this.selectIfVisible(/unidade\s+empresa/i, input.unit, true);
    await this.selectIfVisible(/^plano$|plano/i, input.plan, true);
  }

  proceedButton() {
    return this.page
      .getByRole("button", { name: /prosseguir|avancar|avançar|continuar/i })
      .or(this.page.locator("input[value*='PROSSEGUIR' i], input[value*='AVANCAR' i], input[value*='AVANÇAR' i], input[value*='CONTINUAR' i]").first());
  }

  async proceed() {
    await this.proceedButton().click();
  }

  private async field(label: RegExp) {
    return this.page
      .getByLabel(label)
      .or(this.page.getByPlaceholder(label))
      .or(this.page.locator(`input,textarea,select`).filter({ hasText: label }).first());
  }

  private async fillIfVisible(label: RegExp, value: string | undefined) {
    if (!value?.trim()) return;
    const field = await this.field(label);
    if (await field.isVisible().catch(() => false)) await field.fill(value);
  }

  private async selectIfVisible(label: RegExp, value: string | undefined, required = false) {
    if (!value?.trim()) return;
    const field = await this.field(label);
    if (await field.isVisible().catch(() => false)) {
      const optionValue = await field
        .locator("option")
        .filter({ hasText: new RegExp(value, "i") })
        .first()
        .getAttribute("value")
        .catch(() => undefined);
      if (optionValue) {
        await field.selectOption(optionValue);
      } else {
        await field.selectOption({ label: value }).catch(async () => field.fill(value));
      }
      return;
    }

    if (required) {
      throw new AutomationError("PORTAL_CHANGED", "Campo de plano nao encontrado no portal.", {
        safeDetails: "Nao localizei Unidade Empresa/Plano por label semantico.",
        step: "selecting_plan",
        retryable: false,
      });
    }
  }
}
