import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationConfig } from "../config.js";
import type { BrowserManager } from "../browser/BrowserManager.js";
import type { ArtifactStorage } from "../storage/ArtifactStorage.js";
import type { PersistentAutomationQueueRepository } from "../repositories/AutomationOperationRepository.js";
import type { OperationRecord } from "../types.js";
import { OperationEventBus } from "../events/EventBus.js";

const mocks = vi.hoisted(() => ({ workflow: vi.fn() }));
vi.mock("../workflows/WorkflowRunner.js", () => ({ runWorkflow: mocks.workflow }));
import { PersistentWorker } from "./PersistentWorker.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); mocks.workflow.mockReset(); });
function fixture() {
  const operation = { id: "synthetic-operation", type: "CARD_ISSUE", portal: "hapvida", status: "starting",
    companyId: "synthetic-company", input: {}, artifacts: [] } as OperationRecord;
  const repository = {
    markStaleOperationsForReview: vi.fn(async () => 0), claimNext: vi.fn(async () => undefined),
    acquireLock: vi.fn(async () => true), releaseLock: vi.fn(async () => true), renewLease: vi.fn(async () => true),
    get: vi.fn(async () => operation), setStatus: vi.fn(async () => operation),
    appendEvent: vi.fn(async (event) => event), update: vi.fn(async () => operation),
    upsertWorkerHeartbeat: vi.fn(async () => {}), markWorkerOffline: vi.fn(async () => {}),
  };
  const worker = new PersistentWorker({ config: { workerId: "recovery-test", workerLeaseSeconds: 15,
    workerPollIntervalMs: 3, workerHeartbeatIntervalMs: 25_000, features: { cardIssue: true } } as AutomationConfig,
    repository: repository as unknown as PersistentAutomationQueueRepository, eventBus: new OperationEventBus(),
    browserManager: {} as BrowserManager, secretProvider: { get: vi.fn() }, artifactStorage: {} as ArtifactStorage });
  return { worker, repository, operation };
}

describe("worker queue connectivity recovery", () => {
  it("reconnects after maintenance/claim failures and executes queued work exactly once", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { worker, repository, operation } = fixture();
    repository.markStaleOperationsForReview.mockRejectedValueOnce(new Error("postgres://secret-password"));
    repository.claimNext.mockRejectedValueOnce(new Error("temporary outage")).mockResolvedValueOnce(operation as never);
    mocks.workflow.mockImplementation(async () => { worker.stop(); });
    const run = worker.run();
    await vi.advanceTimersByTimeAsync(3500);
    await run;
    expect(repository.claimNext).toHaveBeenCalledTimes(2);
    expect(mocks.workflow).toHaveBeenCalledTimes(1);
    expect(repository.markWorkerOffline).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-password");
  });
  it("interrupts reconnect backoff immediately during a graceful stop", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { worker, repository } = fixture();
    repository.claimNext.mockRejectedValue(new Error("offline"));
    const run = worker.run();
    await vi.advanceTimersByTimeAsync(10);
    worker.stop();
    await run;
    expect(repository.claimNext).toHaveBeenCalledTimes(1);
  });
  it("handles a rejected lease renewal without crashing or replaying the active workflow", async () => {
    vi.useFakeTimers();
    const { worker, repository, operation } = fixture();
    repository.claimNext.mockResolvedValueOnce(operation as never);
    repository.renewLease.mockRejectedValue(new Error("temporary outage"));
    let finish!: () => void;
    mocks.workflow.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const run = worker.run();
    await vi.advanceTimersByTimeAsync(5100);
    expect(repository.renewLease).toHaveBeenCalledTimes(1);
    worker.stop(); finish();
    await run;
    expect(mocks.workflow).toHaveBeenCalledTimes(1);
  });

  it.each(["auto", undefined])("locks and renews both portals for automatic or legacy search (mode=%s)", async (mode) => {
    vi.useFakeTimers(); const { worker, repository, operation } = fixture();
    if (mode) operation.input.portalSearch = mode;
    repository.claimNext.mockResolvedValueOnce(operation as never);
    let finish!: () => void;
    mocks.workflow.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const run = worker.run(); await vi.advanceTimersByTimeAsync(5100);
    expect(repository.acquireLock.mock.calls.map(([key]) => key)).toEqual([
      "hapvida:company:synthetic-company", "ndi:company:synthetic-company",
      "hapvida:company:synthetic-company", "ndi:company:synthetic-company",
    ]);
    worker.stop(); finish(); await run;
    expect(repository.releaseLock.mock.calls.map(([key]) => key)).toEqual(["hapvida:company:synthetic-company", "ndi:company:synthetic-company"]);
    expect(mocks.workflow).toHaveBeenCalledOnce();
    expect(repository.upsertWorkerHeartbeat).toHaveBeenCalledWith("recovery-test", "online", expect.objectContaining({
      cardIssueWorkflowVersion: 4, cardPreviewVersion: 2, cardIssueBatchEnabled: true, cardIssuePrintAllEnabled: true, cardPortalPreferenceVersion: 1, cardPortalSearchDefault: "auto", portalAccessStorageVersion: 1, portalAccessStorage: "local_dpapi",
    }));
  });

  it("locks only the explicitly selected portal", async () => {
    const { worker, repository, operation } = fixture(); operation.input.portalSearch = "selected";
    repository.claimNext.mockResolvedValueOnce(operation as never);
    mocks.workflow.mockImplementation(async () => { worker.stop(); });
    await worker.run();
    expect(repository.acquireLock.mock.calls.map(([key]) => key)).toEqual(["hapvida:company:synthetic-company"]);
    expect(repository.releaseLock).toHaveBeenCalledOnce();
  });

  it("does not start a search if the second portal is locked by another operation", async () => {
    const { worker, repository, operation } = fixture(); operation.input.portalSearch = "auto";
    repository.claimNext.mockResolvedValueOnce(operation as never);
    repository.acquireLock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    repository.update.mockImplementation(async () => { worker.stop(); return operation; });
    await worker.run();
    expect(mocks.workflow).not.toHaveBeenCalled();
    expect(repository.releaseLock).toHaveBeenCalledOnce();
    expect(repository.releaseLock).toHaveBeenCalledWith("hapvida:company:synthetic-company", operation.id, "recovery-test");
  });

  it("interrupts an active search when its portal locks cannot be renewed", async () => {
    vi.useFakeTimers(); const { worker, repository, operation } = fixture(); operation.input.portalSearch = "auto";
    repository.claimNext.mockResolvedValueOnce(operation as never);
    repository.acquireLock.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    mocks.workflow.mockImplementation((_operation, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => { worker.stop(); reject(new DOMException("Operation aborted", "AbortError")); }, { once: true });
    }));
    const run = worker.run(); await vi.advanceTimersByTimeAsync(5100); await run;
    expect(repository.update).toHaveBeenCalledWith(operation.id, expect.objectContaining({ error: expect.objectContaining({ code: "LOCK_LOST" }) }));
    expect(repository.releaseLock).toHaveBeenCalledTimes(2);
  });
});
