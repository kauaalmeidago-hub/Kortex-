import { AutomationError, assertNotAborted } from "../errors.js";
import { credentialRefForLogin, normalizePortalLoginCode, portalLoginCode } from "../credentials/credentialIdentity.js";
import type { OperationRecord, PortalCredential, PortalName } from "../types.js";
import type { WorkflowContext } from "./WorkflowContext.js";
import { emitCard } from "./hapvida/emitCard.js";
import { isAllBeneficiariesRequest } from "./hapvida/cardIssueScope.js";
import { sanitizeDiagnosticText } from "../security/redaction.js";
import { CARD_ISSUE_WORKFLOW_VERSION, cardWorkflowRuntime } from "./CardWorkflowRuntime.js";

type SearchProgress = { version: number; contractCode?: string; requestKey: string; notFound: PortalName[]; visited: PortalName[] };
const SEARCH_VERSION = 3;
const portals: PortalName[] = ["hapvida", "ndi"];
const canSearchAnotherPortal = new Set(["AUTHENTICATION_FAILED", "REAUTH_REQUIRED", "BENEFICIARY_NOT_FOUND",
  "BENEFICIARY_NOT_ACTIVE", "ACTIVE_USERS_LIST_UNAVAILABLE", "PORTAL_URL_NOT_CONFIGURED", "PORTAL_AUTH_UNAVAILABLE", "CARD_PORTAL_UNAVAILABLE"]);
const conclusiveAccessOutcomes = new Set(["AUTHENTICATION_FAILED", "BENEFICIARY_NOT_FOUND", "BENEFICIARY_NOT_ACTIVE"]);

