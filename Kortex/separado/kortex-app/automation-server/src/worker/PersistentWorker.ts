import os from "node:os";
import type { AutomationConfig } from "../config.js";
import type { BrowserManager } from "../browser/BrowserManager.js";
import type { OperationEventBus } from "../events/EventBus.js";
import type { SecretProvider } from "../secrets/SecretProvider.js";
import type { PersistentAutomationQueueRepository } from "../repositories/AutomationOperationRepository.js";
import { runWorkflow } from "../workflows/WorkflowRunner.js";
import { AutomationError, isAbortError } from "../errors.js";
import type { OperationError, OperationRecord, OperationStatus } from "../types.js";
import type { ArtifactStorage } from "../storage/ArtifactStorage.js";
import type { WorkflowContext } from "../workflows/WorkflowContext.js";
import { sanitizeDiagnosticText } from "../security/redaction.js";
import { type EphemeralCredentialStore, OperationScopedSecretProvider } from "../secrets/EphemeralCredentialStore.js";

interface PersistentWorkerDeps {
  config: AutomationConfig;
  repository: PersistentAutomationQueueRepository;
  eventBus: OperationEventBus;
  browserManager: BrowserManager;
  secretProvider: SecretProvider;
  ephemeralCredentialStore?: EphemeralCredentialStore;
  artifactStorage: ArtifactStorage;
}

