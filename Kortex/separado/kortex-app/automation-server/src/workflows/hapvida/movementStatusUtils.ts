import { AutomationError } from "../../errors.js";
import { normalizeCpf, normalizeName } from "./exclusionUtils.js";

export type MovementStatusWorkflow =
  | "INCLUSION_HOLDER"
  | "INCLUSION_DEPENDENT"
  | "EXCLUSION_HOLDER"
  | "EXCLUSION_DEPENDENT";

export interface MovementStatusLegendItem {
  code: string;
  label: string;
}

export interface MovementStatusRecord {
  rowIndex?: number;
  section?: string;
  operationType?: string;
  beneficiaryName?: string;
  beneficiaryCpf?: string;
  companyName?: string;
  date?: string;
  userCode?: string;
  enrollment?: string;
  portalStatusCode?: string;
  portalStatusLabel?: string;
  rawText: string;
}

export interface MovementStatusMatchInput {
  workflow: MovementStatusWorkflow;
  beneficiaryName?: string;
  beneficiaryCpf?: string;
  companyName?: string;
  date?: string;
  userCode?: string;
  enrollment?: string;
}

const workflowLabelPatterns: Record<MovementStatusWorkflow, RegExp> = {
  INCLUSION_HOLDER: /inclus[aã]o\s+de\s+titular|inclus[aã]o.*titular/i,
  INCLUSION_DEPENDENT: /inclus[aã]o\s+de\s+dependente|inclus[aã]o.*dependente/i,
  EXCLUSION_HOLDER: /pr[eé]-?cancelamento\s+de\s+titular|cancelamento.*titular/i,
  EXCLUSION_DEPENDENT: /pr[eé]-?cancelamento\s+de\s+dependente|cancelamento.*dependente/i,
};

export function parseStatusLegend(text: string): MovementStatusLegendItem[] {
  const normalized = text.replace(/\s+/g, " ");
  const matches = [...normalized.matchAll(/\b(\d{1,2})\s*[-–]\s*([^\d]+?)(?=\s+\d{1,2}\s*[-–]|$)/g)];

  return matches
    .map((match) => ({
      code: match[1]!.trim(),
      label: match[2]!.trim().replace(/[.;,]+$/g, ""),
    }))
    .filter((item) => item.label.length > 0);
}

export function parseMovementStatusRecord(input: {
  rowIndex?: number;
  section?: string;
  rawText: string;
  legend?: MovementStatusLegendItem[];
}): MovementStatusRecord {
  const rawText = input.rawText.replace(/\s+/g, " ").trim();
  const cpfMatch = /(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/.exec(rawText);
  const dateMatch = /(\d{2}\/\d{2}\/\d{4})/.exec(rawText);
  const statusCode = readStatusCode(rawText, input.legend);
  const statusLabel = statusCode ? input.legend?.find((item) => item.code === statusCode)?.label ?? readInlineStatusLabel(rawText) : readInlineStatusLabel(rawText);

  return {
    rowIndex: input.rowIndex,
    section: input.section,
    operationType: input.section ?? readOperationType(rawText),
    beneficiaryName: readBeneficiaryName(rawText),
    beneficiaryCpf: cpfMatch?.[1],
    date: dateMatch?.[1],
    userCode: readLabel(rawText, /c[oó]digo/i),
    enrollment: readLabel(rawText, /matr[ií]cula/i),
    portalStatusCode: statusCode,
    portalStatusLabel: statusLabel,
    rawText,
  };
}

export function findMovementStatusRecord(records: MovementStatusRecord[], input: MovementStatusMatchInput) {
  const expectedCpf = normalizeCpf(input.beneficiaryCpf);
  const expectedName = normalizeName(input.beneficiaryName);
  const expectedCompany = normalizeName(input.companyName);
  const expectedUserCode = normalizeName(input.userCode);
  const expectedEnrollment = normalizeName(input.enrollment);
  const workflowPattern = workflowLabelPatterns[input.workflow];

  const matches = records.filter((record) => {
    const text = normalizeName(`${record.operationType ?? ""} ${record.section ?? ""} ${record.rawText}`);
    if (!workflowPattern.test(record.operationType ?? record.section ?? record.rawText)) return false;
    if (expectedCpf && normalizeCpf(record.beneficiaryCpf ?? record.rawText) !== expectedCpf && !normalizeCpf(record.rawText).includes(expectedCpf)) {
      return false;
    }
    if (!expectedCpf && expectedName && !normalizeName(record.beneficiaryName ?? record.rawText).includes(expectedName)) return false;
    if (expectedCompany && !text.includes(expectedCompany)) return false;
    if (input.date && record.date && record.date !== input.date) return false;
    if (expectedUserCode && !normalizeName(record.userCode ?? record.rawText).includes(expectedUserCode)) return false;
    if (expectedEnrollment && !normalizeName(record.enrollment ?? record.rawText).includes(expectedEnrollment)) return false;
    return true;
  });

  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new AutomationError("BENEFICIARY_AMBIGUOUS", "Mais de uma movimentacao correspondente foi encontrada.", {
      safeDetails: "Use CPF, matricula, codigo ou data para eliminar a ambiguidade no Status Movimentacao.",
      step: "checking_movement_status",
      retryable: false,
    });
  }

  return undefined;
}

