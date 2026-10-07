import { AutomationError, isAbortError } from "../errors.js";
import type { BrowserManager } from "../browser/BrowserManager.js";
import type { OperationEventBus } from "../events/EventBus.js";
import type { SecretProvider } from "../secrets/SecretProvider.js";
import type { AutomationConfig } from "../config.js";
import type { OperationArtifact, OperationError, OperationRecord, OperationStatus } from "../types.js";
import { runWorkflow } from "../workflows/WorkflowRunner.js";
import type { AutomationOperationRepository } from "../repositories/AutomationOperationRepository.js";
import type { ArtifactStorage } from "../storage/ArtifactStorage.js";
import type { WorkflowContext } from "../workflows/WorkflowContext.js";

interface OperationQueueDeps {
  config: AutomationConfig;
  repository: AutomationOperationRepository;
  eventBus: OperationEventBus;
  browserManager: BrowserManager;
  secretProvider: SecretProvider;
  artifactStorage: ArtifactStorage;
}

export class OperationQueue {
  private readonly pending: string[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private activeOperationId?: string;

  constructor(private readonly deps: OperationQueueDeps) {}

  enqueue(operationId: string) {
    if (!this.pending.includes(operationId) && this.activeOperationId !== operationId) {
      this.pending.push(operationId);
    }

    void this.drain();
  }

  async cancel(operationId: string) {
    const persistentCancel = (this.deps.repository as { requestCancel?: (operationId: string) => Promise<OperationRecord | undefined> }).requestCancel;
    if (persistentCancel) {
      const operation = await persistentCancel.call(this.deps.repository, operationId);
      if (!operation) return { ok: false, reason: "not_found" as const };
      this.controllers.get(operationId)?.abort();
      return { ok: true, operation };
    }

    const operation = await this.deps.repository.get(operationId);
    if (!operation) return { ok: false, reason: "not_found" as const };

    if (!["queued", "starting", "authenticating", "accessing_portal", "processing", "verifying"].includes(operation.status)) {
      return { ok: false, reason: "not_cancellable" as const, operation };
    }

    await this.setStatus(operation.id, "cancelling", "Cancelamento solicitado");

    const queuedIndex = this.pending.indexOf(operationId);
    if (queuedIndex >= 0) {
      this.pending.splice(queuedIndex, 1);
      const cancelled = await this.setStatus(operation.id, "cancelled", "Operacao cancelada antes de iniciar", true);
      return { ok: true, operation: cancelled };
    }

    this.controllers.get(operationId)?.abort();
    return { ok: true, operation: await this.deps.repository.get(operationId) };
  }

  private async drain() {
    if (this.activeOperationId) return;

    const nextId = this.pending.shift();
    if (!nextId) return;

    const operation = await this.deps.repository.get(nextId);
    if (!operation || operation.status !== "queued") {
      void this.drain();
      return;
    }

    this.activeOperationId = nextId;
    const controller = new AbortController();
    this.controllers.set(nextId, controller);

    try {
      await this.setStatus(nextId, "starting", "Preparando automacao");
      await runWorkflow(operation, controller.signal, {
        config: this.deps.config,
        repository: this.deps.repository,
        browserManager: this.deps.browserManager,
        secretProvider: this.deps.secretProvider,
        artifactStorage: this.deps.artifactStorage,
        updateStatus: (status, step, data) => this.setStatus(nextId, status, step, this.isFinalStatus(status), data),
        emitEvent: (event) => this.emitEvent({ ...event, operationId: event.operationId ?? nextId }),
      });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        await this.setStatus(nextId, "cancelled", "Operacao cancelada pelo usuario", true);
      } else {
        await this.fail(nextId, this.toOperationError(error), this.extractErrorArtifact(error));
      }
    } finally {
      this.controllers.delete(nextId);
      this.activeOperationId = undefined;
      void this.drain();
    }
  }

  private async setStatus(
    operationId: string,
    status: OperationStatus,
    step: string,
    finished = false,
    data?: Record<string, unknown>,
  ) {
    const now = new Date().toISOString();
    const operation = await this.deps.repository.update(operationId, {
      status,
      currentStep: step,
      updatedAt: now,
      finishedAt: finished ? now : undefined,
    });

    if (!operation) {
      throw new AutomationError("OPERATION_NOT_FOUND", "Operacao nao encontrada.", { retryable: false });
    }

    const eventType = status === "cancelled" ? "operation.cancelled" : "operation.status";
    const event = await this.deps.repository.appendEvent({
      operationId,
      type: eventType,
      status,
      step,
      data,
      createdAt: now,
    });
    this.deps.eventBus.publish(event);
    return operation;
  }

  private async emitEvent(event: Parameters<WorkflowContext["emitEvent"]>[0]) {
    const created = await this.deps.repository.appendEvent({
      ...event,
      createdAt: event.createdAt ?? new Date().toISOString(),
    });
    this.deps.eventBus.publish(created);
    return created;
  }

  private isFinalStatus(status: OperationStatus) {
    return status === "success" || status === "error" || status === "cancelled" || status === "manual_review";
  }

  private async fail(operationId: string, error: OperationError, artifact?: OperationArtifact) {
    const now = new Date().toISOString();
    const current = await this.deps.repository.get(operationId);
    const operation = await this.deps.repository.update(operationId, {
      status: "error",
      error,
      artifacts: artifact && current ? [...current.artifacts, artifact] : current?.artifacts,
      currentStep: error.step,
      updatedAt: now,
      finishedAt: now,
    });

    if (!operation) return;

    const event = await this.deps.repository.appendEvent({
      operationId,
      type: "operation.error",
      status: "error",
      step: error.step,
      data: { error },
      createdAt: now,
    });
    this.deps.eventBus.publish(event);
  }

  private toOperationError(error: unknown): OperationError {
    if (error instanceof AutomationError) {
      return {
        code: error.code,
        message: error.message,
        safeDetails: error.safeDetails,
        step: error.step,
        retryable: error.retryable,
      };
    }

    if (error instanceof Error) {
      return {
        code: "AUTOMATION_ERROR",
        message: "Nao foi possivel concluir a movimentacao.",
        safeDetails: error.message,
        retryable: false,
      };
    }

    return {
      code: "AUTOMATION_ERROR",
      message: "Nao foi possivel concluir a movimentacao.",
      retryable: false,
    };
  }

  private extractErrorArtifact(error: unknown) {
    if (!error || typeof error !== "object") return undefined;
    const context = (error as { automationErrorContext?: { artifact?: OperationArtifact } }).automationErrorContext;
    return context?.artifact;
  }
}
