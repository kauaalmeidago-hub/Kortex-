import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
import { taskFailure } from "@/features/tasks/service";
export type LeadRow = Database["public"]["Tables"]["leads"]["Row"] & {
  can_edit?: boolean;
  company?: { id: string; name: string; email: string | null; phone: string | null };
  contact?: { id: string; full_name: string; company_id: string | null; email: string | null; phone: string | null };
  assignee?: { id: string; full_name: string | null; avatar_url: string | null };
  task_count?: number;
};
export type PipelineStage = Database["public"]["Tables"]["stages"]["Row"];
export async function savePipelineColumn(
  scope: BusinessContext,
  id: string,
  name: string,
  create = false,
) {
  const r = await supabase.rpc("business_pipeline_column", {
    p_board: scope.board_id,
    p_version: scope.version,
    p_id: id,
    p_name: name.trim(),
    p_create: create,
  });
  if (r.error) taskFailure(r.error);
  return r.data;
}
export async function pipelineColumnCount(scope: BusinessContext, id: string) {
  const r = await supabase.rpc("business_pipeline_column_count", {
    p_board: scope.board_id,
    p_id: id,
  });
  if (r.error) taskFailure(r.error);
  return r.data!;
}
export async function removePipelineColumn(
  scope: BusinessContext,
  id: string,
  destination: string,
  request: string,
) {
  const r = await supabase.rpc("business_pipeline_remove_column", {
    p_board: scope.board_id,
    p_version: scope.version,
    p_id: id,
    p_destination: destination,
    p_request: request,
  });
  if (r.error) taskFailure(r.error);
  return r.data as { count: number; undoable: boolean };
}
export async function restorePipelineColumn(
  scope: BusinessContext,
  request: string,
) {
  const r = await supabase.rpc("business_pipeline_restore_column", {
    p_board: scope.board_id,
    p_version: scope.version,
    p_request: request,
  });
  if (r.error) taskFailure(r.error);
  return r.data!;
}
export type LeadValues = {
  title: string;
  description: string;
  company_id: string;
  contact_id: string;
  value: number;
  stage_id: string;
  expected_close_date: string;
  status: LeadRow["status"];
  visibility: string;
};
export const emptyLead = (stage = ""): LeadValues => ({
  title: "",
  description: "",
  company_id: "",
  contact_id: "",
  value: 0,
  stage_id: stage,
  expected_close_date: "",
  status: "new",
  visibility: "personal",
});
export async function page<T>(
  read: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const all: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await read(offset);
    if (r.error) taskFailure(r.error);
    all.push(...(r.data ?? []));
    if ((r.data?.length ?? 0) < 500) return all;
  }
}
export async function pipelineData(
  scope: BusinessContext,
  signal?: AbortSignal,
) {
  const [stages, leads, permissions] = await Promise.all([
    page((o) =>
      supabase
        .from("stages")
        .select("*")
        .eq("workspace_id", scope.workspace_id)
        .eq("pipeline_id", scope.pipeline_id!)
        .order("position")
        .order("id")
        .range(o, o + 499)
        .abortSignal(signal),
    ),
    page((o) =>
      supabase
        .from("leads")
        .select("*")
        .eq("workspace_id", scope.workspace_id)
        .eq("sector_id", scope.sector_id)
        .eq("pipeline_id", scope.pipeline_id!)
        .order("position")
        .order("created_at", { ascending: false })
        .order("id")
        .range(o, o + 499)
        .abortSignal(signal),
    ),
    supabase
      .rpc("business_lead_permissions", { p_board: scope.board_id })
      .abortSignal(signal),
  ]);
  if (permissions.error) taskFailure(permissions.error);
  const editable = new Map(permissions.data?.map((p) => [p.id, p.can_edit]));
  // Read only IDs related to this authorized board. Every query still runs under RLS.
  const contacts = await related(leads.map(l => l.contact_id), ids =>
    page(o => supabase.from("contacts").select("id,full_name,company_id,email,phone")
      .eq("workspace_id", scope.workspace_id).eq("sector_id", scope.sector_id)
      .in("id", ids).order("id").range(o, o + 499).abortSignal(signal)));
  const [companies, profiles, tasks] = await Promise.all([
    related([...leads.map(l => l.company_id), ...contacts.map(c => c.company_id)], ids =>
      page(o => supabase.from("companies").select("id,name,email,phone")
        .eq("workspace_id", scope.workspace_id).eq("sector_id", scope.sector_id)
        .in("id", ids).order("id").range(o, o + 499).abortSignal(signal))),
    related(leads.map(l => l.assigned_to), ids =>
      page(o => supabase.from("profiles").select("id,full_name,avatar_url")
        .in("id", ids).order("id").range(o, o + 499).abortSignal(signal))),
    related(leads.map(l => l.id), ids =>
      page(o => supabase.from("tasks").select("id,lead_id")
        .eq("workspace_id", scope.workspace_id).eq("sector_id", scope.sector_id)
        .in("lead_id", ids).order("id").range(o, o + 499).abortSignal(signal))),
  ]);
  const contactMap = new Map(contacts.map(c => [c.id, c]));
  const companyMap = new Map(companies.map(c => [c.id, c]));
  const profileMap = new Map(profiles.map(p => [p.id, p]));
  const counts = new Map<string, number>();
  for (const task of tasks) if (task.lead_id) counts.set(task.lead_id, (counts.get(task.lead_id) ?? 0) + 1);
  return {
    stages,
    leads: leads.map((l): LeadRow => {
      const contact = contactMap.get(l.contact_id ?? "");
      return { ...l, can_edit: editable.get(l.id) === true, contact,
        company: companyMap.get(l.company_id ?? contact?.company_id ?? ""),
        assignee: profileMap.get(l.assigned_to ?? ""), task_count: counts.get(l.id) ?? 0 };
    }),
  };
}
async function related<T>(values: (string | null | undefined)[], read: (ids: string[]) => Promise<T[]>) {
  const ids = [...new Set(values.filter((id): id is string => Boolean(id)))];
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) rows.push(...await read(ids.slice(offset, offset + 100)));
  return rows;
}

