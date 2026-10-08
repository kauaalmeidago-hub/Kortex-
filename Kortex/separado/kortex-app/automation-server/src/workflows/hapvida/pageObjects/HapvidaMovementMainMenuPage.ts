import type { Page } from "playwright";

export class HapvidaMovementMainMenuPage {
  constructor(private readonly page: Page) {}

  menuHeading() {
    return this.page.getByText(/sistema[s]?\s+de\s+movimenta[cç][aã]o.*menu\s+principal/i).first();
  }

  quickAccessHeading() {
    return this.page.getByText(/acesso\s+r[aá]pido/i).first();
  }

  companyName() {
    return this.page.locator("select option:checked").or(this.page.getByText(/[A-Z0-9].*(LTDA|EPP|ME|SA|S\/A)/i).first());
  }

  activeUsersMenuItem() {
    return this.page
      .getByRole("link", { name: /lista\s+usu[aá]rios\s+ativos/i })
      .or(this.page.getByRole("button", { name: /lista\s+usu[aá]rios\s+ativos/i }))
      .or(this.page.getByText(/lista\s+usu[aá]rios\s+ativos/i).first());
  }

  movementStatusMenuItem() {
    return this.page
      .getByRole("link", { name: /status\s+movimenta[cç][aã]o|status\s+de\s+movimenta[cç][aã]o/i })
      .or(this.page.getByRole("button", { name: /status\s+movimenta[cç][aã]o|status\s+de\s+movimenta[cç][aã]o/i }))
      .or(this.page.getByText(/status\s+movimenta[cç][aã]o|status\s+de\s+movimenta[cç][aã]o/i).first());
  }

  servicesMenuItem() {
    return this.page
      .getByRole("button", { name: /servi[cç]os/i })
      .or(this.page.getByRole("link", { name: /servi[cç]os/i }))
      .or(this.page.getByText(/^servi[cç]os$/i).first());
  }

  holderPreCancellationMenuItem() {
    return this.page
      .getByRole("link", { name: /pr[eé]-?cancelamento\s+de\s+titular\s+ativo/i })
      .or(this.page.getByRole("button", { name: /pr[eé]-?cancelamento\s+de\s+titular\s+ativo/i }))
      .or(this.page.getByText(/pr[eé]-?cancelamento\s+de\s+titular\s+ativo/i).first());
  }

  holderInclusionMenuItem() {
    return this.page
      .getByRole("link", { name: /inclus[aã]o\s+de\s+titular/i })
      .or(this.page.getByRole("button", { name: /inclus[aã]o\s+de\s+titular/i }))
      .or(this.page.getByText(/inclus[aã]o\s+de\s+titular/i).first());
  }

  async waitForLoaded() {
    await this.quickAccessHeading().or(this.menuHeading()).waitFor({ state: "visible" });
  }

  async openServices() {
    if (await this.servicesMenuItem().isVisible().catch(() => false)) {
      await this.servicesMenuItem().click().catch(() => undefined);
    }
  }

  async openActiveUsers() {
    await this.openServices();
    await this.activeUsersMenuItem().click();
  }

  async openActiveUsersList() {
    await this.openActiveUsers();
  }

  async openMovementStatus() {
    await this.openServices();
    await this.movementStatusMenuItem().click();
  }

  async openHolderPreCancellation() {
    await this.holderPreCancellationMenuItem().click();
  }

  async openHolderInclusion() {
    await this.openServices();
    await this.holderInclusionMenuItem().click();
  }
}
