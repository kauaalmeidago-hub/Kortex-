import { AutomationError, assertNotAborted, createReauthRequiredError } from "../../errors.js";
import type { OperationRecord, OperationResult } from "../../types.js";
import type { WorkflowContext } from "../WorkflowContext.js";
import { requireInput } from "./validators.js";
import { maskCpf, validateContractIdentity } from "./exclusionUtils.js";
import { ActiveUsersPreflightService } from "./ActiveUsersPreflightService.js";
import { HapvidaMovementAccessPage } from "./pageObjects/HapvidaMovementAccessPage.js";
import { HapvidaMovementMainMenuPage } from "./pageObjects/HapvidaMovementMainMenuPage.js";
import { HapvidaActiveUsersPage } from "./pageObjects/HapvidaActiveUsersPage.js";
import { HapvidaHolderPreCancellationPage } from "./pageObjects/HapvidaHolderPreCancellationPage.js";
import { HapvidaHolderCancellationReviewPage } from "./pageObjects/HapvidaHolderCancellationReviewPage.js";

function readString(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

function readStringArray(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }

  return [];
}

export async function prepareHolderExclusion(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext) {
  if (!context.config.features.exclusionPreview && !context.config.features.exclusion) {
    throw new AutomationError("WORKFLOW_DISABLED", "Exclusao Hapvida ainda nao esta habilitada.", {
      safeDetails: "Ative KOA_EXCLUSION_PREVIEW_ENABLED=true para preparar exclusoes sem submit definitivo.",
      step: "feature_flag",
      retryable: false,
    });
  }

  requireInput(operation.input, ["beneficiaryName"]);

  const beneficiaryName = readString(operation.input, ["beneficiaryName"]);
  const beneficiaryCpf = readString(operation.input, ["beneficiaryCpf", "cpf"]);
  const cancellationReason = readString(operation.input, ["cancellationReason", "reason"]);
  const attachmentIds = readStringArray(operation.input, ["attachmentIds", "documentIds"]);

  if (!beneficiaryName || !beneficiaryCpf || !cancellationReason) {
    throw new AutomationError("MISSING_REQUIRED_DATA", "Dados obrigatorios ausentes.", {
      safeDetails: "Informe empresa, nome completo, CPF e motivo para preparar a exclusao.",
      step: "validate_input",
      retryable: false,
    });
  }

  if (attachmentIds.length > 0) {
    throw new AutomationError("ATTACHMENT_UPLOAD_FAILED", "Upload de anexos ainda nao esta conectado ao worker.", {
      safeDetails: "A preparacao de exclusao com anexos precisa do resolvedor de documentos do Koa antes de acessar o portal.",
      step: "prepare_documents",
      retryable: false,
    });
  }

  await context.browserManager.withContext(operation, signal, async (_browserContext, page) => {
    const portalUrl = context.config.hapvidaMovementPortalUrl ?? context.config.hapvidaPortalUrl;
    const accessPage = new HapvidaMovementAccessPage(page, portalUrl);
    const menuPage = new HapvidaMovementMainMenuPage(page);
    const activeUsersPage = new HapvidaActiveUsersPage(page);
    const preCancellationPage = new HapvidaHolderPreCancellationPage(page);
    const reviewPage = new HapvidaHolderCancellationReviewPage(page);

    if (portalUrl) {
      context.browserManager.validateAllowedUrl(portalUrl, operation);
    }

    await context.emitEvent({
      operationId: operation.id,
      type: "exclusion.started",
      status: "starting",
      step: "exclusion_started",
    });

    await context.updateStatus("authenticating", "Abrindo Sistema de Movimentacao Hapvida");
    await accessPage.open();
    assertNotAborted(signal);

    await context.updateStatus("authenticating", "Carregando credencial segura");
    const credential = await context.secretProvider.get(operation.credentialRef).catch(() => {
      throw createReauthRequiredError("Credencial segura nao encontrada para preparar exclusao Hapvida.");
    });
    assertNotAborted(signal);

    await context.updateStatus("authenticating", "Selecionando acesso da empresa");
    const movementMenuAlreadyLoaded = await menuPage.quickAccessHeading().or(menuPage.menuHeading()).isVisible().catch(() => false);
    if (!movementMenuAlreadyLoaded) {
      await accessPage.login(credential);
    }
    await menuPage.waitForLoaded();
    assertNotAborted(signal);

    await context.emitEvent({
      operationId: operation.id,
      type: "exclusion.company_access_selected",
      status: "accessing_portal",
      step: "selecting_company_access",
    });

    const preflight = new ActiveUsersPreflightService({
      operation,
      context,
      signal,
      menuPage,
      activeUsersPage,
    });
    const activeUsersCheck = await preflight.validateExclusionHolder({ beneficiaryName, beneficiaryCpf });
    const holder = activeUsersCheck.target;
    if (!holder) {
      throw new AutomationError("BENEFICIARY_NOT_ACTIVE", "Titular nao esta ativo na Hapvida.", {
        safeDetails: "A Lista Usuarios Ativos nao retornou um titular para continuar o pre-cancelamento.",
        step: "checking_active_users",
        retryable: false,
      });
    }
    assertNotAborted(signal);

    await context.emitEvent({
      operationId: operation.id,
      type: "exclusion.beneficiary_found",
      status: "checking_active_users",
      step: "checking_active_users",
      data: { beneficiaryName, activeUser: activeUsersCheck.snapshot.target },
    });
    await context.emitEvent({
      operationId: operation.id,
      type: "exclusion.holder_code_resolved",
      status: "checking_active_users",
      step: "holder_code_resolved",
    });

    await context.updateStatus("processing", "Abrindo pre-cancelamento titular ativo");
    await activeUsersPage.returnToMainMenu();
    await menuPage.waitForLoaded();
    await menuPage.openHolderPreCancellation();
    await preCancellationPage.waitForLoaded();
    await preCancellationPage.fillHolderUserCode(holder!.userCode!);
    await preCancellationPage.proceedToReview();
    assertNotAborted(signal);

    await reviewPage.waitForLoaded();
    const review = await reviewPage.readReview();
    await context.emitEvent({
      operationId: operation.id,
      type: "exclusion.contract_loaded",
      status: "processing",
      step: "opening_pre_cancellation",
      data: { contractCode: review.contractCode },
    });

    await context.updateStatus("verifying", "Validando contrato retornado");
    validateContractIdentity(
      { beneficiaryName, beneficiaryCpf },
      { name: review.holderName ?? holder.name, cpf: review.holderCpf ?? holder.cpf },
    );
    assertNotAborted(signal);

    await context.emitEvent({
      operationId: operation.id,
      type: "exclusion.contract_validated",
      status: "verifying",
      step: "validating_contract",
      data: {
        beneficiaryName,
        beneficiaryCpfMasked: maskCpf(beneficiaryCpf),
        dependentsFound: review.dependents.length,
      },
    });

    await context.updateStatus("processing", "Selecionando motivo do cancelamento");
    const reason = await reviewPage.selectCancellationReason(cancellationReason);
    assertNotAborted(signal);
    await context.emitEvent({
      operationId: operation.id,
      type: "exclusion.reason_selected",
      status: "processing",
      step: "preparing_cancellation",
      data: { cancellationReason: reason.label },
    });

    const result: OperationResult = {
      portalStatus: "Aguardando confirmacao",
      companyName: review.companyName,
      beneficiaryName: review.holderName ?? beneficiaryName,
      beneficiaryCpfMasked: maskCpf(review.holderCpf ?? beneficiaryCpf),
      contractCode: review.contractCode,
      activeUser: activeUsersCheck.snapshot.target,
      dependentsFound: review.dependents,
      cancellationReason: reason.label,
      effectiveCancellationDate: review.effectiveCancellationDate,
      attachments: [],
      prepareOnly: true,
    };

    await context.repository.update(operation.id, {
      result,
      updatedAt: new Date().toISOString(),
    });

    await context.emitEvent({
      operationId: operation.id,
      type: "exclusion.awaiting_confirmation",
      status: "awaiting_confirmation",
      step: "awaiting_confirmation",
      data: result,
    });
    await context.updateStatus("awaiting_confirmation", "Exclusao preparada aguardando confirmacao humana", result);
  });
}
