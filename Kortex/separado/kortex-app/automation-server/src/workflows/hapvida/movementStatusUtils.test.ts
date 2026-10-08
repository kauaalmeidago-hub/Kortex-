import { describe, expect, it } from "vitest";
import { AutomationError } from "../../errors.js";
import { findMovementStatusRecord, parseMovementStatusRecord, parseStatusLegend } from "./movementStatusUtils.js";

describe("Hapvida movement status utilities", () => {
  it("parses the portal status legend without changing labels", () => {
    expect(
      parseStatusLegend(
        "Legenda: 0 - Digitado 1 - Pendente de alguma documentação 2 - Cancelado 8 - Pedido autorizado 9 - Pedido processado 17 - Pedido em Validação de Dados Cadastrais",
      ),
    ).toEqual([
      { code: "0", label: "Digitado" },
      { code: "1", label: "Pendente de alguma documentação" },
      { code: "2", label: "Cancelado" },
      { code: "8", label: "Pedido autorizado" },
      { code: "9", label: "Pedido processado" },
      { code: "17", label: "Pedido em Validação de Dados Cadastrais" },
    ]);
  });

  it("parses a movement row using legend code labels", () => {
    const legend = parseStatusLegend("0 - Digitado 9 - Pedido processado");
    const record = parseMovementStatusRecord({
      rowIndex: 0,
      section: "Pré-cancelamento de Titular",
      legend,
      rawText: "Pré-cancelamento de Titular | Beneficiário: Mariana Silva | CPF: 123.456.789-00 | Código: TIT001 | Status: 0",
    });

    expect(record.portalStatusCode).toBe("0");
    expect(record.portalStatusLabel).toBe("Digitado");
    expect(record.beneficiaryCpf).toBe("123.456.789-00");
    expect(record.userCode).toBe("TIT001");
  });

  it("matches movement by workflow and CPF", () => {
    const records = [
      parseMovementStatusRecord({
        section: "Inclusão de Titular",
        rawText: "Inclusão de Titular | Beneficiário: Mariana Silva | CPF: 999.999.999-99 | Status: 0",
      }),
      parseMovementStatusRecord({
        section: "Pré-cancelamento de Titular",
        rawText: "Pré-cancelamento de Titular | Beneficiário: Mariana Silva | CPF: 123.456.789-00 | Status: 0",
      }),
    ];

    const match = findMovementStatusRecord(records, {
      workflow: "EXCLUSION_HOLDER",
      beneficiaryName: "Mariana Silva",
      beneficiaryCpf: "12345678900",
    });

    expect(match?.section).toBe("Pré-cancelamento de Titular");
  });

  it("does not validate solely by a name when CPF points elsewhere", () => {
    const records = [
      parseMovementStatusRecord({
        section: "Pré-cancelamento de Titular",
        rawText: "Pré-cancelamento de Titular | Beneficiário: Mariana Silva | CPF: 999.999.999-99 | Status: 0",
      }),
    ];

    const match = findMovementStatusRecord(records, {
      workflow: "EXCLUSION_HOLDER",
      beneficiaryName: "Mariana Silva",
      beneficiaryCpf: "12345678900",
    });

    expect(match).toBeUndefined();
  });

  it("raises ambiguity when multiple records match the same workflow and CPF", () => {
    const records = [
      parseMovementStatusRecord({
        section: "Inclusão de Dependente",
        rawText: "Inclusão de Dependente | Beneficiário: Gabriel Silva | CPF: 123.456.789-00 | Status: 0",
      }),
      parseMovementStatusRecord({
        section: "Inclusão de Dependente",
        rawText: "Inclusão de Dependente | Beneficiário: Gabriel Silva | CPF: 123.456.789-00 | Status: 17",
      }),
    ];

    expect(() =>
      findMovementStatusRecord(records, {
        workflow: "INCLUSION_DEPENDENT",
        beneficiaryName: "Gabriel Silva",
        beneficiaryCpf: "12345678900",
      }),
    ).toThrow(AutomationError);
  });
});
