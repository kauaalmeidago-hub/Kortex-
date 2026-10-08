import { existsSync } from "node:fs";
import { AutomationError, assertNotAborted, createReauthRequiredError } from "../../errors.js";
import type { OperationArtifact, OperationRecord, OperationResult } from "../../types.js";
import type { WorkflowContext } from "../WorkflowContext.js";
import { requireInput } from "./validators.js";
import { maskCpf } from "./exclusionUtils.js";
import {
  sanitizeInclusionSummary,
  validateAndNormalizeDocument,
  validateCnsIdentity,
  validateHealthAnswers,
  validateReceitaCpfIdentity,
  validateRequiredRegistrationFields,
  type HealthAnswer,
  type InclusionDocumentMetadata,
  type NormalizedDocumentMetadata,
} from "./inclusionUtils.js";
import { ActiveUsersPreflightService } from "./ActiveUsersPreflightService.js";
import { HapvidaMovementAccessPage } from "./pageObjects/HapvidaMovementAccessPage.js";
import { HapvidaMovementMainMenuPage } from "./pageObjects/HapvidaMovementMainMenuPage.js";
import { HapvidaActiveUsersPage } from "./pageObjects/HapvidaActiveUsersPage.js";
import { CnesUserLookupPage } from "./pageObjects/CnesUserLookupPage.js";
import { ReceitaCpfStatusPage, validateCpfProofPdfBytes } from "./pageObjects/ReceitaCpfStatusPage.js";
import { HapvidaHolderInclusionStartPage } from "./pageObjects/HapvidaHolderInclusionStartPage.js";
import { HapvidaHolderRegistrationPage, type HolderRegistrationData } from "./pageObjects/HapvidaHolderRegistrationPage.js";
import { HapvidaHolderDocumentsPage } from "./pageObjects/HapvidaHolderDocumentsPage.js";
import { HapvidaHolderHealthQuestionnairePage } from "./pageObjects/HapvidaHolderHealthQuestionnairePage.js";

interface InclusionDocumentInput extends InclusionDocumentMetadata {
  filePath?: string;
}

const DEFAULT_CNS_LOOKUP_URL = "https://cnesadm.datasus.gov.br/cnesadm/publico/usuarios/cadastro";
const DEFAULT_RECEITA_CPF_LOOKUP_URL =
  "https://servicos.receita.fazenda.gov.br/servicos/cpf/consultasituacao/ConsultaPublica.asp?Error=5";

function readString(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

function readBoolean(input: Record<string, unknown>, key: string) {
  return input[key] === true;
}

function readHealthAnswers(input: Record<string, unknown>) {
  const answers = input.healthAnswers;
  if (!Array.isArray(answers)) return [];

  return answers
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      questionId: String(item.questionId ?? "").trim(),
      answer: item.answer === "yes" ? ("yes" as const) : ("no" as const),
      detail: typeof item.detail === "string" ? item.detail : undefined,
    }))
    .filter((item) => Boolean(item.questionId));
}

function readDocumentInputs(input: Record<string, unknown>) {
  const candidates = input.documents ?? input.attachments;
  if (!Array.isArray(candidates)) return [];

  return candidates
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : undefined,
      fileName: String(item.fileName ?? item.name ?? "").trim(),
      mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
      sizeBytes: Number(item.sizeBytes ?? item.size ?? 0),
      filePath: typeof item.filePath === "string" ? item.filePath : undefined,
    }))
    .filter((item) => Boolean(item.fileName));
}

function ensureDocumentFiles(documents: Array<NormalizedDocumentMetadata & { filePath?: string }>) {
  for (const document of documents) {
    if (!document.filePath?.trim()) {
      throw new AutomationError("ATTACHMENT_UPLOAD_FAILED", "Documento sem arquivo local resolvido.", {
        safeDetails: "O worker recebeu metadados do documento, mas nao recebeu o caminho local seguro para upload.",
        step: "validating_documents",
        retryable: false,
      });
    }

    if (!existsSync(document.filePath)) {
      throw new AutomationError("ATTACHMENT_UPLOAD_FAILED", "Arquivo de anexo nao encontrado.", {
        safeDetails: "O arquivo local informado para upload nao existe mais.",
        step: "validating_documents",
        retryable: false,
      });
    }
  }
}

