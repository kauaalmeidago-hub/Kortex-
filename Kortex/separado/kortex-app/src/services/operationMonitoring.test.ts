import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationOperationResponse, AutomationOperationStatus } from "./automationApi";
import { createOperationFallbackMonitor } from "./operationMonitoring";

function makeOperation(status: AutomationOperationStatus, extra: Partial<AutomationOperationResponse> = {}): AutomationOperationResponse {
  return {
    operationId: "op-1",
    status,
    type: "CARD_ISSUE",
    companyId: "company-1",
    portal: "hapvida",
    artifacts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("operation fallback monitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts polling the existing operation when the subscription reports CHANNEL_ERROR", async () => {
    const pollOperation = vi.fn().mockResolvedValue(makeOperation("processing"));
    const onEvent = vi.fn();
    const onConnectionState = vi.fn();

    const monitor = createOperationFallbackMonitor({
      operationId: "op-1",
      pollOperation,
      onEvent,
      onConnectionState,
      pollingIntervalMs: 100,
    });

    monitor.startFallback();
    await vi.advanceTimersByTimeAsync(0);

    expect(onConnectionState).toHaveBeenCalledWith("reconnecting");
    expect(pollOperation).toHaveBeenCalledWith("op-1");
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ operationId: "op-1", status: "processing" }));

    monitor.stop();
  });

  it("keeps polling while Realtime is offline", async () => {
    const pollOperation = vi.fn().mockResolvedValue(makeOperation("processing"));
    const monitor = createOperationFallbackMonitor({
      operationId: "op-1",
      pollOperation,
      onEvent: vi.fn(),
      pollingIntervalMs: 100,
    });

    monitor.startFallback();
    await vi.advanceTimersByTimeAsync(350);

    expect(pollOperation).toHaveBeenCalledTimes(4);

    monitor.stop();
  });

  it("stops polling when Realtime comes back", async () => {
    const pollOperation = vi.fn().mockResolvedValue(makeOperation("processing"));
    const onConnectionState = vi.fn();
    const monitor = createOperationFallbackMonitor({
      operationId: "op-1",
      pollOperation,
      onEvent: vi.fn(),
      onConnectionState,
      pollingIntervalMs: 100,
    });

    monitor.startFallback();
    await vi.advanceTimersByTimeAsync(100);
    monitor.stopFallback();
    await vi.advanceTimersByTimeAsync(300);

    expect(onConnectionState).toHaveBeenCalledWith("live");
    expect(pollOperation).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it("does not create a duplicate operation when the subscription falls during processing", async () => {
    const createOperation = vi.fn();
    const monitor = createOperationFallbackMonitor({
      operationId: "op-1",
      pollOperation: vi.fn().mockResolvedValue(makeOperation("processing")),
      onEvent: vi.fn(),
      pollingIntervalMs: 100,
    });

    monitor.startFallback();
    await vi.advanceTimersByTimeAsync(250);

    expect(createOperation).not.toHaveBeenCalled();

    monitor.stop();
  });

  it("shows success during polling and stops fallback", async () => {
    const onEvent = vi.fn();
    const monitor = createOperationFallbackMonitor({
      operationId: "op-1",
      pollOperation: vi.fn().mockResolvedValue(makeOperation("success")),
      onEvent,
      pollingIntervalMs: 100,
    });

    monitor.startFallback();
    await vi.advanceTimersByTimeAsync(300);

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "operation.success", status: "success" }));
    expect(monitor.isFallbackActive()).toBe(false);

    monitor.stop();
  });

  it("shows the real INVALID_PERIOD error during polling", async () => {
    const onEvent = vi.fn();
    const monitor = createOperationFallbackMonitor({
      operationId: "op-1",
      pollOperation: vi.fn().mockResolvedValue(
        makeOperation("error", {
          error: {
            code: "INVALID_PERIOD",
            message: "Invalid period.",
          },
        }),
      ),
      onEvent,
      pollingIntervalMs: 100,
    });

    monitor.startFallback();
    await vi.advanceTimersByTimeAsync(0);

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "operation.error",
        status: "error",
        data: {
          error: expect.objectContaining({ code: "INVALID_PERIOD" }),
        },
      }),
    );
    expect(monitor.isFallbackActive()).toBe(false);

    monitor.stop();
  });
});
