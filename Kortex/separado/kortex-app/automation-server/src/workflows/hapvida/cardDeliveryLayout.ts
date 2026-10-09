import { AutomationError } from "../../errors.js";
import type { CardBeneficiary } from "./cardPreview.js";
import type { CardListRow } from "./cardList.js";
import { findCardDependents } from "./cardDependents.js";
import { cardRowFingerprint, distinctCardRows } from "./cardBeneficiaryChoice.js";

export interface CardDeliveryMember extends CardBeneficiary {
  id: string;
  role: "holder" | "dependent" | "beneficiary";
  holderId?: string;
}

export interface CardDeliveryPage {
  template: "single" | "first" | "continuation";
  members: CardDeliveryMember[];
}

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f\u00ad\u200b-\u200d\ufeff]/g, "")
  .replace(/\s+/g, " ").trim().toLowerCase();
const rowId = (row: CardListRow) => `row-${row.tableIndex}-${row.index}`;

export function describeCardDeliveryMembers(rows: CardListRow[], selected: CardBeneficiary[]): CardDeliveryMember[] {
  rows = distinctCardRows(rows);
  const people = rows.filter(row => row.visible && row.kind === "beneficiary");
  const parents = new Map<number, CardListRow>();
  const holders = new Set<number>();
  for (const primary of people.filter(row => row.memberType !== "dependent")) {
    for (const dependent of findCardDependents(rows, primary.index)) {
      const existing = parents.get(dependent.index);
      if (existing && existing.index !== primary.index) throw new AutomationError("CARD_FAMILY_MAPPING_FAILED", "O portal vinculou um dependente a mais de um titular.", { step: "organize_card_delivery" });
      parents.set(dependent.index, primary); holders.add(primary.index);
    }
  }
  return selected.map(input => {
    let candidates = people.filter(row => normalize(row.beneficiaryName) === normalize(input.beneficiaryName));
    const rowFingerprint = (input as CardBeneficiary & { rowFingerprint?: string }).rowFingerprint;
    if (rowFingerprint) candidates = candidates.filter(row => cardRowFingerprint(row) === rowFingerprint);
    if (input.cardIdentifiers?.length) candidates = candidates.filter(row => [...(row.cardIdentifiers ?? []), ...(row.cpf ? [row.cpf] : [])].some(id => input.cardIdentifiers!.includes(id)));
    if (input.cpf) candidates = candidates.filter(row => !row.cpf || row.cpf === input.cpf!.replace(/\D/g, ""));
    if (candidates.length !== 1) throw new AutomationError("CARD_FAMILY_MAPPING_FAILED", "Nao foi possivel conferir a identidade para organizar as carteirinhas.", { step: "organize_card_delivery" });
    const row = candidates[0]!, parent = parents.get(row.index);
    return { ...input, id: rowId(row), role: parent || row.memberType === "dependent" ? "dependent"
      : row.memberType === "holder" || holders.has(row.index) ? "holder" : "beneficiary",
      ...(parent ? { holderId: rowId(parent) } : {}) };
  });
}

export function paginateCardDelivery(members: CardDeliveryMember[]): CardDeliveryPage[] {
  if (!members.length || new Set(members.map(member => member.id)).size !== members.length) {
    throw new AutomationError("CARD_FAMILY_MAPPING_FAILED", "A selecao de carteirinhas esta vazia ou repetida.", { step: "organize_card_delivery" });
  }
  if (members.length === 1) return [{ template: "single", members }];
  const byId = new Map(members.map(member => [member.id, member]));
  for (const member of members.filter(member => member.role === "dependent")) {
    if (!member.holderId || byId.get(member.holderId)?.role !== "holder") {
      throw new AutomationError("CARD_FAMILY_MAPPING_FAILED", "O portal nao identificou o titular de uma carteirinha dependente neste lote.", { step: "organize_card_delivery" });
    }
  }
  const layouts: CardDeliveryMember[][] = [];
  let standalone: CardDeliveryMember[] = [];
  const flush = () => { if (standalone.length) { layouts.push(standalone); standalone = []; } };
  for (const member of members.filter(member => member.role !== "dependent")) {
    const dependents = members.filter(candidate => candidate.holderId === member.id && candidate.role === "dependent");
    if (dependents.length) {
      flush();
      // One complete dependent card per box keeps every field legible; repeat their own holder above it.
      for (const dependent of dependents) layouts.push([member, dependent]);
    } else {
      standalone.push(member);
      if (standalone.length === 2) flush();
    }
  }
  flush();
  const covered = new Set(layouts.flat().map(member => member.id));
  if (covered.size !== members.length) throw new AutomationError("CARD_FAMILY_MAPPING_FAILED", "Uma carteirinha ficou fora da organizacao do lote.", { step: "organize_card_delivery" });
  return layouts.map((members, index) => ({ template: index === 0 ? "first" : "continuation", members }));
}
