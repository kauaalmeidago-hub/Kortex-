import { AutomationError, assertNotAborted } from "../../errors.js";
import type { OperationRecord } from "../../types.js";
import type { WorkflowContext } from "../WorkflowContext.js";
import { maskCpf, normalizeCpf, normalizeName } from "./exclusionUtils.js";
import { type ActiveUserRow, type ActiveUsersTotals, HapvidaActiveUsersPage } from "./pageObjects/HapvidaActiveUsersPage.js";
import { HapvidaMovementMainMenuPage } from "./pageObjects/HapvidaMovementMainMenuPage.js";

export type ActiveUsersPreflightWorkflow =
  | "CARD_ISSUE"
  | "INCLUSION_HOLDER"
  | "INCLUSION_DEPENDENT"
  | "EXCLUSION_HOLDER"
  | "EXCLUSION_DEPENDENT";

export interface ActiveUsersPreflightInput {
  beneficiaryName?: string;
  beneficiaryCpf?: string;
  beneficiaryCode?: string;
  holderName?: string;
  holderCpf?: string;
  dependentName?: string;
  dependentCpf?: string;
}

export interface SafeActiveUserSnapshot {
  found: boolean;
  type?: string;
  name?: string;
  cpfMasked?: string;
  enrollment?: string;
  userCode?: string;
  plan?: string;
}

export interface ActiveUsersPreflightSnapshot {
  companyId: string;
  workflow: ActiveUsersPreflightWorkflow;
  fetchedAt: string;
  target?: SafeActiveUserSnapshot;
  holder?: SafeActiveUserSnapshot;
  totals: ActiveUsersTotals;
}

export interface ActiveUsersPreflightResult {
  snapshot: ActiveUsersPreflightSnapshot;
  target?: ActiveUserRow;
  holder?: ActiveUserRow;
}

interface ActiveUsersPreflightServiceDeps {
  operation: OperationRecord;
  context: WorkflowContext;
  signal: AbortSignal;
  menuPage: HapvidaMovementMainMenuPage;
  activeUsersPage: HapvidaActiveUsersPage;
}

function isHolder(row: ActiveUserRow | undefined) {
  const type = normalizeName(row?.type ?? row?.rawText);
  return type.includes("titular") && !type.includes("dependente");
}

function isDependent(row: ActiveUserRow | undefined) {
  return normalizeName(row?.type ?? row?.rawText).includes("dependente");
}

function matchesByCpf(row: ActiveUserRow, cpf: string | undefined) {
  const expectedCpf = normalizeCpf(cpf);
  if (!expectedCpf) return false;

  const rowCpf = normalizeCpf(row.cpf);
  const rowText = normalizeCpf(row.rawText);
  return rowCpf === expectedCpf || (!rowCpf && rowText.includes(expectedCpf));
}

function matchesByCode(row: ActiveUserRow, code: string | undefined) {
  if (!code?.trim()) return false;
  return normalizeName(row.userCode) === normalizeName(code);
}

function matchesByName(row: ActiveUserRow, name: string | undefined) {
  const expectedName = normalizeName(name);
  if (!expectedName) return false;

  const rowName = normalizeName(row.name);
  if (rowName) return rowName === expectedName;

  return normalizeName(row.rawText).includes(expectedName);
}

function toSafeSnapshot(row: ActiveUserRow | undefined): SafeActiveUserSnapshot {
  if (!row) return { found: false };

  return {
    found: true,
    type: row.type,
    name: row.name,
    cpfMasked: maskCpf(row.cpf),
    enrollment: row.enrollment,
    userCode: row.userCode,
    plan: row.plan,
  };
}

function findTarget(rows: ActiveUserRow[], input: ActiveUsersPreflightInput, nameKey: "beneficiaryName" | "holderName" | "dependentName" = "beneficiaryName", cpfKey: "beneficiaryCpf" | "holderCpf" | "dependentCpf" = "beneficiaryCpf") {
  const cpf = input[cpfKey];
  if (normalizeCpf(cpf)) {
    const byCpf = rows.filter((row) => matchesByCpf(row, cpf));
    if (byCpf.length > 0) return requireSingle(byCpf, "CPF");
  }

  if (input.beneficiaryCode) {
    const byCode = rows.filter((row) => matchesByCode(row, input.beneficiaryCode));
    if (byCode.length > 0) return requireSingle(byCode, "codigo");
  }

  const byName = rows.filter((row) => matchesByName(row, input[nameKey]));
  if (byName.length > 0) return requireSingle(byName, "nome");

  return undefined;
}

