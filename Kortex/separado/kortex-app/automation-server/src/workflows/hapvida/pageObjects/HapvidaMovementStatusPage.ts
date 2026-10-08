import type { Locator, Page } from "playwright";
import {
  findMovementStatusRecord,
  parseMovementStatusRecord,
  parseStatusLegend,
  type MovementStatusLegendItem,
  type MovementStatusMatchInput,
  type MovementStatusRecord,
} from "../movementStatusUtils.js";

export class HapvidaMovementStatusPage {
  constructor(private readonly page: Page) {}

  heading() {
    return this.page.getByText(/status\s+de\s+movimenta[cç][aã]o|status\s+movimenta[cç][aã]o/i).first();
  }

  rows() {
    return this.page.locator("table tr").or(this.page.getByRole("row"));
  }

  async load() {
    await this.waitUntilLoaded();
  }

  async waitUntilLoaded() {
    await this.heading().or(this.rows().first()).waitFor({ state: "visible" });
  }

  async getLegend() {
    const text = ((await this.page.locator("body").innerText().catch(() => "")) ?? "").trim();
    return parseStatusLegend(text);
  }

  async getSections() {
    const headings = this.page.locator("h1,h2,h3,h4,caption,legend,b,strong");
    const count = await headings.count();
    const sections: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const text = ((await headings.nth(index).innerText().catch(() => "")) ?? "").trim();
      if (/inclus[aã]o|cancelamento|movimenta[cç][aã]o/i.test(text) && !sections.includes(text)) {
        sections.push(text);
      }
    }

    return sections;
  }

  async getRecords() {
    const rows = this.rows();
    const count = await rows.count();
    const legend = await this.getLegend();
    const records: MovementStatusRecord[] = [];

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const rawText = ((await row.innerText().catch(() => "")) ?? "").trim();
      if (!rawText || !/inclus[aã]o|cancelamento|cpf|status|pedido|\d{2}\/\d{2}\/\d{4}/i.test(rawText)) continue;
      if (/legenda|digitado|pedido\s+processado/i.test(rawText) && !/\d{3}\.?\d{3}/.test(rawText)) continue;

      records.push(parseMovementStatusRecord({ rowIndex: index, rawText, legend, section: await this.sectionForRow(row) }));
    }

    return records;
  }

  async findMovement(input: MovementStatusMatchInput) {
    return findMovementStatusRecord(await this.getRecords(), input);
  }

  async findByBeneficiary(beneficiaryName: string) {
    return (await this.getRecords()).filter((record) => record.beneficiaryName?.toLowerCase().includes(beneficiaryName.toLowerCase()));
  }

  async findByCpf(cpf: string) {
    return (await this.getRecords()).filter((record) => record.beneficiaryCpf?.replace(/\D/g, "") === cpf.replace(/\D/g, ""));
  }

  async findByOperationType(operationType: string) {
    return (await this.getRecords()).filter((record) => record.operationType?.toLowerCase().includes(operationType.toLowerCase()));
  }

  getStatusCode(record: MovementStatusRecord) {
    return record.portalStatusCode;
  }

  getStatusLabel(record: MovementStatusRecord, legend?: MovementStatusLegendItem[]) {
    if (record.portalStatusLabel) return record.portalStatusLabel;
    return legend?.find((item) => item.code === record.portalStatusCode)?.label;
  }

  async captureEvidence(record?: MovementStatusRecord) {
    const row = typeof record?.rowIndex === "number" ? this.rows().nth(record.rowIndex) : undefined;
    if (row && (await row.isVisible().catch(() => false))) {
      await row.scrollIntoViewIfNeeded().catch(() => undefined);
      return Buffer.from(await row.screenshot({ type: "png" }));
    }

    return Buffer.from(await this.page.screenshot({ type: "png", fullPage: true }));
  }

  private async sectionForRow(row: Locator) {
    const table = row.locator("xpath=ancestor::table[1]");
    const caption = await table.locator("caption").first().innerText().catch(() => undefined);
    if (caption?.trim()) return caption.trim();

    const tableText = ((await table.innerText().catch(() => "")) ?? "").trim();
    const heading = /(inclus[aã]o\s+de\s+titular|inclus[aã]o\s+de\s+dependente|pr[eé]-?cancelamento\s+de\s+titular|pr[eé]-?cancelamento\s+de\s+dependente)/i.exec(tableText);
    return heading?.[1];
  }
}
