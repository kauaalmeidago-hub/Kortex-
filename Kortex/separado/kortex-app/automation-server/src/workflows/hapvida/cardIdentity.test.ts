import { describe, expect, it } from "vitest";
import { cardTextMatchPatterns } from "./cardIdentity.js";

describe("printed native card identity", () => {
  const input = { beneficiaryName: "ARTHUR ALVES MOREIRA DOS SANTOS", cardIdentifiers: ["0TEST.900001/01-9"], requireIdentifier: true };
  const matches = (text: string) => {
    const patterns = cardTextMatchPatterns(input);
    const identity = patterns.identifiers.some(pattern => new RegExp(pattern).test(text.toLowerCase()));
    return identity && (new RegExp(patterns.fullName).test(text.toLowerCase()) || Boolean(patterns.shortenedName && new RegExp(patterns.shortenedName).test(text.toLowerCase())));
  };
  it.each(["ARTHUR ALVES MOREIRA DOS SANTOS", "ARTHUR A M SANTOS", "ARTHUR A. M. DOS SANTOS", "ARTHUR ALVES"])("accepts %s only with the selected full card code", name => {
    expect(matches(`Nome: ${name} Codigo: 0TEST.900001/01-9 Plano: TESTE`)).toBe(true);
  });
  it.each([
    "Nome: ARTHUR A M SANTOS Codigo: 0OTHER.900001/01-9",
    "Nome: ARTHUR A M SANTOS Codigo: 0TEST.900001/02-9",
    "Nome: ARTHUR A M SANTOS",
    "Nome: ARTHUR A M COSTA Codigo: 0TEST.900001/01-9",
    "Nome: A A M SANTOS Codigo: 0TEST.900001/01-9",
    "Nome: ARTHUR A M SANTOS Codigo: 10TEST.900001/01-99",
  ])("rejects a different or incomplete identity: %s", text => {
    expect(matches(text)).toBe(false);
  });
  it("retains zeroes and letters in a card code and uses CPF only when no card code is available", () => {
    const withCpf = cardTextMatchPatterns({ ...input, cpf: "12345678901" });
    expect(withCpf.identifiers.some(pattern => new RegExp(pattern).test("codigo: 12345678901"))).toBe(false);
    const cpfOnly = cardTextMatchPatterns({ beneficiaryName: input.beneficiaryName, cpf: "12345678901" });
    expect(cpfOnly.identifiers.some(pattern => new RegExp(pattern).test("cpf: 123.456.789-01"))).toBe(true);
  });
});
