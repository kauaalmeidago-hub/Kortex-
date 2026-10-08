import type { OperationEvent, OperationRecord, OperationStatus } from "../types.js";

export interface AutomationOperationRepository {
  create(record: OperationRecord): OperationRecord | Promise<OperationRecord>;
  get(id: string): OperationRecord | undefined | Promise<OperationRecord | undefined>;
  update(
    id: string,
    patch: Partial<Pick<OperationRecord, "status" | "currentStep" | "result" | "error" | "artifacts" | "finishedAt" | "updatedAt" | "credentialRef" | "credentialId" | "input">>,
  ): OperationRecord | undefined | Promise<OperationRecord | undefined>;
  appendEvent(event: OperationEvent): OperationEvent | Promise<OperationEvent>;
  getEvents(operationId: string, afterId?: number | string): OperationEvent[] | Promise<OperationEvent[]>;
  close?(): void | Promise<void>;
}

export interface PersistentAutomationQueueRepository extends AutomationOperationRepository {
  claimNext(workerId: string, leaseSeconds: number): Promise<OperationRecord | undefined>;
  renewLease(operationId: string, workerId: string, leaseSeconds: number): Promise<boolean>;
  requestCancel(operationId: string, userId?: string): Promise<OperationRecord | undefined>;
  acquireLock(lockKey: string, operationId: string, workerId: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(lockKey: string, operationId: string, workerId: string): Promise<boolean>;
  markStaleOperationsForReview(): Promise<number>;
  setStatus(operationId: string, status: OperationStatus, step: string, workerId?: string): Promise<OperationRecord | undefined>;
  upsertWorkerHeartbeat?(
    workerId: string,
    status: "online" | "draining" | "offline",
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  markWorkerOffline?(workerId: string): Promise<void>;
}

