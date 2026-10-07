import type { Page } from "playwright";

export class HapvidaMenuPage {
  constructor(private readonly page: Page) {}

  companyAccessOption(companyNameOrCode: string) {
    return this.page.getByText(companyNameOrCode, { exact: false });
  }

  cardIssueMenuItem() {
    return this.page.getByRole("link", { name: /carteirinha|cartao|cartão/i }).or(
      this.page.getByRole("button", { name: /carteirinha|cartao|cartão/i }),
    );
  }

  holderInclusionMenuItem() {
    return this.page.getByRole("link", { name: /inclus[aã]o.*titular/i }).or(
      this.page.getByRole("button", { name: /inclus[aã]o.*titular/i }),
    );
  }

  dependentInclusionMenuItem() {
    return this.page.getByRole("link", { name: /inclus[aã]o.*dependente/i }).or(
      this.page.getByRole("button", { name: /inclus[aã]o.*dependente/i }),
    );
  }

  holderExclusionMenuItem() {
    return this.page.getByRole("link", { name: /pr[eé]-?cancelamento.*titular/i }).or(
      this.page.getByRole("button", { name: /pr[eé]-?cancelamento.*titular/i }),
    );
  }

  dependentExclusionMenuItem() {
    return this.page.getByRole("link", { name: /pr[eé]-?cancelamento.*dependente/i }).or(
      this.page.getByRole("button", { name: /pr[eé]-?cancelamento.*dependente/i }),
    );
  }
}
