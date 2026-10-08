import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationConfig } from "../config.js";
import type { BrowserManager } from "../browser/BrowserManager.js";
import type { ArtifactStorage } from "../storage/ArtifactStorage.js";
import type { PersistentAutomationQueueRepository } from "../repositories/AutomationOperationRepository.js";
import type { OperationEvent, OperationRecord } from "../types.js";
import type { WorkflowContext } from "../workflows/WorkflowContext.js";
import { AutomationError, createReauthRequiredError } from "../errors.js";
import { OperationEventBus } from "../events/EventBus.js";
import { EphemeralCredentialStore } from "../secrets/EphemeralCredentialStore.js";

const mocks = vi.hoisted(() => ({ workflow: vi.fn() }));
vi.mock("../workflows/WorkflowRunner.js", () => ({ runWorkflow: mocks.workflow }));
import { PersistentWorker } from "./PersistentWorker.js";
import { OperationQueue } from "../queue/OperationQueue.js";

function fixture(previousFailures = 0) {
  const now = new Date().toISOString();
  let operation: OperationRecord = { id: "operation-1", type: "CARD_ISSUE", status: "queued", companyId: "company-1",
    portal: "hapvida", credentialRef: "hapvida:company-1", input: {}, artifacts: [], createdAt: now, updatedAt: now };
  const events: OperationEvent[] = Array.from({ length: previousFailures }, () => ({
    operationId: operation.id, type: "authentication.failed", data: { error: "AUTHENTICATION_FAILED" }, createdAt: now,
  }));
  const store = new EphemeralCredentialStore();
  const repository: PersistentAutomationQueueRepository = {
    create: (record) => record,
    get: () => ({ ...operation }),
    update: vi.fn((_id, patch) => { operation = { ...operation, ...patch }; return { ...operation }; }),
    appendEvent: (event) => { events.push(event); return event; },
    getEvents: () => events.slice(),
    claimNext: vi.fn(async () => ({ ...operation })),
    renewLease: vi.fn(async () => true),
    requestCancel: vi.fn(async () => undefined),
    acquireLock: vi.fn(async () => true),
    releaseLock: vi.fn(async () => true),
    markStaleOperationsForReview: vi.fn(async () => 0),
    setStatus: vi.fn(async (_id, status, step) => { operation = { ...operation, status, currentStep: step }; return { ...operation }; }),
  };
  const config = { authMaxAttempts: 3, workerId: "test-worker", workerLeaseSeconds: 60, workerPollIntervalMs: 3,
    workerHeartbeatIntervalMs: 25_000, features: { cardIssue: true } } as AutomationConfig;
  const deps = { config, repository, eventBus: new OperationEventBus(), browserManager: {} as BrowserManager,
    secretProvider: { get: async () => { throw createReauthRequiredError(); } },
    ephemeralCredentialStore: store, artifactStorage: {} as ArtifactStorage };
  return { deps, repository, store, events, getOperation: () => operation };
}

describe("worker authentication recovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([0, 2])("returns a failed login to the correct state after %s previous failures", async (previous) => {
    const f = fixture(previous);
    f.store.put("operation-1", "hapvida:company-1", { username: "0ABC", password: "synthetic-password" }, 60_000);
    mocks.workflow.mockImplementation(async (_op: OperationRecord, _signal: AbortSignal, context: WorkflowContext) => {
      expect((await context.secretProvider.get("hapvida:company-1")).username).toBe("0ABC");
      throw new AutomationError("AUTHENTICATION_FAILED", "Login nao confirmado.", { step: "authenticate" });
    });
    const worker = new PersistentWorker(f.deps);
    vi.mocked(f.repository.releaseLock).mockImplementation(async () => { worker.stop(); return true; });
    await worker.run();
    expect(f.getOperation().status).toBe(previous === 2 ? "manual_review" : "awaiting_authentication");
    expect(f.getOperation().error?.code).toBe(previous === 2 ? "AUTHENTICATION_ATTEMPTS_EXCEEDED" : "AUTHENTICATION_FAILED");
    expect(f.events.filter((event) => event.type === "authentication.failed")).toHaveLength(previous + 1);
    expect(f.store.get("operation-1", "hapvida:company-1")).toBeUndefined();
    expect(JSON.stringify(f.events)).not.toContain("synthetic-password");
  });

  it("does not erase a fresh password when the old worker exits after the operation has been reclaimed", async () => {
    const f = fixture();
    mocks.workflow.mockRejectedValue(createReauthRequiredError());
    vi.mocked(f.repository.setStatus).mockImplementation(async (id, status, step) => {
      await f.repository.update(id, { status, currentStep: step });
      if (status === "awaiting_authentication") {
        f.store.put(id, "hapvida:company-1", { username: "new", password: "fresh-password" }, 60_000);
        await f.repository.update(id, { status: "starting", currentStep: "claimed" });
      }
      return f.getOperation();
    });
    const worker = new PersistentWorker(f.deps);
    vi.mocked(f.repository.releaseLock).mockImplementation(async () => { worker.stop(); return true; });
    await worker.run();
    expect(f.store.get("operation-1", "hapvida:company-1")?.username).toBe("new");
  });

  it("resumes the same SQLite operation even when reauth arrives before the old execution finishes", async () => {
    const f = fixture();
    const queue = new OperationQueue(f.deps);
    const originalUpdate = vi.mocked(f.repository.update).getMockImplementation()!;
    vi.mocked(f.repository.update).mockImplementation(async (id, patch) => {
      const updated = await originalUpdate(id, patch);
      if (patch.status === "awaiting_authentication") {
        f.store.put(id, "hapvida:company-1", { username: "new", password: "fresh-password" }, 60_000);
        await originalUpdate(id, { status: "queued", currentStep: "authentication_submitted" });
        queue.enqueue(id);
      }
      return updated;
    });
    mocks.workflow.mockImplementationOnce(async () => { throw createReauthRequiredError(); })
      .mockImplementationOnce(async (operation: OperationRecord, _signal: AbortSignal, context: WorkflowContext) => {
        expect(operation.id).toBe("operation-1");
        expect((await context.secretProvider.get(operation.credentialRef)).username).toBe("new");
        await context.updateStatus("success", "PDF gerado");
      });
    queue.enqueue("operation-1");
    await vi.waitFor(() => expect(f.getOperation().status).toBe("success"));
    expect(mocks.workflow).toHaveBeenCalledTimes(2);
    expect(f.store.get("operation-1", "hapvida:company-1")).toBeUndefined();
  });
});
