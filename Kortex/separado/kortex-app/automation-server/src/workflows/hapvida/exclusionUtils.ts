import { AutomationError } from "../../errors.js";

export interface ActiveUserCandidate {
  rowIndex?: number;
  type?: string;
  name?: string;
  cpf?: string;
  registration?: string;
  code?: string;
  plan?: string;
  rawText?: string;
}

export interface CancellationReasonOption {
  value: string;
  label: string;
}

export interface AttachmentMetadata {
  id?: string;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
}

export function normalizeCpf(value: string | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

export function maskCpf(value: string | undefined) {
  const digits = normalizeCpf(value);
  if (digits.length < 5) return digits ? "***" : "";
  return `${digits.slice(0, 3)}******${digits.slice(-2)}`;
}

export function normalizeName(value: string | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeReason(value: string | undefined) {
  return normalizeName(value);
}

export function sanitizePortalFileName(fileName: string) {
  const clean = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return clean.slice(0, 120) || "documento";
}

export function validateAttachmentMetadata(attachment: AttachmentMetadata) {
  const allowedExtensions = new Set(["jpg", "jpeg", "pdf", "doc", "docx"]);
  const extension = attachment.fileName.split(".").pop()?.toLowerCase();

  if (!extension || !allowedExtensions.has(extension)) {
    throw new AutomationError("INVALID_ATTACHMENT_TYPE", "Tipo de anexo invalido.", {
      safeDetails: "A Hapvida aceita JPG, PDF, DOC ou DOCX para este fluxo.",
      step: "validate_attachment",
      retryable: false,
    });
  }

  if (attachment.sizeBytes > 2 * 1024 * 1024) {
    throw new AutomationError("ATTACHMENT_TOO_LARGE", "Anexo maior que o limite permitido.", {
      safeDetails: "O portal limita cada arquivo a 2 MB.",
      step: "validate_attachment",
      retryable: false,
    });
  }

  return {
    ...attachment,
    portalFileName: sanitizePortalFileName(attachment.fileName),
  };
}

export function findSingleHolderCandidate(
  candidates: ActiveUserCandidate[],
  input: { beneficiaryName: string; beneficiaryCpf?: string },
) {
  const expectedCpf = normalizeCpf(input.beneficiaryCpf);
  const expectedName = normalizeName(input.beneficiaryName);
  const holders = candidates.filter((candidate) => {
    const type = normalizeName(candidate.type ?? candidate.rawText);
    return type.includes("titular") && !type.includes("dependente");
  });

  if (expectedCpf) {
    const byCpf = holders.filter((candidate) => {
      const candidateCpf = normalizeCpf(candidate.cpf);
      const rawDigits = normalizeCpf(candidate.rawText);
      return candidateCpf === expectedCpf || rawDigits.includes(expectedCpf);
    });

    if (byCpf.length === 1) return assertHolderHasCode(byCpf[0]!);
    if (byCpf.length > 1) {
      throw new AutomationError("BENEFICIARY_AMBIGUOUS", "Mais de um titular encontrado.", {
        safeDetails: "O CPF informado retornou mais de um titular na lista de usuarios ativos.",
        step: "locate_holder",
        retryable: false,
      });
    }
  }

  const byName = holders.filter((candidate) => {
    const candidateName = normalizeName(candidate.name ?? candidate.rawText);
    return candidateName.includes(expectedName) || expectedName.includes(candidateName);
  });

  if (byName.length === 1) return assertHolderHasCode(byName[0]!);
  if (byName.length > 1) {
    throw new AutomationError("BENEFICIARY_AMBIGUOUS", "Mais de um titular encontrado.", {
      safeDetails: "Informe um CPF exato para eliminar a ambiguidade.",
      step: "locate_holder",
      retryable: false,
    });
  }

  throw new AutomationError("BENEFICIARY_NOT_FOUND", "Titular nao encontrado.", {
    safeDetails: "Nenhum titular ativo corresponde ao nome e CPF informados.",
    step: "locate_holder",
    retryable: false,
  });
}

export function mapCancellationReasonOption(options: CancellationReasonOption[], requestedReason: string) {
  const requested = normalizeReason(requestedReason);
  const realOptions = options.filter((option) => normalizeReason(option.label) && !/selecione|selecionar/.test(normalizeReason(option.label)));
  const exact = realOptions.find((option) => normalizeReason(option.label) === requested || normalizeReason(option.value) === requested);
  if (exact) return exact;

  const partial = realOptions.find((option) => {
    const label = normalizeReason(option.label);
    return label.includes(requested) || requested.includes(label);
  });
  if (partial) return partial;

  throw new AutomationError("CANCELLATION_REASON_REQUIRED", "Motivo de cancelamento nao encontrado no portal.", {
    safeDetails: "O motivo informado precisa existir na lista carregada pela Hapvida.",
    step: "select_cancellation_reason",
    retryable: false,
  });
}

export function validateContractIdentity(expected: { beneficiaryName: string; beneficiaryCpf?: string }, actual: { name?: string; cpf?: string }) {
  const expectedCpf = normalizeCpf(expected.beneficiaryCpf);
  const actualCpf = normalizeCpf(actual.cpf);

  if (expectedCpf && actualCpf && expectedCpf !== actualCpf) {
    throw new AutomationError("BENEFICIARY_VALIDATION_FAILED", "CPF do titular retornado nao confere.", {
      safeDetails: "O portal retornou um CPF diferente do CPF solicitado.",
      step: "validate_contract",
      retryable: false,
    });
  }

  const expectedName = normalizeName(expected.beneficiaryName);
  const actualName = normalizeName(actual.name);
  if (expectedName && actualName && !actualName.includes(expectedName) && !expectedName.includes(actualName)) {
    throw new AutomationError("BENEFICIARY_VALIDATION_FAILED", "Nome do titular retornado nao confere.", {
      safeDetails: "O portal retornou um titular diferente do nome solicitado.",
      step: "validate_contract",
      retryable: false,
    });
  }
}

function assertHolderHasCode(candidate: ActiveUserCandidate) {
  if (!candidate.code?.trim()) {
    throw new AutomationError("PORTAL_CHANGED", "Codigo do titular nao encontrado.", {
      safeDetails: "A linha do titular foi encontrada, mas a coluna CODIGO nao pode ser lida.",
      step: "locate_holder",
      retryable: false,
    });
  }

  return candidate;
}
