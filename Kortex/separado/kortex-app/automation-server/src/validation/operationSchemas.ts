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
      if (/(password|senha|pass|pwd|authorization|cookie|token|storageState|secret|accessToken|refreshToken|rawCredential)/i.test(key)) {
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
    beneficiaryCpf: z.string().min(1).optional(),
    cpf: z.string().min(1).optional(),
    birthDate: z.string().min(1),
    motherName: z.string().optional(),
    gender: z.string().optional(),
    zipCode: z.string().optional(),
    address: z.string().optional(),
    number: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    mobilePhone: z.string().optional(),
    unit: z.string().optional(),
    companyUnit: z.string().optional(),
    plan: z.string().optional(),
    planName: z.string().optional(),
    planId: z.string().optional(),
    healthAllNegativeConfirmed: z.boolean().optional(),
    healthAnswers: z
      .array(
        z.object({
          questionId: z.string().min(1),
          answer: z.enum(["yes", "no"]),
          detail: z.string().optional(),
        }),
      )
      .optional(),
    attachments: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string().optional(),
          fileName: z.string().optional(),
          mimeType: z.string().optional(),
          size: z.number().optional(),
          sizeBytes: z.number().optional(),
          filePath: z.string().optional(),
        }),
      )
      .optional(),
    documents: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string().optional(),
          fileName: z.string().optional(),
          mimeType: z.string().optional(),
          size: z.number().optional(),
          sizeBytes: z.number().optional(),
          filePath: z.string().optional(),
        }),
      )
      .optional(),
    documentIds: z.array(z.string().uuid()).optional(),
  })
  .passthrough()
  .superRefine((payload, context) => {
    if (!payload.beneficiaryCpf && !payload.cpf) {
      context.addIssue({
        code: "custom",
        path: ["cpf"],
        message: "CPF do titular e obrigatorio para preparar inclusao.",
      });
    }

    for (const forbiddenKey of ["password", "senha", "holderUserCode", "titularUserCode", "cancellationDate", "effectiveCancellationDate"]) {
      if (forbiddenKey in payload) {
        context.addIssue({
          code: "custom",
          path: [forbiddenKey],
          message: `${forbiddenKey} nao deve ser enviado pelo chat.`,
        });
      }
    }
  });

export const ExclusionHolderPayloadSchema = z
  .object({
    beneficiaryName: z.string().min(1),
    beneficiaryCpf: z.string().min(1).optional(),
    cpf: z.string().min(1).optional(),
    cancellationReason: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    attachmentIds: z.array(z.string().uuid()).optional(),
    documentIds: z.array(z.string().uuid()).optional(),
  })
  .passthrough()
  .superRefine((payload, context) => {
    if (!payload.beneficiaryCpf && !payload.cpf) {
      context.addIssue({
        code: "custom",
        path: ["beneficiaryCpf"],
        message: "CPF do titular e obrigatorio para preparar exclusao.",
      });
    }

    if (!payload.cancellationReason && !payload.reason) {
      context.addIssue({
        code: "custom",
        path: ["cancellationReason"],
        message: "Motivo de cancelamento e obrigatorio.",
      });
    }

    for (const forbiddenKey of ["password", "senha", "holderUserCode", "titularUserCode", "cancellationDate", "effectiveCancellationDate"]) {
      if (forbiddenKey in payload) {
        context.addIssue({
          code: "custom",
          path: [forbiddenKey],
          message: `${forbiddenKey} nao deve ser enviado pelo chat.`,
        });
      }
    }
  });

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
