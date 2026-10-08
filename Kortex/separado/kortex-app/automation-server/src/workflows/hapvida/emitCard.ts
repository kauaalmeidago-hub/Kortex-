import type { Page } from "playwright";
import { AutomationError, assertNotAborted, createReauthRequiredError } from "../../errors.js";
import type { OperationArtifact, OperationRecord, OperationResult, PortalCredential } from "../../types.js";
import type { WorkflowContext } from "../WorkflowContext.js";
import { requireInput } from "./validators.js";
import { ActiveUsersPreflightService } from "./ActiveUsersPreflightService.js";
import { HapvidaLoginPage } from "./pageObjects/HapvidaLoginPage.js";
import { HapvidaCardPage } from "./pageObjects/HapvidaCardPage.js";
import { HapvidaMovementAccessPage } from "./pageObjects/HapvidaMovementAccessPage.js";
import { HapvidaMovementMainMenuPage } from "./pageObjects/HapvidaMovementMainMenuPage.js";
import { HapvidaActiveUsersPage } from "./pageObjects/HapvidaActiveUsersPage.js";
import { validateCardPdfBytes } from "./downloadValidation.js";

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

async function printCurrentPageToPdf(page: Page) {
  try {
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
  } catch {
    const session = await page.context().newCDPSession(page);
    try {
      const pdf = await session.send("Page.printToPDF", {
        printBackground: true,
        preferCSSPageSize: true,
      });
      return Buffer.from(pdf.data, "base64");
    } finally {
      await session.detach().catch(() => undefined);
    }
  }
}

