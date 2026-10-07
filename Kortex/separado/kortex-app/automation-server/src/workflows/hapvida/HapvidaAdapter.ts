import type { OperationRecord } from "../../types.js";
import { unsupportedWorkflow } from "./unsupportedWorkflow.js";
import { emitCard } from "./emitCard.js";
import type { WorkflowContext } from "../WorkflowContext.js";
import type { OperatorAdapter } from "../OperatorAdapter.js";

export class HapvidaAdapter implements OperatorAdapter {
  issueCard(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext) {
    return emitCard(operation, signal, context);
  }

  includeHolder(operation: OperationRecord, _signal?: AbortSignal, _context?: WorkflowContext): Promise<void> {
    unsupportedWorkflow(operation);
  }

  includeDependent(operation: OperationRecord, _signal?: AbortSignal, _context?: WorkflowContext): Promise<void> {
    unsupportedWorkflow(operation);
  }

  excludeHolder(operation: OperationRecord, _signal?: AbortSignal, _context?: WorkflowContext): Promise<void> {
    unsupportedWorkflow(operation);
  }

  excludeDependent(operation: OperationRecord, _signal?: AbortSignal, _context?: WorkflowContext): Promise<void> {
    unsupportedWorkflow(operation);
  }
}
