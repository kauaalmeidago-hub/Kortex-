import { createHash, randomUUID } from "node:crypto";
import { AutomationError } from "../../errors.js";
import { portalLoginCode } from "../../credentials/credentialIdentity.js";
import type { OperationRecord } from "../../types.js";
import type { CardBeneficiary } from "./cardPreview.js";
import type { CardListRow } from "./cardList.js";

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export interface CardDependentConfirmation {
  id: string;
  fingerprint: string;
  beneficiaryName: string;
  dependentNames: string[];
  decision?: "with" | "without";
  approvedBy?: string;
  approvedAt?: string;
}

export function findCardDependents(rows: CardListRow[], primaryIndex: number): CardListRow[] {
  const primary = rows.find(row => row.index === primaryIndex);
  if (!primary || primary.memberType === "dependent") return [];
  const group = rows.filter(row => row.visible && row.kind !== "header" && row.kind !== "bulk" && row.tableIndex === primary.tableIndex);
  const homonyms = group.filter(row => normalize(row.beneficiaryName) === normalize(primary.beneficiaryName));
  const identities = new Set(primary.cardIdentifiers ?? []);
  let adjacent = primary.memberType === "holder";
  const found: CardListRow[] = [];
  for (const row of group) {
    if (row.index === primary.index) continue;
    if (row.kind !== "beneficiary") { if (row.index > primary.index) adjacent = false; continue; }
    const linkedCode = row.holderReferences.some(reference => identities.has(reference));
    const linkedName = Boolean(!row.holderReferences.length && row.holderName && normalize(row.holderName) === normalize(primary.beneficiaryName));
    if (linkedName && !linkedCode && homonyms.length > 1) {
      throw new AutomationError("BENEFICIARY_AMBIGUOUS", "O portal nao identificou a qual titular pertencem os dependentes.", { step: "find_beneficiary" });
    }
    if (row.index > primary.index && (row.memberType !== "dependent" ||
      (row.holderReferences.length && !linkedCode) || (row.holderName && !linkedName))) adjacent = false;
    // Position alone is not evidence: only an explicit relationship or a typed holder/dependent group is accepted.
    if (row.memberType !== "holder" && (linkedCode || linkedName || (row.index > primary.index && adjacent && row.memberType === "dependent" && !row.holderReferences.length && !row.holderName))) found.push(row);
  }
  return found;
}

export function cardFamilyFingerprint(operation: OperationRecord, beneficiary: CardBeneficiary, dependents: CardBeneficiary[]) {
  const identity = (person: CardBeneficiary) => [normalize(person.beneficiaryName), person.cpf?.replace(/\D/g, "") ?? "",
    [...(person.cardIdentifiers ?? [])].sort(), person.birthDate ?? ""];
  const family = dependents.map(identity).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify([operation.companyId, operation.portal, portalLoginCode(operation.input),
    operation.input.beneficiaryName, operation.input.cpf, operation.input.birthDate,
    operation.input.periodStart ?? operation.input.startDate, operation.input.periodEnd ?? operation.input.endDate,
    identity(beneficiary), family])).digest("hex");
}

export function pendingCardDependents(operation: OperationRecord, beneficiary: CardBeneficiary, dependents: CardBeneficiary[]) {
  const fingerprint = cardFamilyFingerprint(operation, beneficiary, dependents);
  const previous = operation.result?.cardDependentConfirmation as CardDependentConfirmation | undefined;
  if (previous?.fingerprint === fingerprint) return previous;
  return { id: randomUUID(), fingerprint, beneficiaryName: beneficiary.beneficiaryName,
    dependentNames: dependents.map(person => person.beneficiaryName) } satisfies CardDependentConfirmation;
}