export async function pipelineRecord(id: string, signal?: AbortSignal) {
  // Resolve the actual record before selecting a board, including a fresh direct URL.
  const record = await supabase.from("leads").select("*").eq("id", id).abortSignal(signal).maybeSingle();
  if (record.error) taskFailure(record.error);
  if (!record.data) return null;
  const lead = record.data;
  const [permission, contact, assignee] = await Promise.all([
    supabase.rpc("business_can_lead", { p_lead: lead.id, p_write: true }).abortSignal(signal),
    lead.contact_id ? supabase.from("contacts").select("*").eq("id", lead.contact_id)
      .eq("workspace_id", lead.workspace_id).eq("sector_id", lead.sector_id!)
      .abortSignal(signal).maybeSingle() : Promise.resolve({ data: null, error: null }),
    lead.assigned_to ? supabase.from("profiles").select("id,full_name,avatar_url").eq("id",lead.assigned_to).abortSignal(signal).maybeSingle() : Promise.resolve({data:null,error:null}),
  ]);
  if (permission.error) taskFailure(permission.error);
  if (contact.error) taskFailure(contact.error);
  if (assignee.error) taskFailure(assignee.error);
  return { lead: { ...lead, assignee:assignee.data??undefined, can_edit: permission.data === true } as LeadRow,
    contact: contact.data, companyId: lead.company_id ?? contact.data?.company_id ?? null };
}
export async function pipelineCatalog(
  scope: BusinessContext,
  signal?: AbortSignal,
) {
  const [companies, contacts] = await Promise.all([
    page((o) =>
      supabase
        .from("companies")
        .select("id,name")
        .eq("workspace_id", scope.workspace_id)
        .eq("sector_id", scope.sector_id)
        .order("name")
        .order("id")
        .range(o, o + 499)
        .abortSignal(signal),
    ),
    page((o) =>
      supabase
        .from("contacts")
        .select("id,full_name,company_id")
        .eq("workspace_id", scope.workspace_id)
        .eq("sector_id", scope.sector_id)
        .order("full_name")
        .order("id")
        .range(o, o + 499)
        .abortSignal(signal),
    ),
  ]);
  return { companies, contacts };
}
export async function saveLead(
  scope: BusinessContext,
  v: LeadValues,
  userId: string,
  previous?: LeadRow,
  creationId?: string,
) {
  if (!v.title.trim() || v.title.trim().length > 240) throw new Error("Informe um título de até 240 caracteres.");
  if (!Number.isFinite(v.value) || v.value < 0) throw new Error("Informe um valor válido.");
  const payload = {
    title: v.title.trim(),
    description: v.description.trim() || null,
    company_id: v.company_id || null,
    contact_id: v.contact_id || null,
    value: v.value,
    stage_id: v.stage_id,
    expected_close_date: v.expected_close_date || null,
    status: v.status,
  };
  const query = previous
    ? supabase
        .from("leads")
        .update(payload)
        .eq("workspace_id", scope.workspace_id)
        .eq("sector_id", scope.sector_id)
        .eq("pipeline_id", scope.pipeline_id!)
        .eq("id", previous.id)
        .eq("updated_at", previous.updated_at)
    : supabase.from("leads").insert({
        ...payload,
        ...(creationId ? { id: creationId } : {}),
        workspace_id: scope.workspace_id,
        sector_id: scope.sector_id,
        pipeline_id: scope.pipeline_id!,
        created_by: userId,
        visibility: v.visibility,
      });
  const r = await query.select("*").single();
  if (!previous && creationId && r.error?.code === "23505") {
    const existing = await supabase.from("leads").select("*").eq("id", creationId)
      .eq("workspace_id", scope.workspace_id).eq("sector_id", scope.sector_id).eq("pipeline_id", scope.pipeline_id!).single();
    if (!existing.error && existing.data && existing.data.created_by === userId) return existing.data;
  }
  if (r.error) taskFailure(r.error);
  return r.data;
}
export async function moveLead(
  scope: BusinessContext,
  lead: LeadRow,
  stage: string,
  position?: number,
) {
  const r = await supabase
    .from("leads")
    .update({
      stage_id: stage,
      ...(position === undefined ? {} : { position }),
    })
    .eq("workspace_id", scope.workspace_id)
    .eq("pipeline_id", scope.pipeline_id!)
    .eq("id", lead.id)
    .eq("updated_at", lead.updated_at)
    .select("id")
    .single();
  if (r.error) taskFailure(r.error);
}
export async function deleteLead(scope: BusinessContext, lead: LeadRow) {
  const r = await supabase
    .from("leads")
    .delete()
    .eq("workspace_id", scope.workspace_id)
    .eq("pipeline_id", scope.pipeline_id!)
    .eq("id", lead.id)
    .eq("updated_at", lead.updated_at)
    .select("id")
    .single();
  if (r.error) taskFailure(r.error);
}
