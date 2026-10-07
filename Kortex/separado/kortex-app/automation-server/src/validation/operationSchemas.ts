import { z } from "zod";

const noSensitiveKeys = (value: unknown) => {
  if (!value || typeof value !== "object") return true;
  const seen = new Set<unknown>();

  const visit = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return true;
    if (seen.has(node)) return true;
    seen.add(node);

    if (Array.isArray(node)) return node.every(visit);

    return Object.entries(node as Record<string, unknown>).every(([key, nested]) => {
      if (/(password|senha|authorization|cookie|token|storageState|secret|accessToken|refreshToken|rawCredential)/i.test(key)) {
        return false;
      }
      return visit(nested);
    });
  };

  return visit(value);
};

export const OperationTypeSchema = z.enum([
  "CARD_ISSUE",
  "INCLUSION_HOLDER",
  "INCLUSION_DEPENDENT",
  "EXCLUSION_HOLDER",
  "EXCLUSION_DEPENDENT",
]);

export const OperatorSchema = z.enum(["hapvida", "ndi"]).default("hapvida");

export const CardIssuePayloadSchema = z
  .object({
    beneficiaryName: z.string().min(1),
    cpf: z.string().min(1).optional(),
    birthDate: z.string().min(1).optional(),
    periodStart: z.string().min(1).optional(),
    periodEnd: z.string().min(1).optional(),
    startDate: z.string().min(1).optional(),
    endDate: z.string().min(1).optional(),
    contractCode: z.string().min(1).optional(),
    documentIds: z.array(z.string().uuid()).optional(),
  })
  .passthrough();

export const InclusionHolderPayloadSchema = z
  .object({
    beneficiaryName: z.string().min(1),
    cpf: z.string().min(1),
    birthDate: z.string().min(1),
    planId: z.string().optional(),
    documentIds: z.array(z.string().uuid()).optional(),
  })
  .passthrough();

export const ExclusionHolderPayloadSchema = z
  .object({
    beneficiaryName: z.string().min(1),
    cpf: z.string().min(1).optional(),
    titularUserCode: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    documentIds: z.array(z.string().uuid()).optional(),
  })
  .passthrough();

export const GenericAutomationPayloadSchema = z.record(z.string(), z.unknown()).refine(noSensitiveKeys, {
  message: "Payload contem chave sensivel.",
});

export function validatePayload(type: z.infer<typeof OperationTypeSchema>, payload: Record<string, unknown>) {
  GenericAutomationPayloadSchema.parse(payload);

  if (type === "CARD_ISSUE") return CardIssuePayloadSchema.parse(payload);
  if (type === "INCLUSION_HOLDER") return InclusionHolderPayloadSchema.parse(payload);
  if (type === "EXCLUSION_HOLDER") return ExclusionHolderPayloadSchema.parse(payload);

  return payload;
}

export const CreateOperationSchema = z.object({
  type: OperationTypeSchema,
  workspaceId: z.string().uuid().optional(),
  companyId: z.string().uuid(),
  requestedBy: z.string().uuid().optional(),
  portal: z.enum(["hapvida", "ndi"]).default("hapvida"),
  operator: OperatorSchema,
  credentialRef: z.string().optional(),
  input: z.record(z.string(), z.unknown()).default({}),
});