function requireSingle(matches: ActiveUserRow[], label: string) {
  if (matches.length === 1) return matches[0]!;

  throw new AutomationError("BENEFICIARY_AMBIGUOUS", "Mais de um beneficiario encontrado na Lista Usuarios Ativos.", {
    safeDetails: `A busca por ${label} retornou mais de um registro ativo. Informe dados adicionais antes de continuar.`,
    step: "checking_active_users",
    retryable: false,
  });
}

function assertUserCode(row: ActiveUserRow | undefined) {
  if (row?.userCode?.trim()) return row.userCode;

  throw new AutomationError("PORTAL_CHANGED", "Codigo do usuario ativo nao encontrado.", {
    safeDetails: "A linha do beneficiario foi encontrada, mas a coluna CODIGO nao pode ser lida.",
    step: "checking_active_users",
    retryable: false,
  });
}

function emptySnapshot(companyId: string, workflow: ActiveUsersPreflightWorkflow, totals: ActiveUsersTotals): ActiveUsersPreflightSnapshot {
  return {
    companyId,
    workflow,
    fetchedAt: new Date().toISOString(),
    totals,
  };
}

export function evaluateActiveUsersPreflight(input: {
  workflow: ActiveUsersPreflightWorkflow;
  companyId: string;
  rows: ActiveUserRow[];
  totals?: ActiveUsersTotals;
  data: ActiveUsersPreflightInput;
}): ActiveUsersPreflightResult {
  const totals =
    input.totals ??
    ({
      holders: input.rows.filter((row) => isHolder(row)).length,
      dependents: input.rows.filter((row) => isDependent(row)).length,
    } satisfies ActiveUsersTotals);
  const snapshot = emptySnapshot(input.companyId, input.workflow, totals);

  if (input.workflow === "CARD_ISSUE") {
    const target = findTarget(input.rows, input.data);
    if (!target) {
      throw new AutomationError("BENEFICIARY_NOT_ACTIVE", "Beneficiario nao esta ativo na Hapvida.", {
        safeDetails: "A Lista Usuarios Ativos nao reconhece o beneficiario informado como ativo.",
        step: "checking_active_users",
        retryable: false,
      });
    }

    assertUserCode(target);
    return { snapshot: { ...snapshot, target: toSafeSnapshot(target) }, target };
  }

  if (input.workflow === "EXCLUSION_HOLDER") {
    const target = findTarget(input.rows, input.data);
    if (!target) {
      throw new AutomationError("BENEFICIARY_NOT_ACTIVE", "Titular nao esta ativo na Hapvida.", {
        safeDetails: "A Lista Usuarios Ativos nao possui um titular ativo com os dados informados.",
        step: "checking_active_users",
        retryable: false,
      });
    }

    if (!isHolder(target)) {
      throw new AutomationError("BENEFICIARY_TYPE_MISMATCH", "O beneficiario localizado nao e titular.", {
        safeDetails: "A exclusao solicitada e de titular, mas o registro localizado na Lista Usuarios Ativos e dependente.",
        step: "checking_active_users",
        retryable: false,
      });
    }

    assertUserCode(target);
    return { snapshot: { ...snapshot, target: toSafeSnapshot(target) }, target };
  }

  if (input.workflow === "INCLUSION_HOLDER") {
    const target = findTarget(input.rows, input.data);
    if (target) {
      throw new AutomationError("BENEFICIARY_ALREADY_ACTIVE", "Beneficiario ja esta ativo na Hapvida.", {
        safeDetails: "A Lista Usuarios Ativos ja possui um registro para o CPF/nome informado.",
        step: "checking_active_users",
        retryable: false,
      });
    }

    return { snapshot: { ...snapshot, target: { found: false } } };
  }

  if (input.workflow === "INCLUSION_DEPENDENT") {
    const holder = findTarget(input.rows, input.data, "holderName", "holderCpf");
    if (!holder || !isHolder(holder)) {
      throw new AutomationError("HOLDER_NOT_ACTIVE", "Titular responsavel nao esta ativo na Hapvida.", {
        safeDetails: "A inclusao de dependente exige que o titular responsavel esteja ativo.",
        step: "checking_active_users",
        retryable: false,
      });
    }

    const dependent = findTarget(input.rows, input.data, "dependentName", "dependentCpf");
    if (dependent) {
      throw new AutomationError("DEPENDENT_ALREADY_ACTIVE", "Dependente ja esta ativo na Hapvida.", {
        safeDetails: "A Lista Usuarios Ativos ja possui um dependente com os dados informados.",
        step: "checking_active_users",
        retryable: false,
      });
    }

    return { snapshot: { ...snapshot, holder: toSafeSnapshot(holder), target: { found: false } }, holder };
  }

  const target = findTarget(input.rows, input.data);
  if (!target) {
    throw new AutomationError("BENEFICIARY_NOT_ACTIVE", "Dependente nao esta ativo na Hapvida.", {
      safeDetails: "A Lista Usuarios Ativos nao possui um dependente ativo com os dados informados.",
      step: "checking_active_users",
      retryable: false,
    });
  }

  if (!isDependent(target)) {
    throw new AutomationError("BENEFICIARY_TYPE_MISMATCH", "O beneficiario localizado nao e dependente.", {
      safeDetails: "A exclusao solicitada e de dependente, mas o registro localizado na Lista Usuarios Ativos nao e dependente.",
      step: "checking_active_users",
      retryable: false,
    });
  }

  assertUserCode(target);
  return { snapshot: { ...snapshot, target: toSafeSnapshot(target) }, target };
}

