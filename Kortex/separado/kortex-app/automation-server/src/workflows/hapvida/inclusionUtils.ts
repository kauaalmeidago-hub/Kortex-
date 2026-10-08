import { AutomationError } from "../../errors.js";
import { maskCpf, normalizeCpf, normalizeName } from "./exclusionUtils.js";

export interface InclusionDocumentMetadata {
  id?: string;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
}

export interface NormalizedDocumentMetadata extends InclusionDocumentMetadata {
  originalFileName: string;
  normalizedFileName: string;
  extension: string;
}

export interface CnsLookupResult {
  cnsNumber?: string;
  returnedName?: string;
  returnedCpf?: string;
  returnedBirthDate?: string;
}

export interface ReceitaCpfLookupResult {
  cpf?: string;
  name?: string;
  birthDate?: string;
  registrationStatus?: string;
  registrationDate?: string;
  checkDigit?: string;
  controlCode?: string;
}

export interface HealthAnswer {
  questionId: string;
  answer: "yes" | "no";
  detail?: string;
}

const allowedExtensions = new Set(["jpg", "jpeg", "pdf", "doc", "docx"]);

export function normalizeDocumentFileName(fileName: string, usedNames = new Set<string>()) {
  const lastDot = fileName.lastIndexOf(".");
  const rawBase = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  const extension = lastDot > 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";

  if (!allowedExtensions.has(extension)) {
    throw new AutomationError("INVALID_ATTACHMENT_TYPE", "Tipo de anexo invalido.", {
      safeDetails: "A Hapvida aceita JPG, PDF, DOC ou DOCX para este fluxo.",
      step: "validating_documents",
      retryable: false,
    });
  }

  const normalizedBase =
    rawBase
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "") || "documento";

  let candidate = `${normalizedBase}.${extension}`;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${normalizedBase}${suffix}.${extension}`;
    suffix += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

export function validateAndNormalizeDocument(
  document: InclusionDocumentMetadata,
  usedNames = new Set<string>(),
): NormalizedDocumentMetadata {
  if (document.sizeBytes > 2 * 1024 * 1024) {
    throw new AutomationError("ATTACHMENT_TOO_LARGE", "Anexo maior que o limite permitido.", {
      safeDetails: "O portal limita cada arquivo a 2 MB.",
      step: "validating_documents",
      retryable: false,
    });
  }

  const normalizedFileName = normalizeDocumentFileName(document.fileName, usedNames);
  return {
    ...document,
    originalFileName: document.fileName,
    normalizedFileName,
    extension: normalizedFileName.split(".").pop() ?? "",
  };
}

export function validateCnsIdentity(
  expected: { beneficiaryName: string; cpf: string; birthDate: string },
  result: CnsLookupResult,
) {
  if (!result.cnsNumber?.trim()) {
    throw new AutomationError("CNS_NOT_FOUND", "CNS nao encontrado para o beneficiario.", {
      safeDetails: "A consulta do DATASUS/CNES nao retornou numero CNS.",
      step: "checking_cns",
      retryable: false,
    });
  }

  validateIdentity("CNS_IDENTITY_MISMATCH", "checking_cns", expected, {
    name: result.returnedName,
    cpf: result.returnedCpf,
    birthDate: result.returnedBirthDate,
  });
}

export function validateReceitaCpfIdentity(
  expected: { beneficiaryName: string; cpf: string; birthDate: string },
  result: ReceitaCpfLookupResult,
) {
  validateIdentity("CPF_IDENTITY_MISMATCH", "checking_cpf", expected, {
    name: result.name,
    cpf: result.cpf,
    birthDate: result.birthDate,
  });

  const status = normalizeName(result.registrationStatus);
  if (status && !/(^|\s)regular($|\s)/.test(status)) {
    throw new AutomationError("CPF_STATUS_REVIEW_REQUIRED", "Situacao cadastral do CPF exige revisao.", {
      safeDetails: "A Receita Federal retornou uma situacao diferente de regular.",
      step: "checking_cpf",
      retryable: false,
    });
  }
}

export function validateHealthAnswers(input: { healthAllNegativeConfirmed?: boolean; healthAnswers?: HealthAnswer[] }) {
  if (input.healthAllNegativeConfirmed) return;
  const answers = input.healthAnswers ?? [];
  if (answers.length === 0) {
    throw new AutomationError("HEALTH_ANSWERS_REQUIRED", "Declaracao de saude nao informada.", {
      safeDetails: "Informe respostas reais ou confirme explicitamente que todas as respostas sao negativas.",
      step: "filling_health_questionnaire",
      retryable: false,
    });
  }

  for (const answer of answers) {
    if (answer.answer === "yes" && !answer.detail?.trim()) {
      throw new AutomationError("HEALTH_DETAIL_REQUIRED", "Detalhe de saude obrigatorio ausente.", {
        safeDetails: "Respostas positivas da declaracao de saude precisam de detalhe fornecido pelo operador/beneficiario.",
        step: "filling_health_questionnaire",
        retryable: false,
      });
    }
  }
}

export function validateRequiredRegistrationFields(input: Record<string, unknown>, fields: string[]) {
  const missing = fields.filter((field) => {
    const value = input[field];
    return value == null || String(value).trim() === "";
  });

  if (missing.length > 0) {
    throw new AutomationError("MISSING_REQUIRED_DATA", "Dados obrigatorios da inclusao ausentes.", {
      safeDetails: `Campos ausentes: ${missing.join(", ")}.`,
      step: "validate_inclusion_payload",
      retryable: false,
    });
  }
}

export function sanitizeInclusionSummary(input: {
  beneficiaryName: string;
  cpf: string;
  birthDate: string;
  cnsNumber?: string;
  companyId: string;
  unit?: string;
  plan?: string;
  documentCount: number;
}) {
  return {
    companyId: input.companyId,
    beneficiaryName: input.beneficiaryName,
    beneficiaryCpfMasked: maskCpf(input.cpf),
    birthDate: input.birthDate,
    cnsNumber: input.cnsNumber,
    unit: input.unit,
    plan: input.plan,
    documents: input.documentCount,
    healthDeclaration: "Preenchida",
    prepareOnly: true,
  };
}

function validateIdentity(
  code: "CNS_IDENTITY_MISMATCH" | "CPF_IDENTITY_MISMATCH",
  step: string,
  expected: { beneficiaryName: string; cpf: string; birthDate: string },
  actual: { name?: string; cpf?: string; birthDate?: string },
) {
  const expectedCpf = normalizeCpf(expected.cpf);
  const actualCpf = normalizeCpf(actual.cpf);
  if (expectedCpf && actualCpf && expectedCpf !== actualCpf) {
    throw new AutomationError(code, "CPF retornado nao confere.", {
      safeDetails: "O portal externo retornou um CPF diferente do CPF solicitado.",
      step,
      retryable: false,
    });
  }

  const expectedBirthDate = normalizeCpf(expected.birthDate);
  const actualBirthDate = normalizeCpf(actual.birthDate);
  if (expectedBirthDate && actualBirthDate && expectedBirthDate !== actualBirthDate) {
    throw new AutomationError(code, "Data de nascimento retornada nao confere.", {
      safeDetails: "O portal externo retornou uma data de nascimento diferente.",
      step,
      retryable: false,
    });
  }

  const expectedName = normalizeName(expected.beneficiaryName);
  const actualName = normalizeName(actual.name);
  if (expectedName && actualName && actualName !== expectedName) {
    throw new AutomationError(code, "Nome retornado nao confere.", {
      safeDetails: "O portal externo retornou um nome diferente do beneficiario solicitado.",
      step,
      retryable: false,
    });
  }
}