function collectRegistrationData(input: Record<string, unknown>, cnsNumber: string): HolderRegistrationData {
  return {
    cpf: readString(input, ["beneficiaryCpf", "cpf"]) ?? "",
    beneficiaryName: readString(input, ["beneficiaryName"]) ?? "",
    birthDate: readString(input, ["birthDate", "dateOfBirth"]) ?? "",
    gender: readString(input, ["gender", "sex"]),
    maritalStatus: readString(input, ["maritalStatus"]),
    identity: readString(input, ["identity", "rg"]),
    issuingAgency: readString(input, ["issuingAgency", "rgIssuer"]),
    issuingUf: readString(input, ["issuingUf", "rgIssuerUf"]),
    motherName: readString(input, ["motherName"]),
    pisPasep: readString(input, ["pisPasep", "pis"]),
    ctps: readString(input, ["ctps"]),
    ctpsSeries: readString(input, ["ctpsSeries"]),
    cnsNumber,
    admissionDate: readString(input, ["admissionDate"]),
    companyEnrollment: readString(input, ["companyEnrollment"]),
    sequentialEnrollment: readString(input, ["sequentialEnrollment"]),
    role: readString(input, ["role", "jobTitle"]),
    liveBirthDeclaration: readString(input, ["liveBirthDeclaration", "dnv"]),
    mobilePhone: readString(input, ["mobilePhone", "phone"]),
    email: readString(input, ["email"]),
    zipCode: readString(input, ["zipCode", "cep"]),
    streetType: readString(input, ["streetType"]),
    address: readString(input, ["address", "street"]),
    number: readString(input, ["number", "addressNumber"]),
    complement: readString(input, ["complement"]),
    district: readString(input, ["district", "neighborhood"]),
    city: readString(input, ["city"]),
    state: readString(input, ["state", "uf"]),
    residentialPhone: readString(input, ["residentialPhone"]),
    referencePoint: readString(input, ["referencePoint"]),
  };
}

async function saveCpfProofArtifact(operation: OperationRecord, context: WorkflowContext, bytes: Buffer, beneficiaryName: string) {
  const saved = await context.artifactStorage.save({
    operationId: operation.id,
    workspaceId: operation.workspaceId,
    fileName: `comprovante-cpf-${operation.id}.pdf`,
    mimeType: "application/pdf",
    bytes,
    type: "receipt",
    metadata: {
      beneficiaryName,
      companyId: operation.companyId,
      source: "receita_cpf_lookup",
    },
  });

  const artifact: OperationArtifact = {
    id: crypto.randomUUID(),
    fileName: saved.fileName,
    path: saved.storagePath,
    storageProvider: saved.storageProvider,
    bucket: saved.bucket,
    storagePath: saved.storagePath,
    mimeType: saved.mimeType,
    sizeBytes: saved.sizeBytes,
    checksum: saved.checksum,
    kind: "pdf",
    artifactType: "receipt",
    metadata: { source: "receita_cpf_lookup" },
    createdAt: new Date().toISOString(),
  };

  const current = await context.repository.get(operation.id);
  await context.repository.update(operation.id, {
    artifacts: [...(current?.artifacts ?? []), artifact],
    updatedAt: new Date().toISOString(),
  });

  await context.emitEvent({
    operationId: operation.id,
    type: "artifact.created",
    status: "generating_cpf_document",
    step: "cpf_document_created",
    data: { artifactId: artifact.id, fileName: artifact.fileName, mimeType: artifact.mimeType },
  });

  return artifact;
}