export class ActiveUsersPreflightService {
  constructor(private readonly deps: ActiveUsersPreflightServiceDeps) {}

  validateCardIssue(data: ActiveUsersPreflightInput) {
    return this.run("CARD_ISSUE", data);
  }

  validateExclusionHolder(data: ActiveUsersPreflightInput) {
    return this.run("EXCLUSION_HOLDER", data);
  }

  validateInclusionHolder(data: ActiveUsersPreflightInput) {
    return this.run("INCLUSION_HOLDER", data);
  }

  validateInclusionDependent(data: ActiveUsersPreflightInput) {
    return this.run("INCLUSION_DEPENDENT", data);
  }

  private async run(workflow: ActiveUsersPreflightWorkflow, data: ActiveUsersPreflightInput) {
    const { operation, context, signal } = this.deps;

    try {
      await context.updateStatus("checking_active_users", "Validando os usuarios ativos da empresa...");
      await context.emitEvent({
        operationId: operation.id,
        type: "preflight.active_users.started",
        status: "checking_active_users",
        step: "checking_active_users",
        data: { workflow, companyId: operation.companyId },
      });

      await this.deps.menuPage.openActiveUsers();
      await this.deps.activeUsersPage.load();
      assertNotAborted(signal);

      const rows = await this.deps.activeUsersPage.getRows();
      const totals = await this.deps.activeUsersPage.getTotals();
      await context.emitEvent({
        operationId: operation.id,
        type: "preflight.active_users.loaded",
        status: "checking_active_users",
        step: "checking_active_users",
        data: { workflow, companyId: operation.companyId, totals },
      });

      const result = evaluateActiveUsersPreflight({
        workflow,
        companyId: operation.companyId,
        rows,
        totals,
        data,
      });

      if (result.target?.name || result.holder?.name) {
        await context.emitEvent({
          operationId: operation.id,
          type: "preflight.beneficiary.found",
          status: "checking_active_users",
          step: "checking_active_users",
          data: {
            workflow,
            beneficiary: result.snapshot.target ?? result.snapshot.holder,
          },
        });
      } else {
        await context.emitEvent({
          operationId: operation.id,
          type: "preflight.beneficiary.not_found",
          status: "checking_active_users",
          step: "checking_active_users",
          data: { workflow },
        });
      }

      await context.emitEvent({
        operationId: operation.id,
        type: "preflight.beneficiary.validated",
        status: "checking_active_users",
        step: "checking_active_users",
        data: { ...result.snapshot },
      });

      return result;
    } catch (error) {
      await context.emitEvent({
        operationId: operation.id,
        type: "preflight.failed",
        status: "checking_active_users",
        step: "checking_active_users",
        data: {
          workflow,
          errorCode: error instanceof AutomationError ? error.code : "ACTIVE_USERS_LIST_UNAVAILABLE",
        },
      });

      if (error instanceof AutomationError) throw error;
      throw new AutomationError("ACTIVE_USERS_LIST_UNAVAILABLE", "Nao consegui validar a Lista Usuarios Ativos.", {
        safeDetails: error instanceof Error ? error.message : undefined,
        step: "checking_active_users",
        retryable: false,
      });
    }
  }
}
