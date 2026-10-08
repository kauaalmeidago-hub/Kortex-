import { describe, expect, it } from "vitest";
import { AutomationError } from "../../errors.js";
import { evaluateActiveUsersPreflight } from "./ActiveUsersPreflightService.js";
import type { ActiveUserRow } from "./pageObjects/HapvidaActiveUsersPage.js";

const rows: ActiveUserRow[] = [
  {
    type: "TITULAR",
    name: "Mariana Silva de Oliveira",
    cpf: "123.456.789-00",
    enrollment: "MAT001",
    userCode: "TIT001",
    plan: "PLANO A",
  },
  {
    type: "DEPENDENTE",
    name: "Gabriel Silva de Oliveira",
    cpf: "987.654.321-00",
    enrollment: "MAT002",
    userCode: "DEP001",
    plan: "PLANO A",
  },
];

function evaluate(workflow: Parameters<typeof evaluateActiveUsersPreflight>[0]["workflow"], data: Record<string, string>) {
  return evaluateActiveUsersPreflight({
    workflow,
    companyId: "company-1",
    rows,
    data,
  });
}

describe("ActiveUsersPreflightService", () => {
  it("matches an active beneficiary by exact CPF before card issue", () => {
    const result = evaluate("CARD_ISSUE", {
      beneficiaryName: "Outro nome",
      beneficiaryCpf: "98765432100",
    });

    expect(result.target?.userCode).toBe("DEP001");
    expect(result.snapshot.target?.plan).toBe("PLANO A");
  });

  it("requires the beneficiary to be active before card issue", () => {
    expect(() =>
      evaluate("CARD_ISSUE", {
        beneficiaryName: "Pessoa Inativa",
        beneficiaryCpf: "00000000000",
      }),
    ).toThrow(/Beneficiario nao esta ativo/);
  });

  it("matches an active holder and exposes the portal user code for holder exclusion", () => {
    const result = evaluate("EXCLUSION_HOLDER", {
      beneficiaryName: "Mariana Silva de Oliveira",
      beneficiaryCpf: "12345678900",
    });

    expect(result.target?.userCode).toBe("TIT001");
    expect(result.snapshot.target?.cpfMasked).toBe("123******00");
  });

  it("rejects holder exclusion when the matching active user is a dependent", () => {
    try {
      evaluate("EXCLUSION_HOLDER", {
        beneficiaryName: "Gabriel Silva de Oliveira",
        beneficiaryCpf: "98765432100",
      });
      throw new Error("Expected exclusion preflight to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      expect((error as AutomationError).code).toBe("BENEFICIARY_TYPE_MISMATCH");
    }
  });

  it("blocks duplicated holder inclusion when the CPF is already active", () => {
    try {
      evaluate("INCLUSION_HOLDER", {
        beneficiaryName: "Mariana Silva de Oliveira",
        beneficiaryCpf: "12345678900",
      });
      throw new Error("Expected inclusion preflight to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      expect((error as AutomationError).code).toBe("BENEFICIARY_ALREADY_ACTIVE");
    }
  });

  it("allows holder inclusion when the beneficiary is not active", () => {
    const result = evaluate("INCLUSION_HOLDER", {
      beneficiaryName: "Novo Titular",
      beneficiaryCpf: "11122233344",
    });

    expect(result.snapshot.target?.found).toBe(false);
  });

  it("requires an active holder and absent dependent before dependent inclusion", () => {
    const result = evaluate("INCLUSION_DEPENDENT", {
      holderName: "Mariana Silva de Oliveira",
      holderCpf: "12345678900",
      dependentName: "Novo Dependente",
      dependentCpf: "55566677788",
    });

    expect(result.holder?.userCode).toBe("TIT001");
    expect(result.snapshot.target?.found).toBe(false);
  });

  it("blocks dependent inclusion when the dependent is already active", () => {
    try {
      evaluate("INCLUSION_DEPENDENT", {
        holderName: "Mariana Silva de Oliveira",
        holderCpf: "12345678900",
        dependentName: "Gabriel Silva de Oliveira",
        dependentCpf: "98765432100",
      });
      throw new Error("Expected dependent inclusion preflight to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      expect((error as AutomationError).code).toBe("DEPENDENT_ALREADY_ACTIVE");
    }
  });

  it("reports HOLDER_NOT_ACTIVE when dependent inclusion has no active holder", () => {
    try {
      evaluate("INCLUSION_DEPENDENT", {
        holderName: "Titular Ausente",
        holderCpf: "00000000000",
        dependentName: "Novo Dependente",
        dependentCpf: "55566677788",
      });
      throw new Error("Expected dependent inclusion preflight to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      expect((error as AutomationError).code).toBe("HOLDER_NOT_ACTIVE");
    }
  });
});
