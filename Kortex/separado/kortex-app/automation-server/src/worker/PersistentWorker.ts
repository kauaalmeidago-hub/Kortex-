import os from "node:os";
import type { AutomationConfig } from "../config.js";
import type { BrowserManager } from "../browser/BrowserManager.js";
import type { OperationEventBus } from "../events/EventBus.js";
import type { SecretProvider } from "../secrets/SecretProvider.js";
import type { PersistentAutomationQueueRepository } from "../repositories/AutomationOperationRepository.js";
import { runWorkflow } from "../workflows/WorkflowRunner.js";
import { recordAuthenticationFailure } from "../authentication/AuthenticationAttemptPolicy.js";
import { AutomationError, isAbortError } from "../errors.js";
import type { OperationError, OperationRecord, OperationStatus } from "../types.js";
import type { ArtifactStorage } from "../storage/ArtifactStorage.js";
import type { WorkflowContext } from "../workflows/WorkflowContext.js";
import { sanitizeDiagnosticText } from "../security/redaction.js";
import { type EphemeralCredentialStore, OperationScopedSecretProvider } from "../secrets/EphemeralCredentialStore.js";

import type { CredentialResolver } from "../credentials/CredentialResolver.js";

interface PersistentWorkerDeps {
  config: AutomationConfig;
  repository: PersistentAutomationQueueRepository;
  eventBus: OperationEventBus;
  browserManager: BrowserManager;
  secretProvider: SecretProvider;
  ephemeralCredentialStore?: EphemeralCredentialStore;
  artifactStorage: ArtifactStorage;
  credentialResolver?: CredentialResolver;
}

export class PersistentWorker {
  private stopping = false;
  private currentController?: AbortController;
  private heartbeatTimer?: NodeJS.Timeout;
  private wakeUp?: () => void;
  private running = false;
  private queueConnected = false;

  constructor(private readonly deps: PersistentWorkerDeps) {}

  isReady() {
    return this.running && !this.stopping && this.queueConnected;
  }

  stop() {
    this.stopping = true;
    this.currentController?.abort();
    this.wakeUp?.();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  async run() {
    this.running = true;
    await this.heartbeat("online", { mode: this.deps.config.automationMode });
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat("online", { mode: this.deps.config.automationMode });
    }, this.deps.config.workerHeartbeatIntervalMs);

