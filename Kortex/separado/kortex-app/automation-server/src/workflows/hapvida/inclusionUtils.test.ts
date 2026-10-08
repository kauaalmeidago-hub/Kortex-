import { describe, expect, it } from "vitest";
import { AutomationError } from "../../errors.js";
import {
  normalizeDocumentFileName,
  validateAndNormalizeDocument,
  validateCnsIdentity,
  validateHealthAnswers,
  validateReceitaCpfIdentity,
} from "./inclusionUtils.js";

describe("Hapvida holder inclusion utilities", () => {
  it("normalizes document filenames to lowercase alphanumeric base and lowercase extension", () => {
    expect(normalizeDocumentFileName("CPF João da Silva.pdf")).toBe("cpfjoaodasilva.pdf");
    expect(normalizeDocumentFileName("Comprovante Endereço 01.PDF")).toBe("comprovanteendereco01.pdf");
  });

  it("guarantees unique normalized filenames", () => {
    const used = new Set<string>();
    expect(normalizeDocumentFileName("CPF João.pdf", used)).toBe("cpfjoao.pdf");
    expect(normalizeDocumentFileName("CPF João.pdf", used)).toBe("cpfjoao2.pdf");
  });

  it("rejects invalid attachment type and files over 2 MB", () => {
    expect(() => validateAndNormalizeDocument({ fileName: "documento.exe", sizeBytes: 1000 })).toThrow(AutomationError);
    expect(() => validateAndNormalizeDocument({ fileName: "documento.pdf", sizeBytes: 2 * 1024 * 1024 + 1 })).toThrow(
      /Anexo maior/,
    );
  });

  it("validates CNS identity and requires a CNS number", () => {
    expect(() =>
      validateCnsIdentity(
        { beneficiaryName: "Mariana Silva", cpf: "12345678900", birthDate: "01/02/1990" },
        { cnsNumber: "700000000000000", returnedName: "Mariana Silva", returnedCpf: "123.456.789-00", returnedBirthDate: "01/02/1990" },
      ),
    ).not.toThrow();

    expect(() =>
      validateCnsIdentity(
        { beneficiaryName: "Mariana Silva", cpf: "12345678900", birthDate: "01/02/1990" },
        { returnedName: "Mariana Silva", returnedCpf: "123.456.789-00", returnedBirthDate: "01/02/1990" },
      ),
    ).toThrow(/CNS nao encontrado/);
  });

  it("rejects CNS identity mismatch", () => {
    expect(() =>
      validateCnsIdentity(
        { beneficiaryName: "Mariana Silva", cpf: "12345678900", birthDate: "01/02/1990" },
        { cnsNumber: "700000000000000", returnedName: "Outra Pessoa", returnedCpf: "123.456.789-00", returnedBirthDate: "01/02/1990" },
      ),
    ).toThrow(AutomationError);
  });

  it("validates Receita CPF identity and blocks non-regular status for review", () => {
    expect(() =>
      validateReceitaCpfIdentity(
        { beneficiaryName: "Mariana Silva", cpf: "12345678900", birthDate: "01/02/1990" },
        { name: "Mariana Silva", cpf: "123.456.789-00", birthDate: "01/02/1990", registrationStatus: "Regular" },
      ),
    ).not.toThrow();

    expect(() =>
      validateReceitaCpfIdentity(
        { beneficiaryName: "Mariana Silva", cpf: "12345678900", birthDate: "01/02/1990" },
        { name: "Mariana Silva", cpf: "123.456.789-00", birthDate: "01/02/1990", registrationStatus: "Pendente de regularização" },
      ),
    ).toThrow(/Situacao cadastral/);
  });

  it("requires real health answers or explicit all-negative confirmation", () => {
    expect(() => validateHealthAnswers({ healthAllNegativeConfirmed: true })).not.toThrow();
    expect(() => validateHealthAnswers({ healthAnswers: [] })).toThrow(/Declaracao de saude/);
    expect(() => validateHealthAnswers({ healthAnswers: [{ questionId: "q1", answer: "yes" }] })).toThrow(
      /Detalhe de saude/,
    );
    expect(() => validateHealthAnswers({ healthAnswers: [{ questionId: "q1", answer: "yes", detail: "Informado pelo beneficiário" }] })).not.toThrow();
  });
});
