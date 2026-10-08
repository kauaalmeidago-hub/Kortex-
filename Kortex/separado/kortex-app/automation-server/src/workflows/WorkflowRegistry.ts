import { AutomationError } from "../errors.js";
import type { OperationRecord } from "../types.js";
import type { WorkflowContext } from "./WorkflowContext.js";
import { HapvidaAdapter } from "./hapvida/HapvidaAdapter.js";
import { searchCardPortals } from "./CardPortalSearch.js";

export class WorkflowRegistry {
  private readonly hapvida = new HapvidaAdapter();

  async run(operation: OperationRecord, signal: AbortSignal, context: WorkflowContext) {
    if (operation.type === "CARD_ISSUE") return searchCardPortals(operation, signal, context);
    if (operation.portal === "ndi") {
      throw new AutomationError("PORTAL_MAPPING_REQUIRED", "Workflow NDI ainda aguarda mapeamento validado.", {
        safeDetails: "Os fluxos de inclusao e exclusao NDI ainda precisam de mapeamento validado.",
        retryable: false,
      });
    }

    if (operation.portal !== "hapvida") {
      throw new AutomationError("OPERATOR_NOT_IMPLEMENTED", "Operadora ainda nao implementada.", {
        safeDetails: `Operadora: ${operation.portal}`,
        retryable: false,
      });
    }

    if (operation.type === "INCLUSION_HOLDER") return this.hapvida.includeHolder(operation, signal, context);
    if (operation.type === "INCLUSION_DEPENDENT") return this.hapvida.includeDependent(operation, signal, context);
    if (operation.type === "EXCLUSION_HOLDER") return this.hapvida.excludeHolder(operation, signal, context);
    if (operation.type === "EXCLUSION_DEPENDENT") return this.hapvida.excludeDependent(operation, signal, context);

    throw new AutomationError("WORKFLOW_NOT_IMPLEMENTED", "Workflow ainda nao implementado.", {
      retryable: false,
    });
  }
}

