import type { Locator, Page } from "playwright";
import { AutomationError } from "../../../errors.js";
import { normalizeCpf, normalizeName } from "../exclusionUtils.js";

export interface ActiveUserRow {
  rowIndex?: number;
  type?: string;
  name?: string;
  cpf?: string;
  enrollment?: string;
  userCode?: string;
  plan?: string;
  rawText?: string;
}

export interface ActiveUsersTotals {
  holders: number;
  dependents: number;
}

export class HapvidaActiveUsersPage {
  constructor(private readonly page: Page) {}

  heading() {
    return this.page.getByText(/lista\s+usu[aá]rios\s+ativos|usu[aá]rios\s+ativos/i).first();
  }

  tableRows() {
    return this.page.locator("table tr").or(this.page.getByRole("row"));
  }

  async load() {
    await this.waitUntilLoaded();
  }

  async waitUntilLoaded() {
    await this.heading().or(this.tableRows().first()).waitFor({ state: "visible" });
  }

  async waitForLoaded() {
    await this.waitUntilLoaded();
  }

  async getRows() {
    return this.readRows();
  }

  async findByCpf(cpf: string) {
    const expectedCpf = normalizeCpf(cpf);
    if (!expectedCpf) return [];

    return (await this.getRows()).filter((row) => {
      const rowCpf = normalizeCpf(row.cpf);
      const rawDigits = normalizeCpf(row.rawText);
      return rowCpf === expectedCpf || (!rowCpf && rawDigits.includes(expectedCpf));
    });
  }

  async findByName(name: string) {
    const expectedName = normalizeName(name);
    if (!expectedName) return [];

    return (await this.getRows()).filter((row) => {
      const rowName = normalizeName(row.name);
      if (rowName) return rowName === expectedName;
      return normalizeName(row.rawText).includes(expectedName);
    });
  }

  async findHolder(input: { beneficiaryName: string; beneficiaryCpf?: string }) {
    const rows = await this.getRows();
    const matches = this.findRows(rows, input).filter((row) => this.isHolder(row));
    return this.requireSingle(matches, "BENEFICIARY_NOT_ACTIVE", "Titular ativo nao encontrado.");
  }

  async findDependent(input: { beneficiaryName: string; beneficiaryCpf?: string }) {
    const rows = await this.getRows();
    const matches = this.findRows(rows, input).filter((row) => this.isDependent(row));
    return this.requireSingle(matches, "BENEFICIARY_NOT_ACTIVE", "Dependente ativo nao encontrado.");
  }

  getUserCode(row: ActiveUserRow) {
    return row.userCode;
  }

  getEnrollment(row: ActiveUserRow) {
    return row.enrollment;
  }

  getPlan(row: ActiveUserRow) {
    return row.plan;
  }

  async getTotals(): Promise<ActiveUsersTotals> {
    const rows = await this.getRows();
    const bodyText = ((await this.page.locator("body").innerText().catch(() => "")) ?? "").trim();
    const holdersFromText = this.readTotalFromText(bodyText, /titulares?|titular/i);
    const dependentsFromText = this.readTotalFromText(bodyText, /dependentes?|dependente/i);

    return {
      holders: holdersFromText ?? rows.filter((row) => this.isHolder(row)).length,
      dependents: dependentsFromText ?? rows.filter((row) => this.isDependent(row)).length,
    };
  }

  returnButton() {
    return this.page
      .getByRole("button", { name: /retornar|voltar|menu/i })
      .or(this.page.getByRole("link", { name: /retornar|voltar|menu/i }))
      .or(this.page.locator("input[value*='RETORNAR' i], input[value*='VOLTAR' i]").first());
  }

  async returnToMainMenu() {
    await this.returnButton().click();
  }

  private async readRows() {
    const rows = this.tableRows();
    const count = await rows.count();
    const headers = await this.readHeaders(rows);
    const activeUsers: ActiveUserRow[] = [];

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const rawText = ((await row.innerText().catch(() => "")) ?? "").trim();
      if (!rawText || !/titular|dependente|\d{3}/i.test(rawText)) continue;
      if (/titular\/dependente|cpf|matr[ií]cula|c[oó]digo|plano/i.test(rawText) && !/\d{3}/.test(rawText)) continue;

      const cells = await this.readCells(row);
      const candidate = this.candidateFromRow(index, cells, rawText, headers);
      if (candidate) activeUsers.push(candidate);
    }