async function stopForHumanVerification(
  operation: OperationRecord,
  context: WorkflowContext,
  reason: "CNS_CAPTCHA_REQUIRED" | "CPF_CAPTCHA_REQUIRED",
  message: string,
) {
  await context.repository.update(operation.id, {
    result: {
      portalStatus: "Aguardando verificacao humana",
      errorCode: reason,
      prepareOnly: true,
    },
    updatedAt: new Date().toISOString(),
  });
  await context.emitEvent({
    operationId: operation.id,
    type: reason === "CNS_CAPTCHA_REQUIRED" ? "inclusion.cns.failed" : "inclusion.cpf.human_verification_required",
    status: "awaiting_human_verification",
    step: "awaiting_human_verification",
    data: { code: reason, message },
  });
  await context.updateStatus("awaiting_human_verification", message, {
    errorCode: reason,
    portalStatus: "Aguardando verificacao humana",
  });
}

export async function prepareHolderInclusion(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext) {
  if (!context.config.features.inclusionPreview && !context.config.features.inclusion) {
    throw new AutomationError("WORKFLOW_DISABLED", "Inclusao Hapvida ainda nao esta habilitada.", {
      safeDetails: "Ative KOA_INCLUSION_PREVIEW_ENABLED=true para preparar inclusoes sem submit definitivo.",
      step: "feature_flag",
      retryable: false,
    });
  }

  requireInput(operation.input, ["beneficiaryName", "birthDate"]);

  const beneficiaryName = readString(operation.input, ["beneficiaryName"])!;
  const cpf = readString(operation.input, ["beneficiaryCpf", "cpf"])!;
  const birthDate = readString(operation.input, ["birthDate", "dateOfBirth"])!;
  const plan = readString(operation.input, ["plan", "planName", "planId"]);
  const unit = readString(operation.input, ["unit", "companyUnit", "businessUnit"]);
  const documentIds = Array.isArray(operation.input.documentIds) ? operation.input.documentIds : [];
  const documents = readDocumentInputs(operation.input);
  const usedFileNames = new Set<string>();
  const normalizedDocuments = documents.map((document) => ({
    ...validateAndNormalizeDocument(document, usedFileNames),
    filePath: document.filePath,
  }));
  const healthInput = {
    healthAllNegativeConfirmed: readBoolean(operation.input, "healthAllNegativeConfirmed"),
    healthAnswers: readHealthAnswers(operation.input),
  };

  if (!cpf) {
    throw new AutomationError("MISSING_REQUIRED_DATA", "CPF do beneficiario nao informado.", {
      safeDetails: "Informe o CPF do titular para preparar a inclusao.",
      step: "validate_input",
      retryable: false,
    });
  }

  if (documentIds.length > 0 && documents.length === 0) {
    throw new AutomationError("ATTACHMENT_UPLOAD_FAILED", "Documentos ainda nao foram resolvidos para o worker.", {
      safeDetails: "O worker recebeu IDs de documentos, mas o resolvedor de arquivos ainda nao esta conectado.",
      step: "validating_documents",
      retryable: false,
    });
  }

  await context.browserManager.withContext(operation, signal, async (_browserContext, page) => {
    const movementPortalUrl = context.config.hapvidaMovementPortalUrl ?? context.config.hapvidaPortalUrl;
    const cnsUrl = context.config.cnsLookupUrl ?? DEFAULT_CNS_LOOKUP_URL;
    const receitaCpfUrl = context.config.receitaCpfLookupUrl ?? DEFAULT_RECEITA_CPF_LOOKUP_URL;
    const movementAccessPage = new HapvidaMovementAccessPage(page, movementPortalUrl);
    const menuPage = new HapvidaMovementMainMenuPage(page);
    const activeUsersPage = new HapvidaActiveUsersPage(page);
    const cnsPage = new CnesUserLookupPage(page, cnsUrl);
    const receitaPage = new ReceitaCpfStatusPage(page, receitaCpfUrl);
    const inclusionStartPage = new HapvidaHolderInclusionStartPage(page);
    const registrationPage = new HapvidaHolderRegistrationPage(page);
    const documentsPage = new HapvidaHolderDocumentsPage(page);
    const healthPage = new HapvidaHolderHealthQuestionnairePage(page);

    for (const url of [movementPortalUrl, cnsUrl, receitaCpfUrl]) {
      if (url) context.browserManager.validateAllowedUrl(url, operation);
    }

    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.started",
      status: "starting",
      step: "inclusion_started",
      data: { companyId: operation.companyId },
    });

    await context.updateStatus("authenticating", "Abrindo Sistema de Movimentacao Hapvida");
    await movementAccessPage.open();
    assertNotAborted(signal);

    await context.updateStatus("authenticating", "Carregando credencial segura");
    const credential = await context.secretProvider.get(operation.credentialRef).catch(() => {
      throw createReauthRequiredError("Credencial segura nao encontrada para preparar inclusao Hapvida.");
    });
    assertNotAborted(signal);

    await context.updateStatus("authenticating", "Selecionando acesso da empresa");
    const movementMenuAlreadyLoaded = await menuPage.quickAccessHeading().or(menuPage.menuHeading()).isVisible().catch(() => false);
    if (!movementMenuAlreadyLoaded) {
      await movementAccessPage.login(credential);
    }
    await menuPage.waitForLoaded();
    assertNotAborted(signal);

    const activeUsersCheck = await new ActiveUsersPreflightService({
      operation,
      context,
      signal,
      menuPage,
      activeUsersPage,
    }).validateInclusionHolder({ beneficiaryName, beneficiaryCpf: cpf });
    assertNotAborted(signal);

    await context.updateStatus("checking_cns", "Consultando CNS do beneficiario");
    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.cns.started",
      status: "checking_cns",
      step: "checking_cns",
      data: { beneficiaryCpfMasked: maskCpf(cpf) },
    });
    await cnsPage.open();
    await cnsPage.fillLookup(cpf, birthDate);
    try {
      await cnsPage.submitLookup();
    } catch (error) {
      if (error instanceof AutomationError && error.code === "CNS_CAPTCHA_REQUIRED") {
        await stopForHumanVerification(operation, context, "CNS_CAPTCHA_REQUIRED", "Consulta CNS exige verificacao humana.");
        return;
      }
      throw error;
    }

    const cnsResult = await cnsPage.readResult();
    validateCnsIdentity({ beneficiaryName, cpf, birthDate }, cnsResult);
    assertNotAborted(signal);
    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.cns.found",
      status: "checking_cns",
      step: "checking_cns",
      data: { cnsNumber: cnsResult.cnsNumber, beneficiaryCpfMasked: maskCpf(cpf) },
    });

    await context.updateStatus("checking_cpf", "Validando CPF na Receita Federal");
    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.cpf.started",
      status: "checking_cpf",
      step: "checking_cpf",
      data: { beneficiaryCpfMasked: maskCpf(cpf) },
    });
    await receitaPage.open();
    await receitaPage.fillLookup(cpf, birthDate);
    try {
      await receitaPage.submitLookup();
    } catch (error) {
      if (error instanceof AutomationError && error.code === "CPF_CAPTCHA_REQUIRED") {
        await stopForHumanVerification(operation, context, "CPF_CAPTCHA_REQUIRED", "Consulta CPF exige hCaptcha/verificacao humana.");
        return;
      }
      throw error;
    }

    const receitaResult = await receitaPage.readResult();
    validateReceitaCpfIdentity({ beneficiaryName, cpf, birthDate }, receitaResult);
    assertNotAborted(signal);
    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.cpf.validated",
      status: "checking_cpf",
      step: "checking_cpf",
      data: { beneficiaryCpfMasked: maskCpf(cpf), registrationStatus: receitaResult.registrationStatus },
    });

    await context.updateStatus("generating_cpf_document", "Gerando comprovante PDF da Receita Federal");
    const cpfProof = validateCpfProofPdfBytes(await receitaPage.printProofToPdf(), beneficiaryName);
    const cpfProofArtifact = await saveCpfProofArtifact(operation, context, cpfProof, beneficiaryName);
    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.cpf.document_created",
      status: "generating_cpf_document",
      step: "generating_cpf_document",
      data: { artifactId: cpfProofArtifact.id, fileName: cpfProofArtifact.fileName },
    });

    await context.updateStatus("validating_documents", "Validando documentos da inclusao");
    ensureDocumentFiles(normalizedDocuments);
    assertNotAborted(signal);

    await context.updateStatus("opening_inclusion", "Abrindo inclusao de titular");
    await movementAccessPage.open();
    const menuAfterReturn = await menuPage.quickAccessHeading().or(menuPage.menuHeading()).isVisible().catch(() => false);
    if (!menuAfterReturn) {
      await movementAccessPage.login(credential);
    }
    await menuPage.waitForLoaded();
    await activeUsersPage.returnToMainMenu().catch(() => undefined);
    await menuPage.waitForLoaded().catch(() => undefined);
    await menuPage.openHolderInclusion();
    await inclusionStartPage.waitForLoaded();
    await inclusionStartPage.fillCpf(cpf);
    await inclusionStartPage.proceed();
    assertNotAborted(signal);

    const registrationData = collectRegistrationData(operation.input, cnsResult.cnsNumber!);
    validateRequiredRegistrationFields(operation.input, [
      "beneficiaryName",
      "cpf",
      "birthDate",
      "motherName",
      "gender",
      "zipCode",
      "address",
      "number",
      "district",
      "city",
      "state",
      "mobilePhone",
    ]);

    await context.updateStatus("filling_registration", "Preenchendo dados cadastrais");
    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.registration.started",
      status: "filling_registration",
      step: "filling_registration",
      data: { beneficiaryCpfMasked: maskCpf(cpf) },
    });
    await registrationPage.waitForLoaded();
    await registrationPage.fillRegistration(registrationData);
    await registrationPage.fillAddress(registrationData);
    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.registration.completed",
      status: "filling_registration",
      step: "filling_registration",
      data: { beneficiaryName },
    });

    await context.updateStatus("selecting_plan", "Selecionando Unidade Empresa e Plano");
    await registrationPage.selectPlan({ unit, plan });
    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.plan.selected",
      status: "selecting_plan",
      step: "selecting_plan",
      data: { unit, plan },
    });
    await registrationPage.proceed();
    assertNotAborted(signal);

    await context.updateStatus("uploading_documents", "Enviando documentos da inclusao");
    if (normalizedDocuments.length > 0) {
      await documentsPage.waitForLoaded();
      for (const document of normalizedDocuments) {
        await documentsPage.uploadDocument({
          filePath: document.filePath!,
          originalFileName: document.originalFileName,
          normalizedFileName: document.normalizedFileName,
        });
        await context.emitEvent({
          operationId: operation.id,
          type: "inclusion.document.uploaded",
          status: "uploading_documents",
          step: "uploading_documents",
          data: {
            originalFileName: document.originalFileName,
            normalizedFileName: document.normalizedFileName,
          },
        });
        assertNotAborted(signal);
      }
      await documentsPage.proceed().catch(() => undefined);
    }

    await context.updateStatus("filling_health_questionnaire", "Preenchendo questionario de saude");
    validateHealthAnswers(healthInput);
    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.health.started",
      status: "filling_health_questionnaire",
      step: "filling_health_questionnaire",
    });
    await healthPage.waitForLoaded();
    if (healthInput.healthAllNegativeConfirmed) {
      await healthPage.answerAllNo();
    } else {
      await healthPage.answerQuestions(healthInput.healthAnswers);
    }
    await healthPage.proceed();
    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.health.completed",
      status: "filling_health_questionnaire",
      step: "filling_health_questionnaire",
    });
    assertNotAborted(signal);

    const result: OperationResult = {
      portalStatus: "Aguardando confirmacao",
      ...sanitizeInclusionSummary({
        beneficiaryName,
        cpf,
        birthDate,
        cnsNumber: cnsResult.cnsNumber,
        companyId: operation.companyId,
        unit,
        plan,
        documentCount: normalizedDocuments.length + 1,
      }),
      activeUsersPreflight: activeUsersCheck.snapshot,
      cpfProofArtifactId: cpfProofArtifact.id,
    };

    await context.repository.update(operation.id, {
      result,
      updatedAt: new Date().toISOString(),
    });
    await context.emitEvent({
      operationId: operation.id,
      type: "inclusion.awaiting_confirmation",
      status: "awaiting_confirmation",
      step: "awaiting_confirmation",
      data: result,
    });
    await context.updateStatus("awaiting_confirmation", "Inclusao preparada aguardando confirmacao humana", result);
  });
}
