import type { OperationRecord } from "../types.js";
import type { WorkflowContext } from "./WorkflowContext.js";

export interface OperatorAdapter {
  issueCard(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext): Promise<void>;
  includeHolder(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext): Promise<void>;
  includeDependent(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext): Promise<void>;
  excludeHolder(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext): Promise<void>;
  excludeDependent(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext): Promise<void>;
  verifyOperation?(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext): Promise<void>;
}