    let consecutiveFailures = 0;
    try {
      while (!this.stopping) {
        try {
          await this.deps.repository.markStaleOperationsForReview();
          if (this.stopping) break;
          const operation = await this.deps.repository.claimNext(this.deps.config.workerId, this.deps.config.workerLeaseSeconds);
          this.queueConnected = true;
          consecutiveFailures = 0;
          if (this.stopping) break;
          if (!operation) {
            await this.sleep(this.deps.config.workerPollIntervalMs);
            continue;
          }

          await this.execute(operation);
        } catch {
          this.queueConnected = false;
          // Retry queue connectivity, never replay a portal action with an uncertain outcome.
          // Do not log the database exception: it may contain credentials or connection URLs.
          consecutiveFailures += 1;
          if (consecutiveFailures === 1 && !this.stopping) {
            console.warn("Koa worker: conexao com a fila indisponivel; reconectando automaticamente.");
          }
          await this.sleep(Math.min(30_000, Math.max(1000, this.deps.config.workerPollIntervalMs) * 2 ** Math.min(consecutiveFailures - 1, 5)));
        }
      }
    } finally {
      this.running = false;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      await this.deps.repository.markWorkerOffline?.(this.deps.config.workerId).catch(() => undefined);
    }
  }

  private async execute(operation: OperationRecord) {
    const controller = new AbortController();
    const credentialGeneration = this.deps.ephemeralCredentialStore?.snapshotGeneration();
    this.currentController = controller;
    const lockKeys = operation.type === "CARD_ISSUE" && operation.input.portalSearch !== "selected"
      ? [`hapvida:company:${operation.companyId}`, `ndi:company:${operation.companyId}`]
      : [`${operation.portal}:company:${operation.companyId}`];
    const acquiredLocks: string[] = [];
    let leaseTimer: NodeJS.Timeout | undefined;
    let leaseRenewal: Promise<void> | undefined;
    let leaseLost = false;
    let cancelWatchTimer: NodeJS.Timeout | undefined;

    try {
      if (operation.status === "cancelling" || operation.cancelRequestedAt) {
        await this.updateStatus(operation.id, "cancelled", "Operacao cancelada antes de iniciar");
        return;
      }

      for (const lockKey of lockKeys) {
        const lockAcquired = await this.deps.repository.acquireLock(
          lockKey, operation.id, this.deps.config.workerId, this.deps.config.workerLeaseSeconds,
        );
        if (!lockAcquired) {
          throw new AutomationError("LOCK_NOT_ACQUIRED", "Nao foi possivel adquirir lock da empresa.", {
            safeDetails: `Lock: ${lockKey}`, retryable: true,
          });
        }
        acquiredLocks.push(lockKey);
      }

      leaseTimer = setInterval(() => {
        if (leaseRenewal) return;
        leaseRenewal = (async () => {
          const locks = await Promise.all(acquiredLocks.map(lockKey => this.deps.repository.acquireLock(
            lockKey, operation.id, this.deps.config.workerId, this.deps.config.workerLeaseSeconds,
          )));
          const renewed = locks.every(Boolean) && await this.deps.repository.renewLease(
            operation.id, this.deps.config.workerId, this.deps.config.workerLeaseSeconds,
          );
          this.queueConnected = renewed;
          if (!renewed) { leaseLost = true; controller.abort(); }
        })().catch(() => { this.queueConnected = false; leaseLost = true; controller.abort(); })
          .finally(() => { leaseRenewal = undefined; });
      }, Math.max(5000, Math.floor((this.deps.config.workerLeaseSeconds * 1000) / 3)));

      cancelWatchTimer = setInterval(() => {
        void this.abortIfCancelRequested(operation.id, controller);
      }, Math.max(1500, this.deps.config.workerPollIntervalMs));

      await runWorkflow(operation, controller.signal, {
        config: this.deps.config,
        repository: this.deps.repository,
        browserManager: this.deps.browserManager,
        secretProvider: this.deps.ephemeralCredentialStore
          ? new OperationScopedSecretProvider(operation.id, this.deps.ephemeralCredentialStore, this.deps.secretProvider, credentialGeneration)
          : this.deps.secretProvider,
        artifactStorage: this.deps.artifactStorage,
        credentialResolver: this.deps.credentialResolver,
        retainCardConfirmationCredential: this.deps.ephemeralCredentialStore ? (op, credential) => {
          this.deps.ephemeralCredentialStore!.put(op.id, op.credentialRef, { ...credential,
            metadata: { ...credential.metadata, autoPortalCredential: false } }, 5 * 60_000);
        } : undefined,
        updateStatus: (status, step, data) => this.updateStatus(operation.id, status, step, data),
        emitEvent: (event) => this.emitEvent({ ...event, operationId: event.operationId ?? operation.id }),
      });
    } catch (error) {
      if (leaseLost) {
        await this.fail(operation.id, { code: "LOCK_LOST", message: "A execucao perdeu a reserva da empresa e foi interrompida.", retryable: true });
      } else if (controller.signal.aborted || isAbortError(error)) {
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
        await recordAuthenticationFailure(operation, error, {
          config: this.deps.config,
          repository: this.deps.repository,
          emitEvent: (event) => this.emitEvent(event),
        });
      } else {
        await this.fail(operation.id, this.toOperationError(error));
      }
    } finally {
      if (leaseTimer) clearInterval(leaseTimer);
      if (cancelWatchTimer) clearInterval(cancelWatchTimer);
      await leaseRenewal;
      await Promise.all(acquiredLocks.map(lockKey => this.deps.repository.releaseLock(
        lockKey, operation.id, this.deps.config.workerId,
      ).catch(() => undefined)));
      this.deps.ephemeralCredentialStore?.clear(operation.id, credentialGeneration);
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
      cardIssueWorkflowVersion: 8,
      cardIssueBeneficiaryChoiceEnabled: this.deps.config.features.cardIssue,
      cardDeliveryTemplateVersion: 1,
      cardDeliveryBrandingEnabled: this.deps.config.features.cardIssue,
      cardIssueSingleCaptureEnabled: this.deps.config.features.cardIssue,
      cardIssueDependentConfirmationEnabled: this.deps.config.features.cardIssue,
      cardIssuePrintAllEnabled: this.deps.config.features.cardIssue,
      cardPortalPreferenceVersion: 1,
      cardIssueBatchEnabled: this.deps.config.features.cardIssue,
      cardPreviewVersion: 2,
      cardPortalSearchDefault: "auto",
      portalAccessStorageVersion: 1,
      portalAccessStorage: this.deps.config.databaseUrl && this.deps.config.secretProviderMode !== "mock" ? "supabase_vault" : "local_dpapi",
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
    if (this.stopping) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.wakeUp = undefined;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.wakeUp = finish;
    });
  }
}

