import type { Page } from "playwright";

export class HapvidaHolderPreCancellationPage {
  constructor(private readonly page: Page) {}

  heading() {
    return this.page.getByText(/pr[eé]-?cancelamento.*contratos?\s+ativos|c[oó]digo\s+usu[aá]rio\s+titular/i).first();
  }

  holderUserCodeField() {
    return this.page
      .getByLabel(/c[oó]digo\s+usu[aá]rio\s+titular/i)
      .or(this.page.locator("input[name*='codigo' i], input[name*='cd_usuario' i], input[id*='codigo' i]").first())
      .or(this.page.getByRole("textbox").first());
  }

  proceedButton() {
    return this.page
      .getByRole("button", { name: /prosseguir/i })
      .or(this.page.locator("input[value*='PROSSEGUIR' i], input[type='submit']").first());
  }

  async waitForLoaded() {
    await this.heading().or(this.holderUserCodeField()).waitFor({ state: "visible" });
  }

  async fillHolderUserCode(holderUserCode: string) {
    await this.holderUserCodeField().fill(holderUserCode);
  }

  async proceedToReview() {
    await this.proceedButton().click();
  }
}
