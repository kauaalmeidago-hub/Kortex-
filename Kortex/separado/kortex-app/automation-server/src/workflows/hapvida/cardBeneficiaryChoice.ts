import { createHash, randomUUID } from "node:crypto";
import { AutomationError } from "../../errors.js";
import { portalLoginCode } from "../../credentials/credentialIdentity.js";
import type { OperationRecord } from "../../types.js";
import type { CardListRow } from "./cardList.js";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f\u00ad\u200b-\u200d\ufeff]/g, "")
  .replace(/\s+/g, " ").trim().toLowerCase();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function cardRowFingerprint(row: CardListRow) {
  return hash([row.tableIndex, normalize(row.beneficiaryName), row.cpf ?? "", [...(row.cardIdentifiers ?? [])].sort(),
    row.memberType ?? "", [...row.holderReferences].sort(), normalize(row.holderName ?? ""), normalize(row.identityText ?? row.text ?? "")]);
}

// Only identical, identified rows in the same table may represent a repeated copy of one card.
export function distinctCardRows(rows: CardListRow[]): CardListRow[] {
  const seen = new Map<string, number>();
  const output: CardListRow[] = [];
  for (const row of rows) {
    if (!row.visible || row.kind !== "beneficiary" || (!row.cpf && !row.cardIdentifiers?.length)) { output.push(row); continue; }
    const key = cardRowFingerprint(row), existing = seen.get(key);
    if (existing === undefined) { seen.set(key, output.length); output.push(row); }
    else if (row.selectable && !output[existing]!.selectable) output[existing] = row;
  }
  return output;
}

export interface CardBeneficiaryOption {
  id: string;
  beneficiaryName: string;
  cardNumbers: string[];
  cpfMasked?: string;
  description: string;
}
export interface CardBeneficiaryConfirmation {
  id: string;
  fingerprint: string;
  beneficiaryName: string;
  options: CardBeneficiaryOption[];
  selectedOptionId?: string;
  approvedBy?: string;
  approvedAt?: string;
}

export function pendingCardBeneficiary(operation: OperationRecord, rows: CardListRow[]): CardBeneficiaryConfirmation {
  const options = rows.map(row => {
    const cpfMasked = row.cpf ? `***.***.***-${row.cpf.slice(-2)}` : undefined;
    let description = row.text ?? row.beneficiaryName;
    if (row.cpf && cpfMasked) description = description.replace(
      new RegExp(`(?<!\\d)${row.cpf.split("").join("[.\\s-]*")}(?!\\d)`, "g"), cpfMasked);
    return { id: cardRowFingerprint(row), beneficiaryName: row.beneficiaryName,
      cardNumbers: row.cardIdentifiers ?? [], cpfMasked, description: description.slice(0, 600) };
  });
  if (!options.length || new Set(options.map(option => option.id)).size !== options.length) {
    throw new AutomationError("BENEFICIARY_AMBIGUOUS", "O portal retornou registros sem dados suficientes para distinguir as carteirinhas.", {
      safeDetails: "Informe o CPF ou o numero da carteirinha no formulario de emissao para identificar o registro correto.", step: "find_beneficiary", retryable: true,
    });
  }
  const fingerprint = hash([operation.companyId, operation.portal, portalLoginCode(operation.input), operation.input.beneficiaryName,
    operation.input.cpf, operation.input.cardNumber, operation.input.birthDate,
    operation.input.periodStart ?? operation.input.startDate, operation.input.periodEnd ?? operation.input.endDate,
    options.map(option => option.id).sort()]);
  const previous = operation.result?.cardBeneficiaryConfirmation as CardBeneficiaryConfirmation | undefined;
  if (previous?.fingerprint === fingerprint) return previous;
  return { id: randomUUID(), fingerprint, beneficiaryName: String(operation.input.beneficiaryName), options };
}
