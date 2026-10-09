import { describe, expect, it } from "vitest";
import { isAllCardBeneficiaries } from "./cardIssueScope";

describe("the TODOS command in the beneficiary form", () => {
  it.each(["TODOS", " todos ", "todos os beneficiários da empresa", "Todas"])("recognizes %s", name => {
    expect(isAllCardBeneficiaries(name)).toBe(true);
  });
  it.each(["Todos dos Santos", "Maria de Todos os Santos", "Mariana Silva", ""])("keeps %s as an individual name", name => {
    expect(isAllCardBeneficiaries(name)).toBe(false);
  });
});