export function expectedMovementLabel(workflow: MovementStatusWorkflow) {
  return {
    INCLUSION_HOLDER: "Inclusao de Titular",
    INCLUSION_DEPENDENT: "Inclusao de Dependente",
    EXCLUSION_HOLDER: "Pre-cancelamento de Titular",
    EXCLUSION_DEPENDENT: "Pre-cancelamento de Dependente",
  }[workflow];
}

function readStatusCode(text: string, legend: MovementStatusLegendItem[] | undefined) {
  const inlineStatus = /(?:status|situa[cç][aã]o)\s*:?\s*(\d{1,2})\b/i.exec(text);
  if (inlineStatus?.[1]) return inlineStatus[1];

  if (!legend?.length) return undefined;
  const surroundedCode = /(?:^|\D)(\d{1,2})(?:\D|$)/g;
  for (const match of text.matchAll(surroundedCode)) {
    const code = match[1];
    if (legend.some((item) => item.code === code)) return code;
  }

  return undefined;
}

function readInlineStatusLabel(text: string) {
  const match = /(?:status|situa[cç][aã]o)\s*:?\s*(?:\d{1,2}\s*[-–]?\s*)?([A-Za-zÀ-ÿ\s]+?)(?:\s{2,}|$)/i.exec(text);
  return match?.[1]?.trim();
}

function readOperationType(text: string) {
  const known = [
    /pr[eé]-?cancelamento\s+de\s+titular/i,
    /pr[eé]-?cancelamento\s+de\s+dependente/i,
    /inclus[aã]o\s+de\s+titular/i,
    /inclus[aã]o\s+de\s+dependente/i,
  ];

  for (const pattern of known) {
    const match = pattern.exec(text);
    if (match?.[0]) return match[0];
  }

  return undefined;
}

function readBeneficiaryName(text: string) {
  const labelled = readLabel(text, /nome|benefici[aá]rio|usu[aá]rio/i);
  if (labelled) return labelled;

  const chunks = text
    .split(/\s{2,}|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
  return chunks.find((part) => /[A-Za-zÀ-ÿ]{3}/.test(part) && !/\d{2}\/\d{2}\/\d{4}|status|movimenta[cç][aã]o/i.test(part));
}

function readLabel(text: string, label: RegExp) {
  const match = new RegExp(`${label.source}\\s*:?\\s*([^|;\\n]+?)(?=\\s*\\||\\s{2,}|\\s+[A-Za-zÀ-ÿ ]+\\s*:|$)`, "i").exec(text);
  return match?.[1]?.trim();
}
