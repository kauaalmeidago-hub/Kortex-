import { describe, expect, it } from "vitest";
import type { OperationRecord } from "../../types.js";
import type { CardListRow } from "./cardList.js";
import { cardRowFingerprint, distinctCardRows, pendingCardBeneficiary } from "./cardBeneficiaryChoice.js";

const row = (index: number, id = String(900000000001 + index)): CardListRow => ({ index, tableIndex: 0, beneficiaryName: "BENEFICIARIO DE TESTE",
  kind: "beneficiary", visible: true, selectable: true, cardIdentifiers: [id], holderReferences: [], text: `BENEFICIARIO DE TESTE ${id}` });
const operation = (): OperationRecord => ({ id: "test", type: "CARD_ISSUE", status: "processing", companyId: "company-1", portal: "ndi",
  credentialRef: "ndi:company-1", input: { beneficiaryName: "BENEFICIARIO DE TESTE", contractCode: "0TEST", periodStart: "2026-01-01", periodEnd: "2026-10-09" },
  artifacts: [], createdAt: "2026-10-09", updatedAt: "2026-10-09" });

describe("card beneficiary identity and chat choice", () => {
  it("collapses only identical copies with a strong identity in the same table", () => {
    const first = row(0), duplicate = { ...first, index: 4 };
    expect(distinctCardRows([first, duplicate, row(1)])).toEqual([first, row(1)]);
    expect(distinctCardRows([first, { ...duplicate, tableIndex: 1 }])).toHaveLength(2);
    expect(distinctCardRows([first, { ...duplicate, text: `${first.text} OUTRO PLANO` }])).toHaveLength(2);
  });
  it("does not collapse two unidentifiable homonyms", () => {
    const first = { ...row(0), cardIdentifiers: [] }, second = { ...first, index: 1 };
    expect(distinctCardRows([first, second])).toHaveLength(2);
    expect(() => pendingCardBeneficiary(operation(), [first, second])).toThrow(/distinguir/);
  });
  it("prefers an actionable copy of an identical identified row", () => {
    const first = { ...row(0), selectable: false }, second = { ...first, index: 2, selectable: true };
    expect(distinctCardRows([first, second])).toEqual([second]);
  });
  it("masks the CPF in the displayed portal description without altering a card number", () => {
    const person = { ...row(0), cpf: "12345678901", text: "CPF 123.456.789-01 / 12345678901 Carteirinha 9123456789012" };
    const option = pendingCardBeneficiary(operation(), [person]).options[0]!;
    expect(option.cpfMasked).toBe("***.***.***-01");
    expect(option.description).toBe("CPF ***.***.***-01 / ***.***.***-01 Carteirinha 9123456789012");
  });
  it("keeps the choice valid across reordered rows and checkbox label changes", () => {
    const first = { ...row(0), identityText: "NOME PLANO 900000000001", text: "NOME Selecionar" };
    expect(cardRowFingerprint(first)).toBe(cardRowFingerprint({ ...first, index: 9, text: "NOME Selecionado" }));
    const op = operation(), initial = pendingCardBeneficiary(op, [first, row(1)]);
    op.result = { cardBeneficiaryConfirmation: { ...initial, selectedOptionId: initial.options[1]!.id } };
    expect(pendingCardBeneficiary(op, [row(1), first])).toBe(op.result.cardBeneficiaryConfirmation);
  });
  it.each(["company", "portal", "period", "identity"])("requests a fresh decision after a change to %s", field => {
    const op = operation(), rows = [row(0), row(1)], initial = pendingCardBeneficiary(op, rows);
    op.result = { cardBeneficiaryConfirmation: { ...initial, selectedOptionId: initial.options[0]!.id } };
    if (field === "company") op.companyId = "another-company";
    if (field === "portal") op.portal = "hapvida";
    if (field === "period") op.input.periodEnd = "2027-01-01";
    if (field === "identity") rows[0] = row(0, "900000000999");
    const next = pendingCardBeneficiary(op, rows);
    expect(next.id).not.toBe(initial.id); expect(next.selectedOptionId).toBeUndefined();
  });
});
