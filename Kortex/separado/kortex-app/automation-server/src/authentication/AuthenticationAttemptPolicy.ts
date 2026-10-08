import type { AutomationConfig } from "../config.js";
import type { AutomationError } from "../errors.js";
import type { AutomationOperationRepository } from "../repositories/AutomationOperationRepository.js";
import { sanitizeDiagnosticText } from "../security/redaction.js";
import type { OperationError, OperationEvent, OperationRecord } from "../types.js";
import type { WorkflowContext } from "../workflows/WorkflowContext.js";

export function countAuthenticationFailures(events: OperationEvent[]) {
  return events.filter(
    (event) => event.type === "authentication.failed" && event.data?.error !== "DATABASE_OPERATION_UPDATE_FAILED",
  ).length;
}

export function authenticationAttemptLimitError(): OperationError {
  return {
    code: "AUTHENTICATION_ATTEMPTS_EXCEEDED",
    message: "Limite de tentativas de autenticacao excedido.",
    retryable: false,
    step: "authentication_attempts_exceeded",
  };
}

export async function recordAuthenticationFailure(
  operation: OperationRecord,
  error: AutomationError,
  context: {
    config: Pick<AutomationConfig, "authMaxAttempts">;
    repository: AutomationOperationRepository;
    emitEvent: WorkflowContext["emitEvent"];
  },
) {
  const attemptNumber = countAuthenticationFailures(await context.repository.getEvents(operation.id)) + 1;
  const limitReached = attemptNumber >= context.config.authMaxAttempts;
  const status = limitReached ? "manual_review" : "awaiting_authentication";
  const safeDetails = sanitizeDiagnosticText(error.safeDetails);
  const operationError: OperationError = limitReached
    ? authenticationAttemptLimitError()
    : { code: error.code, message: error.message, safeDetails, step: error.step, retryable: true };

  await context.repository.update(operation.id, {
    status,
    error: operationError,
    currentStep: limitReached ? "authentication_attempts_exceeded" : "authentication_failed",
    updatedAt: new Date().toISOString(),
    finishedAt: limitReached ? new Date().toISOString() : undefined,
  });
  await context.emitEvent({
    operationId: operation.id,
    type: "authentication.failed",
    status,
    step: "authentication_failed",
    data: { error: error.code, safeDetails, attemptNumber, retryable: !limitReached },
  });

  if (limitReached) {
    await context.emitEvent({
      operationId: operation.id,
      type: "operation.manual_review",
      status,
      step: "authentication_attempts_exceeded",
      data: { code: "AUTHENTICATION_ATTEMPTS_EXCEEDED", attemptNumber },
    });
  }
}
