import type { Page } from "playwright";

export class HapvidaCancellationResultPage {
  constructor(private readonly page: Page) {}

  confirmationMessage() {
    return this.page.getByText(/pr[eé]-?cancelamento|cancelamento|protocolo|registrado|sucesso/i).first();
  }

  protocolText() {
    return this.page.getByText(/protocolo/i).first();
  }

  async waitForResult() {
    await this.confirmationMessage().waitFor({ state: "visible" });
  }
}
