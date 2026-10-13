import { describe, expect, it } from "vitest";
import { CARD_ISSUE_WORKFLOW_VERSION, cardWorkflowRuntime, isCurrentCardWorkflowRuntime } from "./CardWorkflowRuntime.js";

describe("the worker copy accepted by the permanent installer", () => {
  const current = () => ({ version: CARD_ISSUE_WORKFLOW_VERSION, ...cardWorkflowRuntime() });
  it("accepts the running code from the same directory", () => {
    expect(isCurrentCardWorkflowRuntime(current())).toBe(true);
  });
  it("rejects an older worker even when it is online", () => {
    expect(isCurrentCardWorkflowRuntime({ ...current(), version: 10 })).toBe(false);
  });
  it("rejects the same version with different emission code", () => {
    const info = current();
    const different = `${info.codeFingerprint?.[0] === "a" ? "b" : "a"}${info.codeFingerprint?.slice(1)}`;
    expect(isCurrentCardWorkflowRuntime({ ...info, codeFingerprint: different })).toBe(false);
  });
  it("rejects another checkout instead of silently keeping its supervisor", () => {
    expect(isCurrentCardWorkflowRuntime({ ...current(), runtimeDirectory: `${current().runtimeDirectory}/another-copy` })).toBe(false);
  });
  it.each([undefined, {}, { ...current(), codeFingerprint: undefined }])("does not accept missing runtime evidence", value => {
    expect(isCurrentCardWorkflowRuntime(value)).toBe(false);
  });
});
