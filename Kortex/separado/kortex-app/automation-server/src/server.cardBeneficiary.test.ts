import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationRepository } from "./db/OperationRepository.js";
import { createServer } from "./server.js";
import { OperationEventBus } from "./events/EventBus.js";
import { ExplicitCredentialResolver } from "./credentials/CredentialResolver.js";
import type { AutomationConfig } from "./config.js";

describe("card beneficiary decision", () => {
  const enqueue = vi.fn(), first = "a".repeat(64), second = "b".repeat(64);
  let repository: OperationRepository, app: Awaited<ReturnType<typeof createServer>>;
  beforeEach(async () => {
    vi.clearAllMocks(); repository = new OperationRepository(":memory:");
    const now = new Date().toISOString();
    repository.create({ id: "test", type: "CARD_ISSUE", status: "awaiting_confirmation", companyId: "company-1", portal: "ndi", requestedBy: "owner-user",
      credentialRef: "ndi:company-1", input: {}, result: { cardBeneficiaryConfirmation: { id: "choice", fingerprint: "snapshot", beneficiaryName: "TESTE",
        options: [{ id: first, beneficiaryName: "TESTE", cardNumbers: ["900000000001"], description: "PLANO A" }, { id: second, beneficiaryName: "TESTE", cardNumbers: ["900000000002"], description: "PLANO B" }] } },
      artifacts: [], createdAt: now, updatedAt: now });
    app = await createServer({ config: { apiToken: "local-api", supabaseUrl: "https://supabase.test", supabaseSecretKey: "synthetic-key", features: { cardIssue: true } } as AutomationConfig,
      repository, queue: { enqueue } as never, eventBus: new OperationEventBus(), credentialResolver: new ExplicitCredentialResolver() });
  });
  afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await app.close(); repository.close(); });
  const confirm = (optionId = first, confirmationId = "choice", extra = {}) => app.inject({ method: "POST", url: "/api/operations/test/card-beneficiary",
    headers: { "x-koa-automation-token": "local-api" }, payload: { confirmationId, optionId, ...extra } });
  it("queues exactly one of two concurrent choices on the existing operation", async () => {
    const responses = await Promise.all([confirm(first), confirm(second)]);
    expect(responses.map(response => response.statusCode).sort()).toEqual([202, 409]);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(repository.get("test")).toMatchObject({ status: "queued", result: { cardBeneficiaryConfirmation: { selectedOptionId: first } } });
  });
  it("rejects a forged option, an obsolete confirmation and client-provided identities", async () => {
    expect((await confirm("c".repeat(64))).statusCode).toBe(409);
    expect((await confirm(first, "old")).statusCode).toBe(409);
    expect((await confirm(first, "choice", { cpf: "11111111111" })).statusCode).toBe(400);
    expect(enqueue).not.toHaveBeenCalled(); expect(repository.get("test")?.status).toBe("awaiting_confirmation");
  });
  it("does not resume a cancelled request", async () => {
    repository.update("test", { status: "cancelled" });
    expect((await confirm()).statusCode).toBe(409); expect(enqueue).not.toHaveBeenCalled();
  });
  it("does not authorize an anonymous or different user", async () => {
    expect((await app.inject({ method: "POST", url: "/api/operations/test/card-beneficiary", payload: { confirmationId: "choice", optionId: first } })).statusCode).toBe(401);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "another-user" }), { headers: { "content-type": "application/json" } })));
    expect((await app.inject({ method: "POST", url: "/api/operations/test/card-beneficiary", headers: { authorization: "Bearer synthetic-jwt" }, payload: { confirmationId: "choice", optionId: first } })).statusCode).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("keeps a durable decision queued after an event publication error", async () => {
    vi.spyOn(repository, "appendEvent").mockImplementation(() => { throw new Error("event unavailable"); });
    expect((await confirm()).statusCode).toBe(202); expect(enqueue).toHaveBeenCalledOnce();
    expect((await confirm()).statusCode).toBe(409); expect(enqueue).toHaveBeenCalledOnce();
  });
});
