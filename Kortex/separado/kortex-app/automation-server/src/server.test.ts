import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import type { AutomationConfig } from "./config.js";
import type { OperationEvent, OperationRecord } from "./types.js";
import type { AutomationOperationRepository } from "./repositories/AutomationOperationRepository.js";
import type { OperationQueue } from "./queue/OperationQueue.js";
import { OperationEventBus } from "./events/EventBus.js";
import { EphemeralCredentialStore } from "./secrets/EphemeralCredentialStore.js";
import { createServer } from "./server.js";
import { ExplicitCredentialResolver } from "./credentials/CredentialResolver.js";

describe("Koa reauthentication handoff", () => {
  let operation: OperationRecord;
  let events: OperationEvent[];
  let store: EphemeralCredentialStore;
  let app: Awaited<ReturnType<typeof createServer>>;
  let repository: AutomationOperationRepository;
  let launch: ReturnType<typeof vi.spyOn>;
  let workerReady: boolean;

  beforeEach(async () => {
    const now = new Date().toISOString();
    workerReady = true;
    operation = { id: "operation-1", type: "CARD_ISSUE", status: "awaiting_authentication", companyId: "company-1",
      portal: "hapvida", credentialRef: "hapvida:company-1", input: { contractCode: "0ABC" }, artifacts: [], createdAt: now, updatedAt: now };
    events = [];
    store = new EphemeralCredentialStore();
    repository = {
      create: vi.fn((record) => record),
      get: vi.fn(() => ({ ...operation })),
      update: vi.fn((_id, patch) => { operation = { ...operation, ...patch }; return { ...operation }; }),
      appendEvent: vi.fn((event) => { events.push(event); return event; }),
      getEvents: vi.fn(() => events.slice()),
    };
    launch = vi.spyOn(chromium, "launch").mockRejectedValue(new Error("HTTP reauth must never open a browser"));
    app = await createServer({
      config: { apiToken: "test-api", repositoryMode: "postgres", authMaxAttempts: 3, authChallengeTtlMinutes: 30, features: {} } as AutomationConfig,
      repository, eventBus: new OperationEventBus(), queue: { enqueue: vi.fn() } as unknown as OperationQueue,
      credentialResolver: new ExplicitCredentialResolver(), ephemeralCredentialStore: store,
      workerReady: () => workerReady,
    });
  });

  afterEach(async () => { await app?.close(); vi.restoreAllMocks(); });

  const submit = (rememberOnDevice = false) => app.inject({
    method: "POST", url: "/api/operations/operation-1/reauth", headers: { "x-koa-automation-token": "test-api" },
    payload: { password: "synthetic-password", rememberOnDevice },
  });

  it("reports a disconnected queue as unavailable and becomes ready after recovery", async () => {
    workerReady = false;
    const unavailable = await app.inject("/ready");
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ database: "reconnecting", worker: "reconnecting" });
    workerReady = true;
    const recovered = await app.inject("/ready");
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({ database: "ok", worker: "ok" });
  });

  it.each([false, true])("preserves remember=%s only in RAM and resumes the same operation without logging in", async (remember) => {
    const response = await submit(remember);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, status: "queued", operationId: operation.id });
    expect(store.get(operation.id, operation.credentialRef)).toMatchObject({
      username: "0ABC", password: "synthetic-password", metadata: { rememberOnDevice: remember },
    });
    expect(launch).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["authentication.submitted", "operation.queued"]);
    expect(events[0]?.data).toMatchObject({ rememberOnDevice: remember });
    expect(JSON.stringify({ events, operation, response: response.json() })).not.toContain("synthetic-password");
  });

  it("blocks an exhausted challenge before accepting another password", async () => {
    events = Array.from({ length: 3 }, () => ({
      operationId: operation.id, type: "authentication.failed", data: { error: "AUTHENTICATION_FAILED" }, createdAt: operation.createdAt,
    }));
    const response = await submit(true);
    expect(response.statusCode).toBe(429);
    expect(response.json().error).toBe("AUTHENTICATION_ATTEMPTS_EXCEEDED");
    expect(operation.status).toBe("manual_review");
    expect(store.get(operation.id, operation.credentialRef)).toBeUndefined();
    expect(launch).not.toHaveBeenCalled();
  });

  it("rebinds a corrected company code to the queued operation and its ephemeral password", async () => {
    const oldRef = operation.credentialRef;
    const response = await app.inject({
      method: "POST", url: "/api/operations/operation-1/reauth", headers: { "x-koa-automation-token": "test-api" },
      payload: { companyCode: "0NEW", password: "new-synthetic-password", rememberOnDevice: true },
    });
    expect(response.statusCode).toBe(200);
    expect(operation.input.contractCode).toBe("0NEW");
    expect(operation.credentialRef).toBe("hapvida:company-1:login:0NEW");
    expect(store.get(operation.id, operation.credentialRef)).toMatchObject({ username: "0NEW", password: "new-synthetic-password" });
    expect(store.get(operation.id, oldRef)).toBeUndefined();
    expect(JSON.stringify({ operation, events, response: response.json() })).not.toContain("new-synthetic-password");
  });

  it("does not count database update errors as failed portal logins", async () => {
    events = Array.from({ length: 3 }, () => ({
      operationId: operation.id, type: "authentication.failed", data: { error: "DATABASE_OPERATION_UPDATE_FAILED" }, createdAt: operation.createdAt,
    }));
    expect((await submit()).json().ok).toBe(true);
  });

  it("rejects a concurrent submission while the first challenge is being accepted", async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(repository.getEvents).mockImplementation(async () => { entered(); await gate; return events.slice(); });
    const first = submit();
    await started;
    const second = await submit();
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("AUTHENTICATION_ALREADY_IN_PROGRESS");
    release();
    expect((await first).json().ok).toBe(true);
    expect(events.filter((event) => event.type === "authentication.submitted")).toHaveLength(1);
  });

  it("clears a failed submission and reports a database failure without consuming an auth attempt", async () => {
    vi.mocked(repository.update).mockImplementation((_id, patch) => {
      if (patch.status === "queued") throw new Error("inconsistent types deduced for parameter $2");
      operation = { ...operation, ...patch }; return { ...operation };
    });
    const response = await submit();
    expect(response.json()).toMatchObject({ ok: false, error: "DATABASE_OPERATION_UPDATE_FAILED" });
    expect(operation.status).toBe("awaiting_authentication");
    expect(store.get(operation.id, operation.credentialRef)).toBeUndefined();
    expect(events.some((event) => event.type === "authentication.failed")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("synthetic-password");
  });
});