export class PersistentWorker {
  private stopping = false;
  private currentController?: AbortController;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly deps: PersistentWorkerDeps) {}

  stop() {
    this.stopping = true;
    this.currentController?.abort();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  async run() {
    await this.heartbeat("online", { mode: this.deps.config.automationMode });
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat("online", { mode: this.deps.config.automationMode });
    }, this.deps.config.workerHeartbeatIntervalMs);

    try {
      while (!this.stopping) {
        await this.deps.repository.markStaleOperationsForReview().catch(() => 0);
        const operation = await this.deps.repository.claimNext(this.deps.config.workerId, this.deps.config.workerLeaseSeconds);
        if (!operation) {
          await this.sleep(this.deps.config.workerPollIntervalMs);
          continue;
        }

        await this.execute(operation);
      }
    } finally {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      await this.deps.repository.markWorkerOffline?.(this.deps.config.workerId).catch(() => undefined);
    }
  }

  private async execute(operation: OperationRecord) {
    const controller = new AbortController();
    this.currentController = controller;
    const lockKey = `${operation.portal}:company:${operation.companyId}`;
    let leaseTimer: NodeJS.Timeout | undefined;
    let cancelWatchTimer: NodeJS.Timeout | undefined;

    try {
      if (operation.status === "cancelling" || operation.cancelRequestedAt) {
        await this.updateStatus(operation.id, "cancelled", "Operacao cancelada antes de iniciar");
        return;
      }

      const lockAcquired = await this.deps.repository.acquireLock(
        lockKey,
        operation.id,
        this.deps.config.workerId,
        this.deps.config.workerLeaseSeconds,
      );

      if (!lockAcquired) {
        throw new AutomationError("LOCK_NOT_ACQUIRED", "Nao foi possivel adquirir lock da empresa.", {
          safeDetails: `Lock: ${lockKey}`,
          retryable: true,
        });
      }

      leaseTimer = setInterval(() => {
        void this.deps.repository.renewLease(operation.id, this.deps.config.workerId, this.deps.config.workerLeaseSeconds);
      }, Math.max(5000, Math.floor((this.deps.config.workerLeaseSeconds * 1000) / 3)));

      cancelWatchTimer = setInterval(() => {
        void this.abortIfCancelRequested(operation.id, controller);
      }, Math.max(1500, this.deps.config.workerPollIntervalMs));

      await runWorkflow(operation, controller.signal, {
        config: this.deps.config,
        repository: this.deps.repository,
        browserManager: this.deps.browserManager,
        secretProvider: this.deps.ephemeralCredentialStore
          ? new OperationScopedSecretProvider(operation.id, this.deps.ephemeralCredentialStore, this.deps.secretProvider)
          : this.deps.secretProvider,
        artifactStorage: this.deps.artifactStorage,
        updateStatus: (status, step, data) => this.updateStatus(operation.id, status, step, data),
        emitEvent: (event) => this.emitEvent({ ...event, operationId: event.operationId ?? operation.id }),
      });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        await this.updateStatus(operation.id, "cancelled", "Operacao cancelada pelo usuario");
      } else if (error instanceof AutomationError && error.code === "REAUTH_REQUIRED" && operation.type === "CARD_ISSUE") {
        await this.updateStatus(operation.id, "awaiting_authentication", "authentication_required", {
          operator: operation.portal,
          companyId: operation.companyId,
        });
        await this.emitEvent({
          operationId: operation.id,
          type: "authentication.required",
          status: "awaiting_authentication",
          step: "authentication_required",
          data: { operator: operation.portal, companyId: operation.companyId },
        });
      } else if (error instanceof AutomationError && error.code === "AUTHENTICATION_FAILED" && operation.type === "CARD_ISSUE") {
        await this.handleAuthenticationFailed(operation, error);
      } else {
        await this.fail(operation.id, this.toOperationError(error));
      }
    } finally {
      if (leaseTimer) clearInterval(leaseTimer);
      if (cancelWatchTimer) clearInterval(cancelWatchTimer);
      await this.deps.repository.releaseLock(lockKey, operation.id, this.deps.config.workerId).catch(() => undefined);
      await this.clearEphemeralCredentialIfSafe(operation.id);
      this.currentController = undefined;
    }
  }

  private async abortIfCancelRequested(operationId: string, controller: AbortController) {
    if (controller.signal.aborted) return;
    const operation = await Promise.resolve(this.deps.repository.get(operationId)).catch(() => undefined);
    if (operation?.status === "cancelling" || operation?.cancelRequestedAt) {
      controller.abort();
    }
  }

  private async heartbeat(status: "online" | "draining" | "offline", metadata?: Record<string, unknown>) {
    const heartbeat = this.deps.repository.upsertWorkerHeartbeat;
    if (!heartbeat) return;
    await heartbeat.call(this.deps.repository, this.deps.config.workerId, status, {
      ...metadata,
      host: os.hostname(),
      repositoryMode: this.deps.config.repositoryMode,
      browserProvider: this.deps.config.browserProvider,
      cardIssueEnabled: this.deps.config.features.cardIssue,
      inclusionPreviewEnabled: this.deps.config.features.inclusionPreview,
      inclusionSubmitEnabled: this.deps.config.features.inclusion,
      exclusionPreviewEnabled: this.deps.config.features.exclusionPreview,
      exclusionSubmitEnabled: this.deps.config.features.exclusion,
      movementStatusVerifyMaxAttempts: this.deps.config.movementStatusVerifyMaxAttempts,
    }).catch(() => undefined);
  }

  private async updateStatus(operationId: string, status: OperationStatus, step: string, data?: Record<string, unknown>) {
    const operation = await this.deps.repository.setStatus(operationId, status, step, this.deps.config.workerId);
    const event = await this.deps.repository.appendEvent({
      operationId,
      type: status === "cancelled" ? "operation.cancelled" : status === "success" ? "operation.success" : "operation.status",
      status,
      step,
      data,
      createdAt: new Date().toISOString(),
    });
    this.deps.eventBus.publish(event);

    return operation ?? this.deps.repository.get(operationId);
  }

  private async emitEvent(event: Parameters<WorkflowContext["emitEvent"]>[0]) {
    const created = await this.deps.repository.appendEvent({
      ...event,
      createdAt: event.createdAt ?? new Date().toISOString(),
    });
    this.deps.eventBus.publish(created);
    return created;
  }

  private async handleAuthenticationFailed(operation: OperationRecord, error: AutomationError) {
    const operationError = this.toOperationError(error);
    await this.deps.repository.update(operation.id, {
      status: "awaiting_authentication",
      error: operationError,
      currentStep: "authentication_failed",
      updatedAt: new Date().toISOString(),
    });

    await this.emitEvent({
      operationId: operation.id,
      type: "authentication.failed",
      status: "awaiting_authentication",
      step: "authentication_failed",
      data: {
        error: operationError.code,
        safeDetails: operationError.safeDetails,
        retryable: true,
      },
    });
  }

  private async clearEphemeralCredentialIfSafe(operationId: string) {
    if (!this.deps.ephemeralCredentialStore) return;

    const latest = await Promise.resolve(this.deps.repository.get(operationId)).catch(() => undefined);
    if (
      latest?.status === "awaiting_authentication" ||
      (latest?.status === "queued" && latest.currentStep === "authentication_submitted")
    ) {
      return;
    }

    this.deps.ephemeralCredentialStore.clear(operationId);
  }

  private async fail(operationId: string, error: OperationError) {
    await this.deps.repository.update(operationId, {
      status: "error",
      error,
      currentStep: error.step ?? "worker_error",
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const event = await this.deps.repository.appendEvent({
      operationId,
      type: "operation.error",
      status: "error",
      step: error.step,
      data: { error, hostname: os.hostname() },
      createdAt: new Date().toISOString(),
    });
    this.deps.eventBus.publish(event);
  }

  private toOperationError(error: unknown): OperationError {
    if (error instanceof AutomationError) {
      return {
        code: error.code,
        message: error.message,
        safeDetails: sanitizeDiagnosticText(error.safeDetails),
        step: error.step,
        retryable: error.retryable,
      };
    }

    if (error instanceof Error) {
      return {
        code: "WORKER_ERROR",
        message: "Nao foi possivel concluir a movimentacao.",
        safeDetails: sanitizeDiagnosticText(error.message),
        retryable: false,
      };
    }

    return {
      code: "WORKER_ERROR",
      message: "Nao foi possivel concluir a movimentacao.",
      retryable: false,
    };
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
