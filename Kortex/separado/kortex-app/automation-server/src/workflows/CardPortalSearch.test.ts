import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationRepository } from "../db/OperationRepository.js";
import { ExplicitCredentialResolver } from "../credentials/CredentialResolver.js";
import { AutomationError, createReauthRequiredError } from "../errors.js";
import { EphemeralCredentialStore, OperationScopedSecretProvider } from "../secrets/EphemeralCredentialStore.js";
import type { OperationRecord, PortalName } from "../types.js";
import type { WorkflowContext } from "./WorkflowContext.js";

const mocks = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock("./hapvida/emitCard.js", () => ({ emitCard: mocks.emit }));
import { searchCardPortals } from "./CardPortalSearch.js";
import { WorkflowRegistry } from "./WorkflowRegistry.js";

const repositories: OperationRepository[] = [];
function fixture(portal: PortalName = "hapvida") {
  const now = new Date().toISOString();
  const operation: OperationRecord = { id: "card-search", type: "CARD_ISSUE", status: "starting", companyId: "company-1",
    portal, credentialId: "old-credential-id", credentialRef: `${portal}:company-1:login:0ABC`,
    input: { portalSearch: "auto", contractCode: "0ABC", beneficiaryName: "BENEFICIARIO DE TESTE", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
    artifacts: [], createdAt: now, updatedAt: now };
  const repository = new OperationRepository(":memory:");
  repositories.push(repository); repository.create(operation);
  const resolve = vi.spyOn(new ExplicitCredentialResolver(), "resolve");
  const context = { repository, credentialResolver: { resolve }, secretProvider: { get: vi.fn() },
    updateStatus: vi.fn(async () => undefined), emitEvent: vi.fn(async event => event),
  } as unknown as WorkflowContext;
  const controller = new AbortController();
  return { operation, repository, context, resolve, controller };
}
const notFound = () => new AutomationError("BENEFICIARY_NOT_FOUND", "Nao encontrado.", { step: "find_beneficiary" });
const visited = () => mocks.emit.mock.calls.map(([operation]) => operation.portal);

beforeEach(() => { mocks.emit.mockReset(); });
afterEach(() => { repositories.splice(0).forEach(repository => repository.close()); });

describe("automatic card portal search", () => {
  it("starts with the saved verified NDI portal for this exact company/code", async () => {
    const f = fixture(), calls: string[] = [];
    const preferredCardPortal = vi.fn(async () => "ndi" as const);
    f.context.credentialResolver!.preferredCardPortal = preferredCardPortal;
    mocks.emit.mockImplementation(async (operation: OperationRecord) => { calls.push(operation.portal); });
    await searchCardPortals(f.operation, f.controller.signal, f.context);
    expect(calls).toEqual(["ndi"]);
    expect(preferredCardPortal).toHaveBeenCalledWith({ companyId: "company-1", portalLoginCode: "0ABC" });
    expect(f.operation.credentialRef).toBe("ndi:company-1:login:0ABC");
  });

  it("still consults Hapvida if the verified NDI portal does not find the requested beneficiary", async () => {
    const f = fixture(), calls: string[] = [];
    f.context.credentialResolver!.preferredCardPortal = async () => "ndi";
    mocks.emit.mockImplementation(async (operation: OperationRecord) => {
      calls.push(operation.portal); if (operation.portal === "ndi") throw notFound();
    });
    await searchCardPortals(f.operation, f.controller.signal, f.context);
    expect(calls).toEqual(["ndi", "hapvida"]);
  });

  it("chooses portals independently when different companies use the same login code", async () => {
    const calls: string[] = [];
    for (const companyId of ["company-1", "company-2"]) {
      const f = fixture(); f.operation.companyId = companyId;
      f.operation.credentialRef = `hapvida:${companyId}:login:0ABC`;
      await f.repository.update(f.operation.id, { companyId, credentialRef: f.operation.credentialRef });
      f.context.credentialResolver!.preferredCardPortal = async input => input.companyId === "company-1" ? "ndi" : "hapvida";
      mocks.emit.mockImplementation(async (operation: OperationRecord) => { calls.push(`${operation.companyId}:${operation.portal}`); });
      await searchCardPortals(f.operation, f.controller.signal, f.context);
    }
    expect(calls).toEqual(["company-1:ndi", "company-2:hapvida"]);
  });

  it("keeps a resumed authentication request on its current portal", async () => {
    const f = fixture();
    const preferredCardPortal = vi.fn(async () => "ndi" as const);
    f.context.credentialResolver!.preferredCardPortal = preferredCardPortal;
    f.operation.result = { cardPortalSearch: { requestKey: JSON.stringify(["0ABC", "BENEFICIARIO DE TESTE", null, null, "2026-10-01", "2026-10-31"]),
      visited: ["ndi", "hapvida"], notFound: ["ndi"] } };
    const calls: string[] = [];
    mocks.emit.mockImplementation(async (operation: OperationRecord) => { calls.push(operation.portal); });
    await searchCardPortals(f.operation, f.controller.signal, f.context);
    expect(calls).toEqual(["hapvida"]); expect(preferredCardPortal).not.toHaveBeenCalled();
  });

  it("consumes the request's submitted RAM credential when a verified portal changes the first attempt", async () => {
    const f = fixture(), store = new EphemeralCredentialStore();
    const submitted = { username: "0ABC", password: "new-synthetic-password", metadata: { autoPortalCredential: true } };
    store.put(f.operation.id, f.operation.credentialRef, submitted, 60000);
    const fallback = { get: vi.fn(async () => { throw new Error("Saved access must not replace the submitted password"); }) };
    f.context.secretProvider = new OperationScopedSecretProvider(f.operation.id, store, fallback);
    f.context.credentialResolver!.preferredCardPortal = async () => "ndi";
    mocks.emit.mockImplementation(async (operation: OperationRecord, _signal, context: WorkflowContext) => {
      expect(operation.portal).toBe("ndi"); expect(await context.secretProvider.get(operation.credentialRef)).toEqual(submitted);
    });
    await searchCardPortals(f.operation, f.controller.signal, f.context);
    expect(store.get(f.operation.id, "hapvida:company-1:login:0ABC")).toBeUndefined();
    expect(fallback.get).not.toHaveBeenCalled();
    expect(JSON.stringify(f.repository.get(f.operation.id))).not.toContain(submitted.password);
  });

  it("preserves an explicit selected portal even if another operator has a verified access", async () => {
    const f = fixture(); f.operation.input.portalSearch = "selected";
    const preferredCardPortal = vi.fn(async () => "ndi" as const);
    f.context.credentialResolver!.preferredCardPortal = preferredCardPortal;
    const calls: string[] = [];
    mocks.emit.mockImplementation(async (operation: OperationRecord) => { calls.push(operation.portal); });
    await searchCardPortals(f.operation, f.controller.signal, f.context);
    expect(calls).toEqual(["hapvida"]); expect(preferredCardPortal).not.toHaveBeenCalled();
  });

  it("upgrades a legacy request to automatic search before continuing to NDI", async () => {
    const f = fixture(); delete f.operation.input.portalSearch;
    await f.repository.update(f.operation.id, { input: f.operation.input });
    const calls: string[] = [];
    mocks.emit.mockImplementation(async (operation: OperationRecord) => {
      calls.push(operation.portal);
      expect(operation.input.portalSearch).toBe("auto");
      if (operation.portal === "hapvida") throw new AutomationError("AUTHENTICATION_FAILED", "Acesso rejeitado.");
    });
    await searchCardPortals(f.operation, f.controller.signal, f.context);
    expect(calls).toEqual(["hapvida", "ndi"]);
    expect(f.repository.get(f.operation.id)).toMatchObject({ id: "card-search", input: { portalSearch: "auto" }, portal: "ndi" });
  });

  it.each(["PORTAL_RESULTS_NOT_READY", "PORTAL_CHANGED"])("continues to NDI when %s occurs before beneficiary selection", async (code) => {
    const f = fixture(); const calls: string[] = [];
    mocks.emit.mockImplementation(async (operation: OperationRecord) => {
      calls.push(operation.portal);
      if (operation.portal === "hapvida") throw new AutomationError(code, "Lista indisponivel.", { step: "select_beneficiary" });
    });
    await searchCardPortals(f.operation, f.controller.signal, f.context);
    expect(calls).toEqual(["hapvida", "ndi"]);
    expect(f.repository.get(f.operation.id)?.result?.cardPortalSearch).toMatchObject({ notFound: [] });
  });

  it("does not report absence when a portal list never becomes ready", async () => {
    const f = fixture();
    mocks.emit.mockImplementation(async (operation: OperationRecord) => {
      if (operation.portal === "hapvida") throw new AutomationError("PORTAL_RESULTS_NOT_READY", "Lista indisponivel.");
      throw notFound();
    });
    await expect(searchCardPortals(f.operation, f.controller.signal, f.context)).rejects.toMatchObject({ code: "CARD_PORTAL_SEARCH_INCOMPLETE" });
    expect(f.repository.get(f.operation.id)?.result?.cardPortalSearch).toMatchObject({ notFound: ["ndi"] });
  });

  it("stops after the preferred portal issues a card", async () => {
    const f = fixture();
    mocks.emit.mockResolvedValue(undefined);
    await searchCardPortals(f.operation, f.controller.signal, f.context);
    expect(mocks.emit).toHaveBeenCalledOnce();
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.repository.get(f.operation.id)?.portal).toBe("hapvida");
  });

  it("switches the same persisted operation to NDI with its own credential reference", async () => {
    const f = fixture(); const calls: string[] = [];
    mocks.emit.mockImplementation(async (operation: OperationRecord, _signal, context: WorkflowContext) => {
      calls.push(operation.portal);
      if (operation.portal === "hapvida") throw notFound();
      await context.repository.update(operation.id, { result: { ...operation.result, operator: operation.portal } });
    });
    await searchCardPortals(f.operation, f.controller.signal, f.context);
    expect(calls).toEqual(["hapvida", "ndi"]);
    expect(f.repository.get(f.operation.id)).toMatchObject({ id: "card-search", portal: "ndi", credentialRef: "ndi:company-1:login:0ABC", result: { operator: "ndi" } });
    expect(f.repository.get(f.operation.id)?.credentialId).toBeUndefined();
    expect(f.resolve).toHaveBeenCalledWith({ companyId: "company-1", operator: "ndi", portalLoginCode: "0ABC" });
  });

  it("reports a missing beneficiary only after both portals have confirmed absence", async () => {
    const f = fixture(); mocks.emit.mockRejectedValue(notFound());
    await expect(searchCardPortals(f.operation, f.controller.signal, f.context)).rejects.toMatchObject({
      code: "BENEFICIARY_NOT_FOUND", message: "Beneficiario nao encontrado em Hapvida ou NDI.",
    });
    expect(mocks.emit).toHaveBeenCalledTimes(2);
    expect(f.repository.get(f.operation.id)?.result?.cardPortalSearch).toMatchObject({ notFound: ["hapvida", "ndi"] });
  });

  it("does not transfer a saved Hapvida password to NDI", async () => {
    const f = fixture(); const used: string[] = [];
    const get = vi.fn(async (ref: string) => {
      if (ref.startsWith("ndi:")) throw new Error("No NDI access saved");
      return { username: "0ABC", password: "synthetic-hapvida-password" };
    });
    f.context.secretProvider = { get };
    mocks.emit.mockImplementation(async (operation: OperationRecord, _signal, context: WorkflowContext) => {
      try { used.push((await context.secretProvider.get(operation.credentialRef)).password); }
      catch { throw createReauthRequiredError("Informe acesso NDI."); }
      throw notFound();
    });
    await expect(searchCardPortals(f.operation, f.controller.signal, f.context)).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(used).toEqual(["synthetic-hapvida-password"]);
    expect(get.mock.calls.map(([ref]) => ref)).toEqual(["hapvida:company-1:login:0ABC", "ndi:company-1:login:0ABC"]);
    expect(f.operation.portal).toBe("ndi");
  });

  it.each([false, true])("uses one submitted RAM credential for the other portal, including when the first cannot load (unavailable=%s)", async (unavailable) => {
    const f = fixture(); const used: string[] = []; const calls: string[] = [];
    const store = new EphemeralCredentialStore();
    store.put(f.operation.id, f.operation.credentialRef, { username: "0ABC", password: "synthetic-submitted-password", metadata: { autoPortalCredential: true } }, 60000);
    const fallback = { get: vi.fn(async () => { throw new Error("Saved access unavailable"); }) };
    f.context.secretProvider = new OperationScopedSecretProvider(f.operation.id, store, fallback);
    mocks.emit.mockImplementation(async (operation: OperationRecord, _signal, context: WorkflowContext) => {
      calls.push(operation.portal);
      if (unavailable && operation.portal === "hapvida") throw new AutomationError("PORTAL_AUTH_UNAVAILABLE", "Portal indisponivel.");
      used.push((await context.secretProvider.get(operation.credentialRef)).password);
      if (operation.portal === "hapvida") throw new AutomationError("AUTHENTICATION_FAILED", "Acesso rejeitado.");
    });
    await searchCardPortals(f.operation, f.controller.signal, f.context);
    expect(calls).toEqual(["hapvida", "ndi"]);
    expect(used).toEqual(Array(unavailable ? 1 : 2).fill("synthetic-submitted-password"));
    expect(store.get(f.operation.id, "hapvida:company-1:login:0ABC")).toBeUndefined();
    expect(fallback.get).not.toHaveBeenCalled();
    expect(JSON.stringify({ operation: f.repository.get(f.operation.id), events: f.context.emitEvent })).not.toContain("synthetic-submitted-password");
  });

  it("resumes at the portal needing authentication without repeating a confirmed unsuccessful search", async () => {
    const f = fixture(); const calls: string[] = [];
    mocks.emit.mockImplementation(async (operation: OperationRecord) => {
      calls.push(operation.portal);
      if (operation.portal === "hapvida") throw notFound();
      throw createReauthRequiredError("Informe acesso NDI.");
    });
    await expect(searchCardPortals(f.operation, f.controller.signal, f.context)).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    const resumed = f.repository.get(f.operation.id)!;
    mocks.emit.mockImplementation(async (operation: OperationRecord) => { calls.push(operation.portal); });
    await searchCardPortals(resumed, f.controller.signal, f.context);
    expect(calls).toEqual(["hapvida", "ndi", "ndi"]);
  });

  it.each(["contractCode", "beneficiaryName", "periodStart"])("rechecks the portals when %s changes during resume", async (field) => {
    const f = fixture();
    mocks.emit.mockImplementation(async (operation: OperationRecord) => {
      if (operation.portal === "hapvida") throw notFound();
      throw createReauthRequiredError("Informe acesso NDI.");
    });
    await expect(searchCardPortals(f.operation, f.controller.signal, f.context)).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    const resumed = f.repository.get(f.operation.id)!; resumed.input[field] = "changed-query";
    const calls: string[] = [];
    mocks.emit.mockImplementation(async (operation: OperationRecord) => {
      calls.push(operation.portal);
      if (operation.portal === "ndi") throw notFound();
    });
    await searchCardPortals(resumed, f.controller.signal, f.context);
    expect(calls).toEqual(["ndi", "hapvida"]);
  });

  it.each(["CARD_VALIDATION_FAILED", "PDF_VALIDATION_FAILED", "BENEFICIARY_AMBIGUOUS", "CARD_PREVIEW_NOT_FOUND", "HUMAN_VERIFICATION_REQUIRED", "BENEFICIARY_SELECTION_FAILED", "PORTAL_CHANGED"])("stops without switching portals after %s", async (code) => {
    const f = fixture(); mocks.emit.mockRejectedValue(new AutomationError(code, "Interrompido."));
    await expect(searchCardPortals(f.operation, f.controller.signal, f.context)).rejects.toMatchObject({ code });
    expect(mocks.emit).toHaveBeenCalledOnce();
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it("reports an incomplete search when one portal is unavailable", async () => {
    const f = fixture();
    mocks.emit.mockImplementation(async (operation: OperationRecord) => {
      if (operation.portal === "hapvida") throw notFound();
      throw new AutomationError("PORTAL_URL_NOT_CONFIGURED", "NDI indisponivel.");
    });
    await expect(searchCardPortals(f.operation, f.controller.signal, f.context)).rejects.toMatchObject({ code: "CARD_PORTAL_SEARCH_INCOMPLETE", safeDetails: expect.stringContaining("NDI: PORTAL_URL_NOT_CONFIGURED") });
  });

  it.each(["BENEFICIARY_NOT_ACTIVE", "ACTIVE_USERS_LIST_UNAVAILABLE"])("continues to NDI after the optional Hapvida preflight returns %s", async code => {
    const f = fixture(); const calls: string[] = [];
    mocks.emit.mockImplementation(async (operation: OperationRecord) => {
      calls.push(operation.portal);
      if (operation.portal === "hapvida") throw new AutomationError(code, "Preflight Hapvida.");
    });
    await searchCardPortals(f.operation, f.controller.signal, f.context);
    expect(calls).toEqual(["hapvida", "ndi"]);
  });

  it("stops a cancelled search before accessing the next portal", async () => {
    const f = fixture(); mocks.emit.mockImplementation(async () => { f.controller.abort(); throw notFound(); });
    await expect(searchCardPortals(f.operation, f.controller.signal, f.context)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.emit).toHaveBeenCalledOnce();
  });

  it("supports a selected NDI card portal while keeping NDI movements unmapped", async () => {
    const f = fixture("ndi"); f.operation.input.portalSearch = "selected";
    mocks.emit.mockResolvedValue(undefined); const registry = new WorkflowRegistry();
    await registry.run(f.operation, f.controller.signal, f.context);
    expect(visited()).toEqual(["ndi"]);
    f.operation.type = "INCLUSION_HOLDER";
    await expect(registry.run(f.operation, f.controller.signal, f.context)).rejects.toMatchObject({ code: "PORTAL_MAPPING_REQUIRED" });
  });
});
