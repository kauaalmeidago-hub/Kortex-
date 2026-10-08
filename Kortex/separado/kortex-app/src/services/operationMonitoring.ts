import type { AutomationEvent, AutomationOperationResponse, AutomationOperationStatus } from "./automationApi";

export type OperationConnectionState = "live" | "reconnecting";

export const OPERATION_POLLING_INTERVAL_MS = 2500;
export const OPERATION_RECONNECT_INTERVAL_MS = 5000;

const terminalStatuses = new Set<AutomationOperationStatus>([
  "success",
  "error",
  "cancelled",
  "manual_review",
  "awaiting_confirmation",
  "awaiting_human_verification",
  "submission_confirmed",
]);

export function isTerminalOperationStatus(status: AutomationOperationStatus) {
  return terminalStatuses.has(status);
}

export function operationToAutomationEvent(operation: AutomationOperationResponse): AutomationEvent {
  return {
    id: `${operation.operationId}:${operation.updatedAt}`,
    operationId: operation.operationId,
    type:
      operation.status === "success"
        ? "operation.success"
        : operation.status === "error"
          ? "operation.error"
          : operation.status === "cancelled"
            ? "operation.cancelled"
            : "operation.status",
    status: operation.status,
    step: operation.currentStep,
    data: operation.result ?? (operation.error ? { error: operation.error } : undefined),
    createdAt: operation.updatedAt,
  };
}

type TimerId = ReturnType<typeof setInterval>;

export interface OperationFallbackMonitorOptions {
  operationId: string;
  pollOperation: (operationId: string) => Promise<AutomationOperationResponse>;
  onEvent: (event: AutomationEvent) => void;
  onConnectionState?: (state: OperationConnectionState) => void;
  reconnect?: () => void;
  pollingIntervalMs?: number;
  reconnectIntervalMs?: number;
}

export function createOperationFallbackMonitor({
  operationId,
  pollOperation,
  onEvent,
  onConnectionState,
  reconnect,
  pollingIntervalMs = OPERATION_POLLING_INTERVAL_MS,
  reconnectIntervalMs = OPERATION_RECONNECT_INTERVAL_MS,
}: OperationFallbackMonitorOptions) {
  let stopped = false;
  let fallbackActive = false;
  let pollInFlight = false;
  let pollingTimer: TimerId | undefined;
  let reconnectTimer: TimerId | undefined;

  const clearTimers = () => {
    if (pollingTimer) clearInterval(pollingTimer);
    if (reconnectTimer) clearInterval(reconnectTimer);
    pollingTimer = undefined;
    reconnectTimer = undefined;
  };

  const stopFallback = () => {
    if (!fallbackActive) return;
    fallbackActive = false;
    clearTimers();
    onConnectionState?.("live");
  };

  const pollOnce = async () => {
    if (stopped || pollInFlight) return;
    pollInFlight = true;

    try {
      const operation = await pollOperation(operationId);
      if (stopped) return;
      onEvent(operationToAutomationEvent(operation));

      if (isTerminalOperationStatus(operation.status)) {
        stopFallback();
      }
    } catch {
      // Keep polling. A transient read failure is not an operation failure.
    } finally {
      pollInFlight = false;
    }
  };

  const startFallback = () => {
    if (stopped || fallbackActive) return;
    fallbackActive = true;
    onConnectionState?.("reconnecting");
    void pollOnce();
    pollingTimer = setInterval(() => void pollOnce(), pollingIntervalMs);
    if (reconnect) {
      reconnectTimer = setInterval(() => reconnect(), reconnectIntervalMs);
    }
  };

  const stop = () => {
    stopped = true;
    stopFallback();
    clearTimers();
  };

  return {
    startFallback,
    stopFallback,
    pollOnce,
    stop,
    isFallbackActive: () => fallbackActive,
  };
}
