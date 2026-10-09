import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationRepository } from "./db/OperationRepository.js";
import { createServer } from "./server.js";
import { OperationEventBus } from "./events/EventBus.js";
import { ExplicitCredentialResolver } from "./credentials/CredentialResolver.js";
import type { AutomationConfig } from "./config.js";
import type { OperationRecord } from "./types.js";

describe("dependent card decision", () => {
  const enqueue = vi.fn();
  let repository: OperationRepository;
  let app: Awaited<ReturnType<typeof createServer>>;
  beforeEach(async () => {
    vi.clearAllMocks(); repository = new OperationRepository(":memory:");
    const now = new Date().toISOString();
    repository.create({ id: "operation-1", type: "CARD_ISSUE", status: "awaiting_confirmation", companyId: "company-1", portal: "ndi",
      credentialRef: "ndi:company-1", input: {}, result: { cardDependentConfirmation: { id: "choice-1", fingerprint: "snapshot", beneficiaryName: "TITULAR DE TESTE", dependentNames: ["DEPENDENTE DE TESTE"] } },
      artifacts: [], createdAt: now, updatedAt: now } as OperationRecord);
    app = await createServer({ config: { apiToken: "local-api", supabaseUrl: "https://supabase.test", supabaseSecretKey: "synthetic-key", features: { cardIssue: true } } as AutomationConfig,
      repository, queue: { enqueue } as never, eventBus: new OperationEventBus(), credentialResolver: new ExplicitCredentialResolver() });
  });
  afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await app.close(); repository.close(); });
  const confirm = (includeDependents = true, confirmationId = "choice-1", extra = {}) => app.inject({ method: "POST", url: "/api/operations/operation-1/card-dependents",
    headers: { "x-koa-automation-token": "local-api" }, payload: { confirmationId, includeDependents, ...extra } });

  it.each([true, false])("queues the existing request once with an explicit includeDependents=%s decision", async include => {
    expect((await confirm(include)).statusCode).toBe(202);
    expect(repository.get("operation-1")).toMatchObject({ status: "queued", result: { cardDependentConfirmation: { decision: include ? "with" : "without", approvedBy: "local-api" } } });
    expect(enqueue).toHaveBeenCalledOnce();
    expect((await confirm(!include)).statusCode).toBe(409);
    expect(enqueue).toHaveBeenCalledOnce();
  });
  it("accepts only one concurrent choice", async () => {
    const results = await Promise.all([confirm(true), confirm(false)]);
    expect(results.map(result => result.statusCode).sort()).toEqual([202, 409]);
    expect(enqueue).toHaveBeenCalledOnce();
  });
  it("rejects a stale confirmation and any client-supplied beneficiary list", async () => {
    expect((await confirm(true, "old-choice")).statusCode).toBe(409);
    expect((await confirm(true, "choice-1", { dependentNames: ["OUTRA PESSOA"] })).statusCode).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
    expect(repository.get("operation-1")?.status).toBe("awaiting_confirmation");
  });
  it("does not restart a cancelled or completed request", async () => {
    for (const status of ["cancelled", "success"] as const) {
      repository.update("operation-1", { status });
      expect((await confirm()).statusCode).toBe(409);
    }
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("does not accept an anonymous decision", async () => {
    expect((await app.inject({ method: "POST", url: "/api/operations/operation-1/card-dependents", payload: { confirmationId: "choice-1", includeDependents: true } })).statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("rejects an authenticated user who did not request the operation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "another-user" }), { headers: { "content-type": "application/json" } })));
    const get = repository.get.bind(repository);
    vi.spyOn(repository, "get").mockImplementation(id => ({ ...get(id)!, requestedBy: "owner-user" }));
    const response = await app.inject({ method: "POST", url: "/api/operations/operation-1/card-dependents",
      headers: { authorization: "Bearer synthetic-jwt" }, payload: { confirmationId: "choice-1", includeDependents: true } });
    expect(response.statusCode).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("records the authenticated requester as the person approving the emission", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "owner-user" }), { headers: { "content-type": "application/json" } })));
    const get = repository.get.bind(repository);
    vi.spyOn(repository, "get").mockImplementation(id => ({ ...get(id)!, requestedBy: "owner-user" }));
    const response = await app.inject({ method: "POST", url: "/api/operations/operation-1/card-dependents",
      headers: { authorization: "Bearer synthetic-jwt" }, payload: { confirmationId: "choice-1", includeDependents: true } });
    expect(response.statusCode).toBe(202);
    expect(repository.get("operation-1")?.result?.cardDependentConfirmation).toMatchObject({ approvedBy: "owner-user" });
    expect(enqueue).toHaveBeenCalledOnce();
  });
});
