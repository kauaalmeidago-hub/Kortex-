import { AutomationError } from "../errors.js";
import type { OperationRecord } from "../types.js";
import type { WorkflowContext } from "./WorkflowContext.js";

export async function runFakeAutomationWorkflow(operation: OperationRecord, context: WorkflowContext) {
  if (process.env.NODE_ENV === "production") {
    throw new AutomationError("FAKE_WORKFLOW_DISABLED", "FakeWorkflow desabilitado em producao.", {
      retryable: false,
    });
  }

  await context.updateStatus("processing", `Fake processing ${operation.type}`);
  await context.updateStatus("verifying", `Fake verifying ${operation.type}`);

  return {
    beneficiaryName: operation.input.beneficiaryName ? String(operation.input.beneficiaryName) : undefined,
    portalStatus: "fake_success_dev_only",
  };
}
