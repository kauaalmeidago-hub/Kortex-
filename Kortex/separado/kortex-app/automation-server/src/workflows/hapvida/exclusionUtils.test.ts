import { describe, expect, it } from "vitest";
import { AutomationError } from "../../errors.js";
import {
  findSingleHolderCandidate,
  mapCancellationReasonOption,
  maskCpf,
  normalizeCpf,
  normalizeName,
  sanitizePortalFileName,
  validateAttachmentMetadata,
  validateContractIdentity,
} from "./exclusionUtils.js";

describe("Hapvida exclusion utilities", () => {
  it("normalizes CPF and names", () => {
    expect(normalizeCpf("123.456.789-00")).toBe("12345678900");
    expect(maskCpf("123.456.789-00")).toBe("123******00");
    expect(normalizeName("GILBÉRTO   DE CASTROS-INFANTINO")).toBe("gilberto de castros infantino");
  });

  it("matches titulares by exact CPF before name", () => {
    const candidate = findSingleHolderCandidate(
      [
        { type: "DEPENDENTE", name: "Maria Silva", cpf: "12345678900", code: "DEP001", rawText: "DEPENDENTE Maria Silva" },
        { type: "TITULAR", name: "Maria Silva", cpf: "123.456.789-00", code: "TIT001", rawText: "TITULAR Maria Silva" },
      ],
      { beneficiaryName: "Maria Silva", beneficiaryCpf: "12345678900" },
    );

    expect(candidate.code).toBe("TIT001");
  });

  it("does not select a dependent with a similar name", () => {
    expect(() =>
      findSingleHolderCandidate(
        [{ type: "DEPENDENTE", name: "Joao Almeida", cpf: "11122233344", code: "DEP001", rawText: "DEPENDENTE Joao Almeida" }],
        { beneficiaryName: "Joao Almeida", beneficiaryCpf: "11122233344" },
      ),
    ).toThrow(/Titular nao encontrado/);
  });

  it("raises ambiguity when more than one holder matches", () => {
    expect(() =>
      findSingleHolderCandidate(
        [
          { type: "TITULAR", name: "Ana Souza", cpf: "11122233344", code: "A1", rawText: "TITULAR Ana Souza" },
          { type: "TITULAR", name: "Ana Souza", cpf: "99988877766", code: "A2", rawText: "TITULAR Ana Souza" },
        ],
        { beneficiaryName: "Ana Souza" },
      ),
    ).toThrow(/Mais de um titular/);
  });

  it("maps cancellation reasons from DOM labels", () => {
    const option = mapCancellationReasonOption(
      [
        { value: "", label: "SELECIONE" },
        { value: "5", label: "Desligamento da empresa" },
      ],
      "desligamento",
    );

    expect(option.value).toBe("5");
  });

  it("validates attachment type and size", () => {
    expect(validateAttachmentMetadata({ fileName: "comprovante.pdf", sizeBytes: 2000 }).portalFileName).toBe("comprovante.pdf");
    expect(() => validateAttachmentMetadata({ fileName: "arquivo.exe", sizeBytes: 2000 })).toThrow(AutomationError);
    expect(() => validateAttachmentMetadata({ fileName: "arquivo.pdf", sizeBytes: 2 * 1024 * 1024 + 1 })).toThrow(
      /Anexo maior/,
    );
  });

  it("sanitizes portal filenames without losing extension", () => {
    expect(sanitizePortalFileName("Declaração do funcionário 01.pdf")).toBe("Declaracao_do_funcionario_01.pdf");
  });

  it("validates contract identity", () => {
    expect(() =>
      validateContractIdentity(
        { beneficiaryName: "Gilberto de Castros Infantino", beneficiaryCpf: "8060101692" },
        { name: "GILBERTO DE CASTROS INFANTINO", cpf: "8060101692" },
      ),
    ).not.toThrow();

    expect(() =>
      validateContractIdentity(
        { beneficiaryName: "Gilberto de Castros Infantino", beneficiaryCpf: "8060101692" },
        { name: "Outra Pessoa", cpf: "8060101692" },
      ),
    ).toThrow(/Nome do titular/);
  });
});
