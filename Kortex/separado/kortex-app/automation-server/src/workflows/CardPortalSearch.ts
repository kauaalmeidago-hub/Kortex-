import { AutomationError, assertNotAborted } from "../errors.js";
import { credentialRefForLogin, portalLoginCode } from "../credentials/credentialIdentity.js";
import type { OperationRecord, PortalCredential, PortalName } from "../types.js";
import type { WorkflowContext } from "./WorkflowContext.js";
import { emitCard } from "./hapvida/emitCard.js";
import { isAllBeneficiariesRequest } from "./hapvida/cardIssueScope.js";

type SearchProgress = { contractCode?: string; requestKey: string; notFound: PortalName[]; visited: PortalName[] };
const portals: PortalName[] = ["hapvida", "ndi"];
const canSearchAnotherPortal = new Set(["AUTHENTICATION_FAILED", "REAUTH_REQUIRED", "BENEFICIARY_NOT_FOUND",
  "BENEFICIARY_NOT_ACTIVE", "ACTIVE_USERS_LIST_UNAVAILABLE", "PORTAL_URL_NOT_CONFIGURED", "PORTAL_AUTH_UNAVAILABLE"]);

export async function searchCardPortals(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext) {
  if (operation.input.portalSearch === "selected") return emitCard(operation, signal, context);
  if (operation.input.portalSearch !== "auto") {
    operation.input = { ...operation.input, portalSearch: "auto" };
    await context.repository.update(operation.id, { input: operation.input });
  }

  const contractCode = portalLoginCode(operation.input);
  const requestKey = JSON.stringify([operation.companyId, contractCode, operation.input.beneficiaryName, operation.input.cpf, operation.input.cardNumber,
    operation.input.birthDate, operation.input.periodStart ?? operation.input.startDate, operation.input.periodEnd ?? operation.input.endDate,
    ...(isAllBeneficiariesRequest(operation.input) ? ["all"] : [])]);
  const previous = operation.result?.cardPortalSearch as Partial<SearchProgress> | undefined;
  const progress: SearchProgress = {
    contractCode,
    requestKey,
    notFound: previous && previous.requestKey === requestKey && Array.isArray(previous.notFound)
      ? previous.notFound.filter((portal): portal is PortalName => portals.includes(portal as PortalName)) : [],
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
    const resolved = portal === original.portal
      ? original
      : await context.credentialResolver?.resolve({ companyId: operation.companyId, operator: portal, portalLoginCode: contractCode })
        ?? { credentialRef: credentialRefForLogin(operation.companyId, portal, contractCode), credentialId: undefined };
    const patch = { portal, credentialRef: resolved.credentialRef, credentialId: resolved.credentialId,
      result: { ...operation.result, cardPortalSearch: { ...progress, visited: [...progress.visited], notFound: [...progress.notFound] } } };
    const updated = await context.repository.update(operation.id, patch);
    if (!updated) throw new AutomationError("OPERATION_NOT_FOUND", "O pedido nao esta mais disponivel.");
    Object.assign(operation, patch);
  };

  for (const portal of order) {
    assertNotAborted(signal);
    if (progress.notFound.includes(portal)) continue;
    progress.visited.push(portal);
    await bind(portal);
    await context.updateStatus("authenticating", `Buscando carteirinha no portal ${portal === "ndi" ? "NDI" : "Hapvida"}`);
    await context.emitEvent({ operationId: operation.id, type: "operation.step", step: "card_portal_search",
      data: { operator: portal, portalsChecked: [...progress.visited] } });

    try {
      let savedOtherCredential: PortalCredential | undefined;
      const runAttempt = (useSubmitted = false) => emitCard(operation, signal, {
        ...context,
        secretProvider: { get: async ref => {
          // Only an explicitly submitted credential for this automatic search may cross portals in RAM.
          // Saved credentials remain scoped to their own operator, company and login code.
          submittedCredential ??= context.secretProvider.takeAutomaticSearchCredential?.(original.credentialRef);
          if (submittedCredential) {
            if (useSubmitted || portal === original.portal) return submittedCredential;
            // The other operator may have a different, already validated password for this same code.
            // Try that operator's own saved access before falling back to the submitted RAM credential.
            const saved = await context.secretProvider.get(ref).catch(() => undefined);
            if (saved && (!contractCode || saved.username.trim() === contractCode)) {
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
    } catch (error) {
      assertNotAborted(signal);
      if (!(error instanceof AutomationError)) throw error;
      const listFailureBeforeSelection = error.code === "PORTAL_RESULTS_NOT_READY" ||
        (error.code === "PORTAL_CHANGED" && error.step === "select_beneficiary");
      if (!canSearchAnotherPortal.has(error.code) && !listFailureBeforeSelection) throw error;
      // Never switch after selecting/printing a card, an ambiguous match, or an invalid PDF.
      failures.push({ portal, error });
      if (error.code === "BENEFICIARY_NOT_FOUND") progress.notFound.push(portal);
      operation.result = { ...operation.result, cardPortalSearch: { ...progress, visited: [...progress.visited], notFound: [...progress.notFound] } };
      await context.repository.update(operation.id, { result: operation.result });
      await context.emitEvent({ operationId: operation.id, type: "operation.step", step: "card_portal_search_result",
        data: { operator: portal, outcome: error.code } });
    }
  }

  const needsAuth = failures.find(item => item.error.code === "REAUTH_REQUIRED");
  if (needsAuth) {
    await bind(needsAuth.portal);
    throw needsAuth.error;
  }
  const authFailure = failures.find(item => item.error.code === "AUTHENTICATION_FAILED");
  if (authFailure) {
    await bind(authFailure.portal);
    const label = authFailure.portal === "ndi" ? "NDI" : "Hapvida";
    throw new AutomationError("AUTHENTICATION_FAILED", `O acesso ${label} nao foi aceito. Informe a senha desse portal ou revise o nome e periodo da consulta.`, {
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
  throw new AutomationError("CARD_PORTAL_SEARCH_INCOMPLETE", "Nao foi possivel concluir a busca nos dois portais.", {
    safeDetails: failures.map(item => `${item.portal === "ndi" ? "NDI" : "Hapvida"}: ${item.error.code}`).join("; "),
    step: "card_portal_search", retryable: true,
  });
}