export async function searchCardPortals(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext) {
  // Every card request may search both operators, including old single-portal requests.
  if (operation.input.portalSearch !== "auto") {
    operation.input = { ...operation.input, portalSearch: "auto" };
    await context.repository.update(operation.id, { input: operation.input });
  }

  const contractCode = portalLoginCode(operation.input);
  if (contractCode && operation.input.contractCode !== contractCode) {
    operation.input = { ...operation.input, contractCode };
    await context.repository.update(operation.id, { input: operation.input });
  }
  const requestKey = JSON.stringify([operation.companyId, contractCode, operation.input.beneficiaryName, operation.input.cpf, operation.input.cardNumber,
    operation.input.birthDate, operation.input.periodStart ?? operation.input.startDate, operation.input.periodEnd ?? operation.input.endDate,
    ...(isAllBeneficiariesRequest(operation.input) ? ["all"] : [])]);
  const previous = operation.result?.cardPortalSearch as Partial<SearchProgress> | undefined;
  const progress: SearchProgress = {
    version: SEARCH_VERSION,
    contractCode,
    requestKey,
    // Portal data can change while a request waits for access. Recheck rather than replay an old absence.
    notFound: [],
    visited: [],
  };
  const original = { portal: operation.portal, credentialRef: operation.credentialRef, credentialId: operation.credentialId };
  // A verified access for this exact company/code avoids probing the wrong portal on every new request.
  // A resumed authentication request keeps its current portal and its operation-scoped RAM credential.
  const preferred = contractCode && previous?.requestKey !== requestKey
    ? await context.credentialResolver?.preferredCardPortal?.({ companyId: operation.companyId, portalLoginCode: contractCode })
    : undefined;
  const first = preferred ?? original.portal;
  const order = [first, ...portals.filter(portal => portal !== first)];
  const failures: Array<{ portal: PortalName; error: AutomationError }> = [];
  let submittedCredential: PortalCredential | undefined;

  const bind = async (portal: PortalName) => {
    const expectedRef = credentialRefForLogin(operation.companyId, portal, contractCode);
    const candidate = !contractCode && portal === original.portal ? original
      : await context.credentialResolver?.resolve({ companyId: operation.companyId, operator: portal, portalLoginCode: contractCode })
        ?? { credentialRef: expectedRef, credentialId: undefined };
    // Rebind even the initial portal: persisted legacy requests may carry another operator's reference.
    const resolved = contractCode && candidate.credentialRef !== expectedRef
      ? { credentialRef: expectedRef, credentialId: undefined } : candidate;
    const patch = { portal, credentialRef: resolved.credentialRef, credentialId: resolved.credentialId,
      result: { ...operation.result, cardPortalSearch: { ...progress, visited: [...progress.visited], notFound: [...progress.notFound] } } };
    const updated = await context.repository.update(operation.id, patch);
    if (!updated) throw new AutomationError("OPERATION_NOT_FOUND", "O pedido nao esta mais disponivel.");
    Object.assign(operation, patch);
  };

  for (const portal of order) {
    assertNotAborted(signal);
    progress.visited.push(portal);
    await bind(portal);
    await context.updateStatus("authenticating", `Buscando carteirinha no portal ${portal === "ndi" ? "NDI" : "Hapvida"}`);
    await context.emitEvent({ operationId: operation.id, type: "operation.step", step: "card_portal_search",
      data: { operator: portal, portalsChecked: [...progress.visited], workflowVersion: CARD_ISSUE_WORKFLOW_VERSION,
        runtime: cardWorkflowRuntime() } });

    let phase: "access" | "selection" | "printing" | "delivery" = "access";
    try {
      let savedOtherCredential: PortalCredential | undefined;
      const runAttempt = (useSubmitted = false) => emitCard(operation, signal, {
        ...context,
        config: { ...context.config, features: { ...context.config.features, cardIssueActiveUsersPreflight: false } },
        setCardIssuePhase: next => { phase = next; context.setCardIssuePhase?.(next); },
        secretProvider: { get: async ref => {
          // Only an explicitly submitted credential for this automatic search may cross portals in RAM.
          // Saved credentials remain scoped to their own operator, company and login code.
          submittedCredential ??= context.secretProvider.takeAutomaticSearchCredential?.(original.credentialRef);
          if (submittedCredential) {
            if (useSubmitted || portal === original.portal) return submittedCredential;
            // The other operator may have a different, already validated password for this same code.
            // Try that operator's own saved access before falling back to the submitted RAM credential.
            const saved = await context.secretProvider.get(ref).catch(error => {
              if (error instanceof AutomationError && error.code === "CREDENTIAL_STORE_UNAVAILABLE") throw error;
              return undefined;
            });
            if (saved && (!contractCode || normalizePortalLoginCode(saved.username) === contractCode)) {
              savedOtherCredential = saved;
              return saved;
            }
            return submittedCredential;
          }
          const credential = await context.secretProvider.get(ref);
          if (credential.metadata?.autoPortalCredential === true) submittedCredential = credential;
          return credential;
        } },
      });
      try { await runAttempt(); }
      catch (error) {
        if (!(error instanceof AutomationError) || error.code !== "AUTHENTICATION_FAILED" || !savedOtherCredential || !submittedCredential ||
          (savedOtherCredential.username === submittedCredential.username && savedOtherCredential.password === submittedCredential.password)) throw error;
        assertNotAborted(signal);
        await runAttempt(true);
      }
      return;
    } catch (caught) {
      assertNotAborted(signal);
      let error = caught;
      const browserDetails = caught instanceof AutomationError ? caught.safeDetails ?? caught.message
        : caught instanceof Error ? caught.message : "";
      if (phase === "access" && caught instanceof Error &&
          (!(caught instanceof AutomationError) || caught.code === "WORKER_ERROR") &&
          (caught.name === "TimeoutError" || /\b(?:locator|page|frame|browserContext|browserType|chromium)\.|navigation|(?:browser|target).*(?:closed|crash)|frame.*detached/i.test(browserDetails))) {
        error = new AutomationError("CARD_PORTAL_UNAVAILABLE", `O portal ${portal === "ndi" ? "NDI" : "Hapvida"} nao concluiu a consulta.`, {
          safeDetails: sanitizeDiagnosticText(browserDetails), step: "access_card_portal", retryable: true,
        });
      }
      if (!(error instanceof AutomationError)) throw error;
      const listFailureBeforeSelection = error.code === "PORTAL_RESULTS_NOT_READY" ||
        (error.code === "PORTAL_CHANGED" && error.step === "select_beneficiary");
      if (!canSearchAnotherPortal.has(error.code) && !listFailureBeforeSelection) throw error;
      if (phase !== "access") throw error;
      // Never switch after selecting/printing a card, an ambiguous match, or an invalid PDF.
      failures.push({ portal, error });
      if (error.code === "BENEFICIARY_NOT_FOUND") progress.notFound.push(portal);
      operation.result = { ...operation.result, cardPortalSearch: { ...progress, visited: [...progress.visited], notFound: [...progress.notFound] } };
      await context.repository.update(operation.id, { result: operation.result });
      await context.emitEvent({ operationId: operation.id, type: "operation.step", step: "card_portal_search_result",
        data: { operator: portal, outcome: error.code, failedStep: error.step,
          safeDetails: sanitizeDiagnosticText(error.safeDetails ?? error.message)?.slice(0, 2000) } });
    }
  }

  const needsAuth = failures.find(item => item.error.code === "REAUTH_REQUIRED");
  if (needsAuth) {
    await bind(needsAuth.portal);
    throw needsAuth.error;
  }
  const authFailure = failures.find(item => item.error.code === "AUTHENTICATION_FAILED");
  // A rejection on the wrong operator cannot prove the submitted access is wrong while
  // the other portal is unavailable. Do not consume a password attempt or bind the next
  // password challenge to that rejected operator until both access outcomes are known.
  if (authFailure && failures.every(item => conclusiveAccessOutcomes.has(item.error.code))) {
    await bind(authFailure.portal);
    const label = authFailure.portal === "ndi" ? "NDI" : "Hapvida";
    throw new AutomationError("AUTHENTICATION_FAILED", `O acesso ${label} nao foi aceito. Confira o codigo da empresa e a senha desse portal.`, {
      safeDetails: failures.map(item => `${item.portal === "ndi" ? "NDI" : "Hapvida"}: ${item.error.code}`).join("; "), step: "authenticate", retryable: false,
    });
  }
  if (portals.every(portal => progress.notFound.includes(portal))) {
    throw new AutomationError("BENEFICIARY_NOT_FOUND", "Beneficiario nao encontrado em Hapvida ou NDI.", {
      safeDetails: "Os dois portais foram consultados para o codigo e periodo informados.", step: "find_beneficiary", retryable: false,
    });
  }
  const inactive = failures.find(item => item.error.code === "BENEFICIARY_NOT_ACTIVE");
  if (inactive && failures.every(item => ["BENEFICIARY_NOT_FOUND", "BENEFICIARY_NOT_ACTIVE"].includes(item.error.code))) {
    throw new AutomationError("BENEFICIARY_NOT_ACTIVE", "Nao foi encontrado um vinculo disponivel para emissao nos portais consultados.", {
      safeDetails: failures.map(item => `${item.portal === "ndi" ? "NDI" : "Hapvida"}: ${item.error.code}`).join("; "),
      step: "find_beneficiary", retryable: false,
    });
  }
  const unavailable = failures.filter(item => !conclusiveAccessOutcomes.has(item.error.code));
  const unavailableLabels = unavailable.map(item => item.portal === "ndi" ? "NDI" : "Hapvida").join(" e ");
  throw new AutomationError("CARD_PORTAL_SEARCH_INCOMPLETE", `A consulta em ${unavailableLabels} nao foi concluida. Tente novamente quando o portal estiver disponivel.`, {
    safeDetails: failures.map(item => `${item.portal === "ndi" ? "NDI" : "Hapvida"}: ${item.error.code}`).join("; "),
    step: "card_portal_search", retryable: true,
  });
}