    if (activeUsers.length === 0) {
      throw new AutomationError("ACTIVE_USERS_LIST_UNAVAILABLE", "Lista de usuarios ativos nao pode ser lida.", {
        safeDetails: "Nao encontrei linhas com titular/dependente, CPF e codigo.",
        step: "read_active_users",
        retryable: false,
      });
    }

    return activeUsers;
  }

  private async readHeaders(rows: Locator) {
    const first = rows.first();
    const cells = await this.readCells(first);
    return cells.map(normalizeName);
  }

  private async readCells(row: Locator) {
    const cellLocator = row.locator("th,td");
    const cellCount = await cellLocator.count();
    if (cellCount === 0) return [((await row.innerText().catch(() => "")) ?? "").trim()];

    const cells: string[] = [];
    for (let index = 0; index < cellCount; index += 1) {
      cells.push(((await cellLocator.nth(index).innerText().catch(() => "")) ?? "").trim());
    }
    return cells;
  }

  private candidateFromRow(rowIndex: number, cells: string[], rawText: string, headers: string[]): ActiveUserRow | undefined {
    const valueByHeader = (pattern: RegExp) => {
      const index = headers.findIndex((header) => pattern.test(header));
      return index >= 0 ? cells[index] : undefined;
    };

    const type = valueByHeader(/titular|dependente|tipo/) ?? cells.find((cell) => /titular|dependente/i.test(cell));
    const cpf =
      valueByHeader(/^cpf$/) ??
      cells.find((cell) => {
        const digits = normalizeCpf(cell);
        return digits.length >= 10 && digits.length <= 11;
      });
    const name =
      valueByHeader(/nome|usu[aá]rio|benefici[aá]rio/) ??
      cells.find((cell) => /[A-Za-zÀ-ÿ]{3}/.test(cell) && !/titular|dependente|plano/i.test(cell));
    const userCode = valueByHeader(/c[oó]digo|codigo/) ?? this.extractCodeFromRawText(rawText, cells);
    const enrollment = valueByHeader(/matr[ií]cula|matricula/);
    const plan = valueByHeader(/plano/);

    if (!type && !name && !cpf && !userCode) return undefined;
    return { rowIndex, type, name, cpf, userCode, enrollment, plan, rawText };
  }

  private extractCodeFromRawText(rawText: string, cells: string[]) {
    const labelled = /c[oó]digo\s*:?\s*([A-Z0-9-]+)/i.exec(rawText);
    if (labelled?.[1]) return labelled[1];

    return cells.find((cell) => {
      const normalized = cell.trim();
      const digits = normalizeCpf(normalized);
      return /^[A-Z0-9-]{4,}$/.test(normalized) && digits.length !== 10 && digits.length !== 11;
    });
  }

  private findRows(rows: ActiveUserRow[], input: { beneficiaryName: string; beneficiaryCpf?: string }) {
    const expectedCpf = normalizeCpf(input.beneficiaryCpf);
    if (expectedCpf) {
      const byCpf = rows.filter((row) => normalizeCpf(row.cpf) === expectedCpf || normalizeCpf(row.rawText).includes(expectedCpf));
      if (byCpf.length > 0) return byCpf;
    }

    const expectedName = normalizeName(input.beneficiaryName);
    return rows.filter((row) => normalizeName(row.name) === expectedName);
  }

  private requireSingle(matches: ActiveUserRow[], code: string, message: string) {
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new AutomationError("BENEFICIARY_AMBIGUOUS", "Mais de um beneficiario encontrado na Lista Usuarios Ativos.", {
        safeDetails: "Informe CPF exato para eliminar a ambiguidade.",
        step: "active_users_match",
        retryable: false,
      });
    }

    throw new AutomationError(code, message, {
      safeDetails: "A Lista Usuarios Ativos nao possui um registro unico com os dados informados.",
      step: "active_users_match",
      retryable: false,
    });
  }

  private isHolder(row: ActiveUserRow) {
    const type = normalizeName(row.type ?? row.rawText);
    return type.includes("titular") && !type.includes("dependente");
  }

  private isDependent(row: ActiveUserRow) {
    const type = normalizeName(row.type ?? row.rawText);
    return type.includes("dependente");
  }

  private readTotalFromText(text: string, label: RegExp) {
    const normalized = text.replace(/\s+/g, " ");
    const labelFirst = new RegExp(`${label.source}\\D{0,20}(\\d+)`, "i").exec(normalized);
    if (labelFirst?.[1]) return Number(labelFirst[1]);

    const numberFirst = new RegExp(`(\\d+)\\D{0,20}${label.source}`, "i").exec(normalized);
    if (numberFirst?.[1]) return Number(numberFirst[1]);

    return undefined;
  }
}
