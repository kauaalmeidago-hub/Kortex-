import type { OperationRecord } from "../types.js";
import type { WorkflowContext } from "./WorkflowContext.js";
import { WorkflowRegistry } from "./WorkflowRegistry.js";

const registry = new WorkflowRegistry();

export async function runWorkflow(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext) {
  return registry.run(operation, signal, context);
}
