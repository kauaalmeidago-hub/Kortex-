import { describe, expect, it } from "vitest";
import { isAllBeneficiariesRequest } from "./cardIssueScope.js";
import { validatePayload } from "../../validation/operationSchemas.js";

describe("card requests for all company beneficiaries", () => {
  it.each(["todos", " TODOS ", "Todas", "todos os beneficiários", "todos os beneficiarios da empresa"])("recognizes the explicit command %s", beneficiaryName => {
    expect(isAllBeneficiariesRequest({ beneficiaryName })).toBe(true);
    expect(validatePayload("CARD_ISSUE", { beneficiaryName, contractCode: "0TEST" })).toMatchObject({ beneficiaryScope: "all", portalSearch: "auto" });
  });
  it.each(["Todos dos Santos", "Maria de Todos os Santos", "Joao Silva"])("keeps the name %s as an individual request", beneficiaryName => {
    expect(isAllBeneficiariesRequest({ beneficiaryName })).toBe(false);
    expect(validatePayload("CARD_ISSUE", { beneficiaryName })).toMatchObject({ beneficiaryScope: "single" });
  });
  it("requires a company code for a bulk request even when a general session exists", () => {
    expect(() => validatePayload("CARD_ISSUE", { beneficiaryName: "TODOS" })).toThrow();
  });
  it("recognizes the explicit API scope for bulk requests", () => {
    expect(validatePayload("CARD_ISSUE", { beneficiaryName: "Empresa", beneficiaryScope: "all", contractCode: "0TEST" }))
      .toMatchObject({ beneficiaryScope: "all" });
  });
});
