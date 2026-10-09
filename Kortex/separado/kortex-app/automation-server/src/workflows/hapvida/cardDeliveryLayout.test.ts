import { describe, expect, it } from "vitest";
import { describeCardDeliveryMembers, paginateCardDelivery, type CardDeliveryMember } from "./cardDeliveryLayout.js";
import type { CardListRow } from "./cardList.js";

const row = (index: number, name: string, patch: Partial<CardListRow> = {}): CardListRow => ({ index, beneficiaryName: name,
  cardIdentifiers: [String(900000000001 + index)], kind: "beneficiary", visible: true, selectable: true, tableIndex: 0, holderReferences: [], ...patch });
const member = (id: string, role: CardDeliveryMember["role"], holderId?: string): CardDeliveryMember => ({ id, role, beneficiaryName: id, ...(holderId ? { holderId } : {}) });

describe("card delivery family mapping", () => {
  it("uses the actual holder identifier when dependents precede the holder", () => {
    const holder = row(1, "TITULAR TESTE", { memberType: "holder" });
    const child = row(0, "DEPENDENTE TESTE", { memberType: "dependent", holderReferences: holder.cardIdentifiers! });
    const result = describeCardDeliveryMembers([child, holder], [child, holder]);
    expect(result[0]).toMatchObject({ role: "dependent", holderId: result[1]!.id });
    expect(result[1]!.role).toBe("holder");
  });
  it("keeps homonymous holders in different families using their card numbers", () => {
    const a = row(0, "TITULAR TESTE", { memberType: "holder" }), b = row(1, "TITULAR TESTE", { memberType: "holder" });
    const child = row(2, "DEPENDENTE TESTE", { memberType: "dependent", holderReferences: b.cardIdentifiers! });
    const result = describeCardDeliveryMembers([a, b, child], [a, b, child]);
    expect(result[2]!.holderId).toBe(result[1]!.id);
    expect(result[2]!.holderId).not.toBe(result[0]!.id);
  });
  it("does not label an unrelated row below a holder as a dependent", () => {
    const holder = row(0, "TITULAR TESTE", { memberType: "holder" }), unknown = row(1, "OUTRA PESSOA");
    const result = describeCardDeliveryMembers([holder, unknown], [holder, unknown])[1]!;
    expect(result.role).toBe("beneficiary"); expect(result.holderId).toBeUndefined();
  });
  it("infers a holder only from an explicit family relationship", () => {
    const holder = row(0, "TITULAR TESTE"), child = row(1, "DEPENDENTE TESTE", { holderReferences: holder.cardIdentifiers! });
    expect(describeCardDeliveryMembers([holder, child], [holder, child]).map(member => member.role)).toEqual(["holder", "dependent"]);
  });
  it("rejects a beneficiary linked to two distinct holders", () => {
    const a = row(0, "TITULAR PRIMEIRO"), b = row(1, "TITULAR SEGUNDO");
    const child = row(2, "DEPENDENTE TESTE", { holderReferences: [...a.cardIdentifiers!, ...b.cardIdentifiers!] });
    expect(() => describeCardDeliveryMembers([a, b, child], [a, b, child])).toThrowError(expect.objectContaining({ code: "CARD_FAMILY_MAPPING_FAILED" }));
  });
  it("rejects an identity that changed before printing", () => {
    const original = row(0, "PESSOA TESTE");
    expect(() => describeCardDeliveryMembers([{ ...original, cardIdentifiers: ["999999999999"] }], [original]))
      .toThrowError(expect.objectContaining({ code: "CARD_FAMILY_MAPPING_FAILED" }));
  });
});

describe("branded card pagination", () => {
  it.each(["holder", "dependent", "beneficiary"] as const)("uses the single-card design for a requested %s", role => {
    expect(paginateCardDelivery([member("one", role)])).toEqual([{ template: "single", members: [member("one", role)] }]);
  });
  it("keeps each dependent below their own holder on continuation pages", () => {
    const a = member("holder-a", "holder"), b = member("holder-b", "holder");
    const pages = paginateCardDelivery([member("child-b", "dependent", b.id), a, member("child-a1", "dependent", a.id), b, member("child-a2", "dependent", a.id)]);
    expect(pages.map(page => page.template)).toEqual(["first", "continuation", "continuation"]);
    expect(pages.map(page => page.members.map(member => member.id))).toEqual([[a.id, "child-a1"], [a.id, "child-a2"], [b.id, "child-b"]]);
  });
  it("pairs standalone holders without calling the second one a dependent", () => {
    const result = paginateCardDelivery([member("holder-a", "holder"), member("holder-b", "holder")]);
    expect(result[0]!.members.map(member => member.role)).toEqual(["holder", "holder"]);
  });
  it("keeps unknown relationships independent rather than inventing family groups", () => {
    const result = paginateCardDelivery([member("one", "beneficiary"), member("two", "beneficiary"), member("three", "beneficiary")]);
    expect(result.map(page => page.members.map(member => member.id))).toEqual([["one", "two"], ["three"]]);
  });
  it("blocks a dependent whose holder is absent from a multi-card selection", () => {
    expect(() => paginateCardDelivery([member("one", "holder"), member("child", "dependent", "different-holder")]))
      .toThrowError(expect.objectContaining({ code: "CARD_FAMILY_MAPPING_FAILED" }));
  });
  it.each([{ members: [] }, { members: [member("one", "holder"), member("one", "holder")] }])("rejects empty or duplicate selections", ({ members }) => {
    expect(() => paginateCardDelivery(members)).toThrowError(expect.objectContaining({ code: "CARD_FAMILY_MAPPING_FAILED" }));
  });
});
