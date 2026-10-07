import { AutomationError } from "../../errors.js";
import type { OperationRecord } from "../../types.js";

export function unsupportedWorkflow(operation: OperationRecord): never {
  throw new AutomationError("WORKFLOW_NOT_IMPLEMENTED", "Workflow ainda nao implementado.", {
    safeDetails: `O fluxo ${operation.type} foi registrado na arquitetura, mas ainda aguarda mapeamento validado do portal Hapvida.`,
    retryable: false,
  });
}