export async function emitCard(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext) {
  requireInput(operation.input, ["beneficiaryName"]);

  const beneficiaryName = readString(operation.input, ["beneficiaryName"]);
  const periodStart = toPortalDate(readString(operation.input, ["periodStart", "startDate"]), "Data inicial");
  const periodEnd = toPortalDate(readString(operation.input, ["periodEnd", "endDate"]), "Data final");
  const cpf = readString(operation.input, ["cpf"]);
  const birthDate = readString(operation.input, ["birthDate"]);

  if (!beneficiaryName) {
    throw new AutomationError("MISSING_REQUIRED_DATA", "Nome do beneficiario nao informado.", {
      safeDetails: "Informe o nome completo do beneficiario antes de emitir a carteirinha.",
      step: "validate_input",
      retryable: false,
    });
  }

  await context.browserManager.withContext(operation, signal, async (browserContext, page) => {
    const loginPage = new HapvidaLoginPage(page, context.config.hapvidaCardPortalUrl ?? context.config.hapvidaPortalUrl);
    const cardPage = new HapvidaCardPage(page);
    const portalUrl = context.config.hapvidaCardPortalUrl ?? context.config.hapvidaPortalUrl;
    const movementPortalUrl = context.config.hapvidaMovementPortalUrl;
    const movementAccessPage = new HapvidaMovementAccessPage(page, movementPortalUrl);
    const menuPage = new HapvidaMovementMainMenuPage(page);
    const activeUsersPage = new HapvidaActiveUsersPage(page);
    let credential: PortalCredential | undefined;

    if (portalUrl) {
      context.browserManager.validateAllowedUrl(portalUrl, operation);
    }

    if (movementPortalUrl) {
      context.browserManager.validateAllowedUrl(movementPortalUrl, operation);
    }

    const loadCredential = async () => {
      if (credential) return credential;
      await context.updateStatus("authenticating", "Carregando credencial segura");
      credential = await context.secretProvider.get(operation.credentialRef).catch(() => {
        throw createReauthRequiredError(
          "Nao foi possivel renovar a sessao Hapvida sem uma credencial segura cadastrada para o Koa.",
        );
      });
      assertNotAborted(signal);
      return credential;
    };

    const activeUsersCheck = context.config.features.cardIssueActiveUsersPreflight
      ? await (async () => {
          await context.updateStatus("authenticating", "Abrindo Sistema de Movimentacao Hapvida");
          await movementAccessPage.open().catch((error) => {
            if (error instanceof AutomationError && error.code === "PORTAL_URL_NOT_CONFIGURED") {
              throw new AutomationError("ACTIVE_USERS_LIST_UNAVAILABLE", "URL do Sistema de Movimentacao Hapvida nao configurada.", {
                safeDetails:
                  "Configure HAPVIDA_MOVEMENT_PORTAL_URL para executar o pre-check da Lista Usuarios Ativos.",
                step: "checking_active_users",
                retryable: false,
              });
            }
            throw error;
          });
          assertNotAborted(signal);

          await context.updateStatus("authenticating", "Selecionando acesso da empresa");
          const movementMenuAlreadyLoaded = await menuPage.quickAccessHeading().or(menuPage.menuHeading()).isVisible().catch(() => false);
          if (!movementMenuAlreadyLoaded) {
            await movementAccessPage.login(await loadCredential());
          }
          await menuPage.waitForLoaded();
          assertNotAborted(signal);

          const preflightResult = await new ActiveUsersPreflightService({
            operation,
            context,
            signal,
            menuPage,
            activeUsersPage,
          }).validateCardIssue({ beneficiaryName, beneficiaryCpf: cpf });
          assertNotAborted(signal);
          return preflightResult;
        })()
      : undefined;

    await context.updateStatus("authenticating", "Abrindo portal de carteirinha Hapvida");
    await loginPage.open();
    assertNotAborted(signal);

    await context.updateStatus("authenticating", "Validando sessao Hapvida do perfil Koa");
    const hasValidSession = await context.browserManager.validatePortalSession("hapvida", page);
    assertNotAborted(signal);

    if (hasValidSession) {
      await context.browserManager.saveSession(browserContext, "hapvida");
    } else {
      await context.browserManager.invalidateSession("hapvida");
      await context.updateStatus("authenticating", "Autenticando no portal");
      await loginPage.login(await loadCredential());
      assertNotAborted(signal);

      const sessionAfterLogin = await context.browserManager.validatePortalSession("hapvida", page);
      if (!sessionAfterLogin) {
        if (await loginPage.invalidIdentificationMessage().isVisible().catch(() => false)) {
          throw new AutomationError("AUTHENTICATION_FAILED", "Credencial Hapvida nao aceita pelo portal.", {
            safeDetails: "O portal retornou Identificacao invalida para o codigo/senha cadastrados.",
            step: "authenticate",
            retryable: false,
          });
        }

        if (await loginPage.passwordStillVisible()) {
          throw new AutomationError("AUTHENTICATION_FAILED", "Credencial Hapvida nao confirmou acesso ao portal.", {
            safeDetails: "O portal continuou na tela de login apos o envio da credencial.",
            step: "authenticate",
            retryable: false,
          });
        }

        throw createReauthRequiredError("Login executado, mas o portal Hapvida nao confirmou uma sessao autenticada.");
      }

      await context.browserManager.saveSession(browserContext, "hapvida");
    }

    assertNotAborted(signal);

    await context.updateStatus("accessing_portal", "Acessando emissao de carteirinha");
    await cardPage.waitForPeriodForm();
    assertNotAborted(signal);

    await context.updateStatus("processing", "Informando periodo de adesao");
    await cardPage.fillPeriod(periodStart, periodEnd);
    await cardPage.submitPeriod();
    assertNotAborted(signal);

    await context.updateStatus("processing", "Localizando beneficiario");
    await cardPage.selectBeneficiary({ beneficiaryName, cpf, birthDate });
    assertNotAborted(signal);

    await context.updateStatus("processing", "Emitindo carteirinha");
    const resultPage = await cardPage.requestSelectedCards();
    const resultCardPage = new HapvidaCardPage(resultPage);
    assertNotAborted(signal);

    await context.updateStatus("verifying", "Validando carteirinha gerada");
    await resultCardPage.waitForCardPreview({ beneficiaryName, cpf, birthDate });
    assertNotAborted(signal);

    const fileName = `carteirinha-${operation.id}.pdf`;
    const pdfBytes = validateCardPdfBytes(await printCurrentPageToPdf(resultPage), fileName);
    const savedArtifact = await context.artifactStorage.save({
      operationId: operation.id,
      workspaceId: operation.workspaceId,
      fileName,
      mimeType: "application/pdf",
      bytes: pdfBytes,
      type: "card_pdf",
      metadata: {
        beneficiaryName,
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
      beneficiaryName,
      companyId: operation.companyId,
      operator: operation.portal,
      portalStatus: "Carteirinha emitida",
      artifactId: artifact.id,
      activeUser: activeUsersCheck?.snapshot.target,
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
    await context.updateStatus("success", "Carteirinha emitida e validada", {
      beneficiaryName,
      artifactId: artifact.id,
      fileName: artifact.fileName,
    });
  });
}
