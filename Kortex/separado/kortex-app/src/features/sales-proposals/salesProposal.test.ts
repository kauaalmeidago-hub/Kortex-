import { describe, expect, it, vi } from "vitest";
import { buildProposalText, createSalesDraft, parseMonthlyCents, proposalIssues, type SalesClient } from "./salesProposal";

const client: SalesClient = { conversationId: "client-a", name: "Paulo", company: "Empresa A", city: "Belo Horizonte", state: "MG", messages: [] };
const now = new Date("2026-10-22T12:00:00Z");

function completeDraft() {
  const draft = createSalesDraft(client);
  return { ...draft, modality: "PME", lives: "12", quotes: [{ ...draft.quotes[0], insurer: "Operadora da cotação",
    plan: "Produto cotado", monthlyAmount: "1.234,56", source: "Protocolo 123", validUntil: "2026-10-22", conditions: "Condições conferidas no protocolo." }] };
}

describe("apresentação comercial", () => {
  it("permite abrir rascunhos na prévia HTTP sem randomUUID", () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    try { expect(createSalesDraft(client).quotes[0].id).toBeTruthy(); }
    finally { vi.unstubAllGlobals(); }
  });
  it.each([["1.234,56", 123456], ["1234,5", 123450], ["R$ 125,00", 12500], ["0", null], ["1.23", null], ["1,234", null], ["-12,00", null]])(
    "interpreta %s sem arredondar nem adivinhar o formato", (input, expected) => expect(parseMonthlyCents(String(input))).toBe(expected),
  );

  it("não transforma funcionários em vidas confirmadas", () => {
    const draft = createSalesDraft({ ...client, messages: [{ id: "a", text: "Tenho 12 funcionários", fromMe: false }] });
    expect(draft.lives).toBe("");
    expect(() => buildProposalText(client, draft, now)).toThrow("PROPOSAL_INCOMPLETE");
  });

  it("gera apresentação apenas com cotação vigente, valores e condições identificadas", () => {
    const draft = completeDraft();
    expect(proposalIssues(draft, now)).toEqual([]);
    const text = buildProposalText(client, draft, now);
    expect(text).toContain("Paulo");
    expect(text).toContain("1.234,56");
    expect(text).toContain("Protocolo 123");
    expect(text).toContain("22/10/2026");
    expect(text).toContain("formalização pela operadora");
  });

  it("bloqueia cotações vencidas, datas impossíveis e valores sem origem", () => {
    for (const patch of [{ validUntil: "2026-10-21" }, { validUntil: "2026-02-30" }, { source: "" }, { monthlyAmount: "a confirmar" }]) {
      const draft = completeDraft();
      draft.quotes[0] = { ...draft.quotes[0], ...patch };
      expect(proposalIssues(draft, now).length).toBeGreaterThan(0);
      expect(() => buildProposalText(client, draft, now)).toThrow();
    }
  });
});
