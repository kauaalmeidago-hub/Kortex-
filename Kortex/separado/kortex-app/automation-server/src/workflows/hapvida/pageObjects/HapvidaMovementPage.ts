import type { Page } from "playwright";

export class HapvidaMovementPage {
  constructor(private readonly page: Page) {}

  beneficiarySearchField() {
    return this.page.getByLabel(/benefici[aá]rio|nome|cpf/i).or(this.page.getByRole("textbox").first());
  }

  contractCodeField() {
    return this.page.getByLabel(/contrato|c[oó]digo/i);
  }

  startDateField() {
    return this.page.getByLabel(/data inicial|in[ií]cio/i);
  }

  endDateField() {
    return this.page.getByLabel(/data final|fim/i);
  }

  submitButton() {
    return this.page.getByRole("button", { name: /emitir|enviar|prosseguir|confirmar|submeter/i });
  }

  downloadLink() {
    return this.page.getByRole("link", { name: /pdf|download|baixar|carteirinha/i });
  }

  statusText() {
    return this.page.getByText(/processado|conclu[ií]do|emitido|sucesso|protocolo/i);
  }
}
