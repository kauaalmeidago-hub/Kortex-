import type { Task, TaskCatalog } from "@/features/tasks/model";
import { companyFixture } from "./companyFixtures";
export const taskIds = {
  workspace: "10000000-0000-4000-8000-000000000001",
  admin: "20000000-0000-4000-8000-000000000001",
  user: "20000000-0000-4000-8000-000000000002",
  other: "20000000-0000-4000-8000-000000000003",
  sector: "30000000-0000-4000-8000-000000000001",
  otherSector: "30000000-0000-4000-8000-000000000002",
  conversation: "40000000-0000-4000-8000-000000000001",
  draft: "50000000-0000-4000-8000-000000000001",
};
export function taskCatalogFixture(): TaskCatalog {
  const company = {
    ...companyFixture,
    id: "60000000-0000-4000-8000-000000000001",
    workspace_id: taskIds.workspace,
    name: "Empresa de validação",
    project: "PME",
    offerings: [{ product: "Saúde", operator: "Hapvida" }],
  };
  return {
    companies: [company],
    people: [
      {
        user_id: taskIds.admin,
        full_name: "Administrador de validação",
        email: "admin@controle.invalid",
        role: "admin",
      },
      {
        user_id: taskIds.user,
        full_name: "Integrante de validação",
        email: "integrante@controle.invalid",
        role: "member",
      },
      {
        user_id: taskIds.other,
        full_name: "Outro integrante",
        email: "outro@controle.invalid",
        role: "member",
      },
    ],
    sectors: [
      {
        id: taskIds.sector,
        workspace_id: taskIds.workspace,
        name: "Financeiro de validação",
        active: true,
      },
      {
        id: taskIds.otherSector,
        workspace_id: taskIds.workspace,
        name: "Operação de validação",
        active: true,
      },
    ],
    members: [
      {
        workspace_id: taskIds.workspace,
        sector_id: taskIds.sector,
        user_id: taskIds.user,
      },
      {
        workspace_id: taskIds.workspace,
        sector_id: taskIds.otherSector,
        user_id: taskIds.other,
      },
    ],
    stages: [
      ["todo", "A fazer"],
      ["in_progress", "Em andamento"],
      ["review", "Em revisão"],
      ["done", "Concluído"],
      ["canceled", "Cancelado"],
    ].map(([id, name], position) => ({
      id,
      name,
      workspace_id: taskIds.workspace,
      color: "blue",
      position,
      base_status: id as Task["status"],
      archived: id === "canceled",
    })),
  };
}
export function taskFixture(patch: Partial<Task> = {}): Task {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    workspace_id: taskIds.workspace,
    title: "Revisar dados de validação",
    description: "Conferir os dados informados neste teste.",
    created_by: taskIds.user,
    assigned_to: taskIds.user,
    sector_id: null,
    company_id: null,
    operational_code: null,
    operator: null,
    project: null,
    due_date: "2026-10-20T15:00:00+00:00",
    status: "todo",
    stage_id: "todo",
    priority: "medium",
    completed_at: null,
    contact_id: null,
    lead_id: null,
    assigned_by: taskIds.user,
    assigned_at: "2026-10-15T15:00:00Z",
    request_key: null,
    created_at: "2026-10-15T15:00:00Z",
    updated_at: "2026-10-15T15:00:00Z",
    ...patch,
  };
}
