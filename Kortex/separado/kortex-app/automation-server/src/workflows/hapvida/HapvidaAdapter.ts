import type { OperationRecord } from "../../types.js";
import { unsupportedWorkflow } from "./unsupportedWorkflow.js";
import { emitCard } from "./emitCard.js";
import { prepareHolderInclusion } from "./prepareHolderInclusion.js";
import { prepareHolderExclusion } from "./prepareHolderExclusion.js";
import type { WorkflowContext } from "../WorkflowContext.js";
import type { OperatorAdapter } from "../OperatorAdapter.js";

export class HapvidaAdapter implements OperatorAdapter {
  issueCard(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext) {
    return emitCard(operation, signal, context);
  }

  includeHolder(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext): Promise<void> {
    return prepareHolderInclusion(operation, signal, context);
  }

  includeDependent(operation: OperationRecord, _signal?: AbortSignal, _context?: WorkflowContext): Promise<void> {
    unsupportedWorkflow(operation);
  }

  excludeHolder(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext): Promise<void> {
    return prepareHolderExclusion(operation, signal, context);
  }

  excludeDependent(operation: OperationRecord, _signal?: AbortSignal, _context?: WorkflowContext): Promise<void> {
    unsupportedWorkflow(operation);
  }
}
