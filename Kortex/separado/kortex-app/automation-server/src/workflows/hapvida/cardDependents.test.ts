import { describe, expect, it } from "vitest";
import { findCardDependents, pendingCardDependents } from "./cardDependents.js";
import type { CardListRow } from "./cardList.js";
import type { OperationRecord } from "../../types.js";

const row = (index: number, name: string, patch: Partial<CardListRow> = {}): CardListRow => ({ index, beneficiaryName: name,
  kind: "beneficiary", visible: true, selectable: true, tableIndex: 0, cardIdentifiers: [String(900000 + index)], holderReferences: [], ...patch });
const holder = row(0, "TITULAR DE TESTE", { memberType: "holder" });
const child = row(1, "DEPENDENTE DE TESTE", { memberType: "dependent" });

describe("card dependent relationship", () => {
  it("does not infer a relationship from an untyped row below the beneficiary", () => {
    expect(findCardDependents([row(0, holder.beneficiaryName), row(1, child.beneficiaryName)], 0)).toEqual([]);
  });
  it("uses explicit holder identifiers even when rows are out of order", () => {
    const linked = row(1, child.beneficiaryName, { holderReferences: ["900000"] });
    expect(findCardDependents([linked, holder, row(2, "OUTRA PESSOA", { holderReferences: ["900999"] })], 0)).toEqual([linked]);
  });
  it("limits typed dependent groups to their holder", () => {
    expect(findCardDependents([holder, child, row(2, "OUTRO TITULAR", { memberType: "holder" }), row(3, "OUTRO DEPENDENTE", { memberType: "dependent" })], 0)).toEqual([child]);
  });
  it("does not include a dependent explicitly linked to another holder", () => {
    expect(findCardDependents([holder, { ...child, holderReferences: ["900999"] }, row(2, "OUTRO DEPENDENTE", { memberType: "dependent" })], 0)).toEqual([]);
  });
  it("does not carry an adjacent group across an unidentified row or another table", () => {
    expect(findCardDependents([holder, row(1, "", { kind: "unknown" }), { ...child, index: 2 }, { ...child, index: 3, tableIndex: 1 }], 0)).toEqual([]);
  });
  it("does not expand a request for one dependent into their siblings", () => {
    expect(findCardDependents([holder, child, { ...child, index: 2 }], 1)).toEqual([]);
  });
  it("blocks a name-only relationship when two holders have the same name", () => {
    expect(() => findCardDependents([holder, row(1, holder.beneficiaryName), row(2, child.beneficiaryName, { holderName: holder.beneficiaryName })], 0))
      .toThrowError(expect.objectContaining({ code: "BENEFICIARY_AMBIGUOUS" }));
  });
});

describe("dependent approval binding", () => {
  const operation = { companyId: "company-1", portal: "ndi", input: { contractCode: "0TEST", beneficiaryName: holder.beneficiaryName,
    periodStart: "2026-01-01", periodEnd: "2026-10-09" } } as OperationRecord;
  it("keeps a choice only for the same company, code, dates and family identities", () => {
    const pending = pendingCardDependents(operation, holder, [child]);
    const approved = { ...pending, decision: "with" as const, approvedBy: "user-1" };
    const saved = { ...operation, result: { cardDependentConfirmation: approved } };
    expect(pendingCardDependents(saved, holder, [child])).toEqual(approved);
    for (const changed of [
      { ...saved, companyId: "company-2" }, { ...saved, portal: "hapvida" as const },
      { ...saved, input: { ...saved.input, contractCode: "0OTHER" } },
      { ...saved, input: { ...saved.input, periodEnd: "2026-10-10" } },
    ]) expect(pendingCardDependents(changed, holder, [child]).decision).toBeUndefined();
    expect(pendingCardDependents(saved, holder, [{ ...child, cardIdentifiers: ["999999"] }]).decision).toBeUndefined();
    expect(pendingCardDependents(saved, holder, []).decision).toBeUndefined();
  });
  it("does not request another choice just because the same dependents were reordered", () => {
    const other = row(2, "SEGUNDO DEPENDENTE");
    const pending = pendingCardDependents(operation, holder, [child, other]);
    const saved = { ...operation, result: { cardDependentConfirmation: { ...pending, decision: "without" } } };
    expect(pendingCardDependents(saved, holder, [other, child]).id).toBe(pending.id);
  });
});
