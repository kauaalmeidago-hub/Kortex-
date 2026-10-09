import { AutomationError, assertNotAborted, createReauthRequiredError } from "../../errors.js";
import type { OperationArtifact, OperationRecord, OperationResult, PortalCredential } from "../../types.js";
import type { WorkflowContext } from "../WorkflowContext.js";
import { requireInput } from "./validators.js";
import { RememberedCredentialService } from "../../authentication/RememberedCredentialService.js";
import { HapvidaLoginPage } from "./pageObjects/HapvidaLoginPage.js";
import { HapvidaCardPage, type BeneficiarySearchInput } from "./pageObjects/HapvidaCardPage.js";
import { isAllBeneficiariesRequest } from "./cardIssueScope.js";
import { createBrandedCardDelivery } from "./brandedCardDelivery.js";
import { validateCardPdfBytes } from "./downloadValidation.js";
import { pendingCardDependents, type CardDependentConfirmation } from "./cardDependents.js";
import { credentialRefForLogin, normalizePortalLoginCode, portalLoginCode } from "../../credentials/credentialIdentity.js";
import { pendingCardBeneficiary, cardRowFingerprint, type CardBeneficiaryConfirmation } from "./cardBeneficiaryChoice.js";

function readString(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

function toPortalDate(value: string | undefined, label: string) {
  if (!value) {
    throw new AutomationError("INVALID_PERIOD", "Periodo da carteirinha invalido.", {
      safeDetails: `${label} e obrigatoria.`,
      step: "validate_period",
      retryable: false,
    });
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;

  throw new AutomationError("INVALID_PERIOD", "Periodo da carteirinha invalido.", {
    safeDetails: `${label} deve estar no formato DD/MM/AAAA ou AAAA-MM-DD.`,
    step: "validate_period",
    retryable: false,
  });
}

function safeFileNamePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 90) || "beneficiario";
}

const CARD_PORTAL_AUTH_MAX_ATTEMPTS = 2;

function isRetryablePortalAuthenticationFailure(error: unknown) {
  return error instanceof AutomationError && error.code === "PORTAL_AUTH_UNAVAILABLE" && error.retryable;
}

