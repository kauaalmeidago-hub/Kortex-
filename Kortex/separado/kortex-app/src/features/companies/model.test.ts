import { describe, expect, it } from "vitest";
import { companyFixture } from "@/test/companyFixtures";
import {
  companyValues,
  formatCnpj,
  matchesCompany,
  parseOfferings,
  validateCompany,
  validCnpj,
  offeringSummary,
} from "./model";
describe("company model", () => {
  it("starts a new registration without project/product/operator defaults", () => {
    const values = companyValues();
    expect(values.project).toBe("");
    expect(values.city).toBe("");
    expect(values.responsible_name).toBe("");
    expect(values.offerings).toEqual([{ product: "", operator: "" }]);
  });
  it("round trips every preview field and keeps product/operator pairs", () => {
    const values = companyValues(companyFixture);
    expect(values).toMatchObject({
      name: companyFixture.name,
      cnpj: "11.222.333/0001-81",
      email: companyFixture.email,
      phone: companyFixture.phone,
      project: "PME",
      city: "Cidade teste",
      responsible_name: "Responsável teste",
    });
    expect(values.offerings).toEqual(parseOfferings(companyFixture.offerings));
    expect(offeringSummary(companyFixture, "product")).toBe("Saúde + Odonto");
  });
  it("validates CNPJ check digits and rejects repeated or incomplete identifiers", () => {
    expect(validCnpj("11.222.333/0001-81")).toBe(true);
    expect(validCnpj("11222333000182")).toBe(false);
    expect(validCnpj("00000000000000")).toBe(false);
    expect(validCnpj("123")).toBe(false);
    expect(formatCnpj(null)).toBe("");
  });
  it("allows missing legacy fields and rejects a half-completed offering", () => {
    const values = companyValues();
    values.name = "Empresa";
    expect(validateCompany(values)).toBe(null);
    values.offerings = [{ product: "Saúde", operator: "" }];
    expect(validateCompany(values)).toContain("produto e operadora");
  });
  it("searches name and formatted/unformatted CNPJ", () => {
    expect(matchesCompany(companyFixture, "alfa", "", "", "")).toBe(true);
    expect(
      matchesCompany(companyFixture, "11.222.333/0001-81", "", "", ""),
    ).toBe(true);
    expect(matchesCompany(companyFixture, "11222333", "", "", "")).toBe(true);
    expect(matchesCompany(companyFixture, "inexistente", "", "", "")).toBe(
      false,
    );
  });
  it("applies product and operator to the same offering", () => {
    expect(matchesCompany(companyFixture, "", "PME", "Saúde", "Hapvida")).toBe(
      true,
    );
    expect(matchesCompany(companyFixture, "", "PME", "Saúde", "NDI")).toBe(
      false,
    );
    expect(matchesCompany(companyFixture, "", "CCT", "", "")).toBe(false);
  });
});
