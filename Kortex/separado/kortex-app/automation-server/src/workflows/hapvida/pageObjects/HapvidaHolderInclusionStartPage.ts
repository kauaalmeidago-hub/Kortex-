import type { Page } from "playwright";

export class HapvidaHolderInclusionStartPage {
  constructor(private readonly page: Page) {}

  heading() {
    return this.page.getByText(/inclus[aã]o\s+de\s+titular/i).first();
  }

  cpfField() {
    return this.page
      .getByLabel(/cpf\s+titular|cpf/i)
      .or(this.page.getByPlaceholder(/cpf/i))
      .or(this.page.locator("input[name*='cpf' i], input[id*='cpf' i]").first());
  }

  proceedButton() {
    return this.page
      .getByRole("button", { name: /prosseguir|avancar|avançar|continuar/i })
      .or(this.page.locator("input[value*='PROSSEGUIR' i], input[value*='AVANCAR' i], input[value*='AVANÇAR' i], input[value*='CONTINUAR' i]").first());
  }

  async waitForLoaded() {
    await this.heading().or(this.cpfField()).waitFor({ state: "visible" });
  }

  async fillCpf(cpf: string) {
    await this.cpfField().fill(cpf.replace(/\D/g, ""));
  }

  async proceed() {
    await this.proceedButton().click();
  }
}