export async function emitCard(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext) {
  requireInput(operation.input, ["beneficiaryName"]);

  const beneficiaryName = readString(operation.input, ["beneficiaryName"]);
  const periodStart = toPortalDate(readString(operation.input, ["periodStart", "startDate"]), "Data inicial");
  const periodEnd = toPortalDate(readString(operation.input, ["periodEnd", "endDate"]), "Data final");
  const cpf = readString(operation.input, ["cpf"]);
  const birthDate = readString(operation.input, ["birthDate"]);
  const cardNumber = readString(operation.input, ["cardNumber"])?.replace(/\D/g, "");
  const requestedCompanyCode = portalLoginCode(operation.input);
  const allBeneficiaries = isAllBeneficiariesRequest(operation.input);
  if (allBeneficiaries && !requestedCompanyCode) {
    throw new AutomationError("MISSING_REQUIRED_DATA", "Informe o codigo da empresa para emitir todas as carteirinhas.", { step: "validate_input" });
  }

  if (!beneficiaryName) {
    throw new AutomationError("MISSING_REQUIRED_DATA", "Nome do beneficiario nao informado.", {
      safeDetails: "Informe o nome completo do beneficiario antes de emitir a carteirinha.",
      step: "validate_input",
      retryable: false,
    });
  }

  const portal = operation.portal;
  const portalLabel = portal === "ndi" ? "NDI" : "Hapvida";
  const portalUrl = portal === "ndi"
    ? context.config.ndiCardPortalUrl
    : context.config.hapvidaCardPortalUrl;
  let credential: PortalCredential | undefined;

  for (let portalAttempt = 1; portalAttempt <= CARD_PORTAL_AUTH_MAX_ATTEMPTS; portalAttempt += 1) {
    try {
      await context.browserManager.withContext(operation, signal, async (browserContext, page) => {
    const loginPage = new HapvidaLoginPage(page, portalUrl, context.config.authTimeoutMs, portalLabel);
    const cardPage = new HapvidaCardPage(page, context.config.actionTimeoutMs ?? 30_000, portalUrl);

    if (portalUrl) {
      context.browserManager.validateAllowedUrl(portalUrl, operation);
    }

    const loadCredential = async () => {
      if (credential) return credential;
      await context.updateStatus("authenticating", "Carregando credencial segura");
      credential = await context.secretProvider.get(operation.credentialRef).catch((error) => {
        if (error instanceof AutomationError && error.code === "CREDENTIAL_STORE_UNAVAILABLE") throw error;
        throw createReauthRequiredError(
          `Nao foi possivel renovar a sessao ${portalLabel} sem uma credencial segura cadastrada para o Koa.`,
        );
      });
      if (requestedCompanyCode && (normalizePortalLoginCode(credential.username) !== requestedCompanyCode ||
          operation.credentialRef !== credentialRefForLogin(operation.companyId, portal, requestedCompanyCode))) {
        throw createReauthRequiredError("Informe a senha do codigo de empresa solicitado. O acesso salvo pertence a outro codigo.");
      }
      credential = { ...credential, username: normalizePortalLoginCode(credential.username) };
      assertNotAborted(signal);
      return credential;
    };

    // The card portal's list is authoritative for card issuance. Movement uses a separate access and menu.
    await context.updateStatus("authenticating", `Abrindo portal de carteirinha ${portalLabel}`);
    // A saved portal session cannot establish which contract the user requested.
    if (requestedCompanyCode) await browserContext.clearCookies();
    await loginPage.open();
    assertNotAborted(signal);

    await context.updateStatus("authenticating", `Validando sessao ${portalLabel} do perfil Koa`);
    const hasValidSession = !requestedCompanyCode && !(await loginPage.passwordStillVisible()) &&
      await context.browserManager.validatePortalSession(portal, page);
    assertNotAborted(signal);

    if (hasValidSession) {
      await context.browserManager.saveSession(browserContext, portal);
    } else {
      await context.browserManager.invalidateSession(portal);
      await loginPage.waitForReady();
      await context.updateStatus("authenticating", "Autenticando no portal");
      await context.emitEvent({
        operationId: operation.id,
        type: "authentication.started",
        status: "authenticating",
        step: "authentication_started",
        data: { source: "worker" },
      });
      await loginPage.login(await loadCredential());
      assertNotAborted(signal);

      // A definite credential rejection does not need the authenticated-selector timeout.
      if (await loginPage.invalidIdentificationMessage().isVisible().catch(() => false)) {
        throw new AutomationError("AUTHENTICATION_FAILED", `Credencial ${portalLabel} nao aceita pelo portal.`, {
          safeDetails: "O portal retornou Identificacao invalida para o codigo/senha cadastrados.",
          step: "authenticate", retryable: false,
        });
      }

      const sessionAfterLogin = await context.browserManager.validatePortalSession(portal, page);
      if (!sessionAfterLogin) {
        if (await loginPage.invalidIdentificationMessage().isVisible().catch(() => false)) {
          throw new AutomationError("AUTHENTICATION_FAILED", `Credencial ${portalLabel} nao aceita pelo portal.`, {
            safeDetails: "O portal retornou Identificacao invalida para o codigo/senha cadastrados.",
            step: "authenticate",
            retryable: false,
          });
        }

        if (await loginPage.passwordStillVisible()) {
          throw new AutomationError("PORTAL_AUTH_UNAVAILABLE", `O portal ${portalLabel} permaneceu na tela de login.`, {
            safeDetails: "O formulario foi enviado, mas o portal nao confirmou acesso nem apresentou uma rejeicao de credencial reconhecida. Verifique a verificacao de acesso do portal.",
            step: "authenticate",
            retryable: true,
          });
        }

        throw new AutomationError("PORTAL_AUTH_UNAVAILABLE", `O portal ${portalLabel} nao confirmou o resultado do login.`, {
          safeDetails: "A resposta do portal nao apresentou a area autenticada nem uma rejeicao de credencial reconhecida.",
          step: "authenticate", retryable: true,
        });
      }

      await context.browserManager.saveSession(browserContext, portal);
      await context.emitEvent({
        operationId: operation.id,
        type: "authentication.succeeded",
        status: "authenticating",
        step: "authentication_succeeded",
        data: { source: "worker" },
      });

      if (credential?.metadata?.rememberOnDevice === true) {
        const remembered = await new RememberedCredentialService(context.config).saveValidatedCredential(operation, credential);
        if (remembered.rememberedOnDevice) await context.emitEvent({
          operationId: operation.id,
          type: "authentication.saved_on_device",
          status: "authenticating",
          step: "authentication_saved_on_device",
          data: { rememberedOnDevice: true, metadataRegistered: remembered.metadataRegistered, storedInDatabase: remembered.storedInDatabase === true },
        });
        if (remembered.storedInDatabase) await context.emitEvent({
          operationId: operation.id, type: "authentication.saved_in_database", status: "authenticating",
          step: "authentication_saved_in_database", data: { operator: portal, storedInDatabase: true },
        });
      }
    }

    assertNotAborted(signal);

    await context.updateStatus("accessing_portal", "Acessando emissao de carteirinha");
    await cardPage.waitForPeriodForm();
    assertNotAborted(signal);

    await context.updateStatus("processing", "Informando periodo de adesao");
    await cardPage.fillPeriod(periodStart, periodEnd);
    await cardPage.submitPeriod();
    assertNotAborted(signal);

    await context.updateStatus("processing", allBeneficiaries ? "Selecionando todos os beneficiarios da empresa" : "Localizando beneficiario");
    let selected: BeneficiarySearchInput[];
    let otherBeneficiaries: BeneficiarySearchInput[] = [];
    if (allBeneficiaries) selected = await cardPage.selectAllBeneficiaries();
    else {
      let target: BeneficiarySearchInput = { beneficiaryName, cpf, birthDate, ...(cardNumber ? { cardIdentifiers: [cardNumber], requireIdentifier: true } : {}) };
      const candidates = await cardPage.inspectBeneficiaryCandidates(target);
      const previousChoice = operation.result?.cardBeneficiaryConfirmation as CardBeneficiaryConfirmation | undefined;
      if (candidates.length > 1 || (previousChoice && candidates.length)) {
        const confirmation = pendingCardBeneficiary(operation, candidates);
        const chosen = candidates.find(row => cardRowFingerprint(row) === confirmation.selectedOptionId);
        if (!chosen) {
          const result = { ...operation.result, beneficiaryName, cardBeneficiaryConfirmation: confirmation, cardDependentConfirmation: undefined };
          await context.repository.update(operation.id, { result });
          Object.assign(operation, { result });
          assertNotAborted(signal);
          await context.updateStatus("awaiting_confirmation", "Escolha qual carteirinha corresponde ao beneficiario", result);
          if (credential) context.retainCardConfirmationCredential?.(operation, credential);
          return;
        }
        target = { ...target, cpf: chosen.cpf ?? cpf, cardIdentifiers: chosen.cardIdentifiers,
          requireIdentifier: chosen.requireIdentifier, rowFingerprint: cardRowFingerprint(chosen) };
      }
      const family = await cardPage.inspectBeneficiaryFamily(target);
      otherBeneficiaries = family.otherBeneficiaries ?? family.dependents;
      assertNotAborted(signal);
      const previous = operation.result?.cardDependentConfirmation as CardDependentConfirmation | undefined;
      if (family.dependents.length || previous) {
        const confirmation = pendingCardDependents(operation, family.beneficiary, family.dependents);
        if (!family.dependents.length && previous?.fingerprint !== confirmation.fingerprint) {
          throw new AutomationError("CARD_DEPENDENTS_CHANGED", "Os dependentes mudaram desde a confirmacao. Refaca o pedido para conferir a lista atual.", { step: "confirm_card_dependents" });
        }
        if (!confirmation.decision) {
          const result = { ...operation.result, beneficiaryName, cardDependentConfirmation: confirmation };
          await context.repository.update(operation.id, { result });
          assertNotAborted(signal);
          Object.assign(operation, { result });
          await context.updateStatus("awaiting_confirmation", "Aguardando escolha sobre as carteirinhas dos dependentes", result);
          assertNotAborted(signal);
          if (credential) context.retainCardConfirmationCredential?.(operation, credential);
          return;
        }
        if (confirmation.decision === "with") selected = await cardPage.selectBeneficiaries([family.beneficiary, ...family.dependents], true);
        else {
          selected = [await cardPage.selectBeneficiary(family.beneficiary, family.automaticCompanions ?? family.dependents)];
        }
      } else selected = [await cardPage.selectBeneficiary(family.beneficiary, family.automaticCompanions ?? [])];
    }
    if (!selected.length) throw new AutomationError("BENEFICIARY_NOT_FOUND", "Nao ha beneficiarios disponiveis para emitir.", { step: "find_beneficiary" });
    assertNotAborted(signal);

    const deliveryMembers = await cardPage.describeSelectedBeneficiaries(selected);
    assertNotAborted(signal);
    await context.updateStatus("processing", "Emitindo carteirinha");
    const resultPage = await cardPage.requestSelectedCards(selected, allBeneficiaries, async command => {
      await context.emitEvent({ operationId: operation.id, type: "operation.step", step: "card_print_requested",
        data: { operator: portal, command, beneficiaryScope: allBeneficiaries ? "all" : "single", beneficiaryCount: selected.length } });
    });
    const resultCardPage = new HapvidaCardPage(resultPage, context.config.actionTimeoutMs ?? 30_000, portalUrl);
    assertNotAborted(signal);

    await context.updateStatus("verifying", "Validando carteirinha gerada");
    const multipleCards = allBeneficiaries || selected.length > 1;
    const documents = multipleCards
      ? await resultCardPage.waitForCardPreviews(selected)
      : [await resultCardPage.waitForCardPreview(selected[0]!)].filter((frame): frame is NonNullable<typeof frame> => Boolean(frame));
    assertNotAborted(signal);

    const fileName = allBeneficiaries ? `carteirinhas-empresa-${safeFileNamePart(requestedCompanyCode!)}.pdf`
      : `${safeFileNamePart(beneficiaryName)}.pdf`;
    const pdfTitle = allBeneficiaries ? `carteirinhas da empresa ${requestedCompanyCode!.toLowerCase()}` : beneficiaryName.trim().toLocaleLowerCase("pt-BR");
    await context.updateStatus("verifying", "Organizando carteirinhas na moldura Alaive");
    const delivery = await createBrandedCardDelivery(resultPage, documents, deliveryMembers, otherBeneficiaries, pdfTitle, signal);
    assertNotAborted(signal);
    const pdfBytes = validateCardPdfBytes(delivery.bytes, fileName);
    const savedArtifact = await context.artifactStorage.save({
      operationId: operation.id,
      workspaceId: operation.workspaceId,
      fileName,
      mimeType: "application/pdf",
      bytes: pdfBytes,
      type: "card_pdf",
      metadata: {
        beneficiaryName: allBeneficiaries ? undefined : beneficiaryName,
        beneficiaryScope: allBeneficiaries ? "all" : "single",
        beneficiaryCount: selected.length,
        cardDeliveryVersion: delivery.deliveryVersion,
        pageCount: delivery.pageCount,
        companyId: operation.companyId,
        operator: operation.portal,
      },
    });

    const artifact: OperationArtifact = {
      id: crypto.randomUUID(),
      fileName: savedArtifact.fileName,
      path: savedArtifact.storagePath,
      storageProvider: savedArtifact.storageProvider,
      bucket: savedArtifact.bucket,
      storagePath: savedArtifact.storagePath,
      mimeType: savedArtifact.mimeType,
      sizeBytes: savedArtifact.sizeBytes,
      checksum: savedArtifact.checksum,
      kind: "pdf",
      createdAt: new Date().toISOString(),
    };

    const current = await context.repository.get(operation.id);
    const result: OperationResult = {
      ...current?.result,
      beneficiaryName: allBeneficiaries ? undefined : beneficiaryName,
      beneficiaryScope: allBeneficiaries ? "all" : "single",
      beneficiaryCount: selected.length,
      beneficiaryNames: selected.map(input => input.beneficiaryName),
      cardDeliveryVersion: delivery.deliveryVersion,
      pageCount: delivery.pageCount,
      companyId: operation.companyId,
      operator: operation.portal,
      portalStatus: allBeneficiaries ? `${selected.length} carteirinhas emitidas` : "Carteirinha emitida",
      artifactId: artifact.id,
      finishedAt: new Date().toISOString(),
    };

    await context.repository.update(operation.id, {
      artifacts: [...(current?.artifacts ?? []), artifact],
      result,
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });

    await context.emitEvent({
      operationId: operation.id,
      type: "artifact.created",
      status: "verifying",
      step: "card_pdf_created",
      data: { artifactId: artifact.id, fileName: artifact.fileName, mimeType: artifact.mimeType },
    });
    await context.updateStatus("success", allBeneficiaries ? `${selected.length} carteirinhas emitidas e validadas` : "Carteirinha emitida e validada", {
      beneficiaryName: allBeneficiaries ? undefined : beneficiaryName,
      beneficiaryCount: selected.length,
      artifactId: artifact.id,
      fileName: artifact.fileName,
    });
      });
      return;
    } catch (error) {
      if (
        signal.aborted ||
        portalAttempt >= CARD_PORTAL_AUTH_MAX_ATTEMPTS ||
        !isRetryablePortalAuthenticationFailure(error)
      ) {
        throw error;
      }

      await context.browserManager.invalidateSession(portal).catch(() => undefined);
      await context.updateStatus("authenticating", `Reabrindo portal ${portalLabel} para nova tentativa`, {
        attempt: portalAttempt + 1,
        maxAttempts: CARD_PORTAL_AUTH_MAX_ATTEMPTS,
        reason: "PORTAL_AUTH_UNAVAILABLE",
      });
      await context.emitEvent({
        operationId: operation.id,
        type: "authentication.started",
        status: "authenticating",
        step: "portal_auth_retrying",
        data: {
          attempt: portalAttempt + 1,
          maxAttempts: CARD_PORTAL_AUTH_MAX_ATTEMPTS,
          reason: "PORTAL_AUTH_UNAVAILABLE",
        },
      });
    }
  }
}

