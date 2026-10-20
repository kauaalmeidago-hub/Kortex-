import { supabase } from "@/integrations/supabase/client";
import { withRequestDeadline } from "@/features/access/requestDeadline";
import type { PipelineSetupResult } from "@/integrations/supabase/businessTypes";
export type SetupColumn = { id: string; name: string };
export type PipelineSetupDraft = {
  name: string; columns: SetupColumn[]; sectorId: string; visibility: "personal" | "sector";
  requestId: string; attempted: boolean;
};
export const blankColumn = (): SetupColumn => ({ id: crypto.randomUUID(), name: "" });
export const emptyPipelineSetup = (sectorId = ""): PipelineSetupDraft => ({
  name: "", columns: Array.from({ length: 3 }, blankColumn), sectorId, visibility: "personal",
  requestId: crypto.randomUUID(), attempted: false,
});
export function setupValidation(draft: PipelineSetupDraft) {
  return {
    name: !draft.name.trim() ? "Informe o nome da pipeline." : draft.name.trim().length > 100 ? "Use até 100 caracteres." : "",
    sector: !draft.sectorId ? "Selecione um setor autorizado." : "",
    columns: !draft.columns.length ? "Adicione pelo menos uma coluna." : draft.columns.length > 30 ? "O limite é de 30 colunas." : "",
    fields: Object.fromEntries(draft.columns.map(c => [c.id, !c.name.trim() ? "Preencha o nome ou remova esta coluna." : c.name.trim().length > 80 ? "Use até 80 caracteres." : ""])),
  };
}
export function validPipelineSetup(draft: PipelineSetupDraft) {
  const errors = setupValidation(draft);
  return !errors.name && !errors.sector && !errors.columns && !Object.values(errors.fields).some(Boolean);
}
export function reorderSetup(columns: SetupColumn[], id: string, target: string) {
  const from = columns.findIndex(c => c.id === id), to = columns.findIndex(c => c.id === target);
  if (from < 0 || to < 0 || from === to) return columns;
  const next = [...columns]; const [column] = next.splice(from, 1); next.splice(to, 0, column); return next;
}
export class PipelineSetupError extends Error {
  constructor(message: string, public uncertain = false) { super(message); }
}
function setupError(error: { code?: string; message?: string }) {
  if (error.code === "42501") return new PipelineSetupError("Você não tem permissão para criar uma pipeline neste setor.");
  if (["PGRST202", "42P01"].includes(error.code ?? "")) return new PipelineSetupError("A configuração de pipelines aguarda a atualização do serviço.");
  if (error.code === "22023") return new PipelineSetupError("Confira o nome da pipeline e preencha ou remova as colunas vazias.");
  return new PipelineSetupError("Não foi possível confirmar a criação. Tente novamente para recuperar o resultado; seu rascunho foi preservado.", true);
}
export async function pipelineSetupScopes(signal?: AbortSignal) {
  const r = await supabase.rpc("business_pipeline_setup_scopes").abortSignal(signal);
  if (r.error) throw new PipelineSetupError("Não foi possível consultar os setores autorizados. Tente novamente.");
  return r.data ?? [];
}
export async function pipelineSetupStatus(request: string): Promise<PipelineSetupResult | null> {
  const r = await withRequestDeadline(new AbortController().signal, async signal =>
    await supabase.rpc("business_pipeline_setup_status", { p_request: request }).abortSignal(signal));
  if (r.error) throw setupError(r.error);
  return r.data?.[0] ?? null;
}
export async function createPipelineSetup(draft: PipelineSetupDraft): Promise<PipelineSetupResult> {
  if (!validPipelineSetup(draft)) throw new PipelineSetupError("Confira os campos indicados antes de criar a pipeline.");
  // Reconcile a previous uncertain result before issuing the same creation request.
  const previous = await pipelineSetupStatus(draft.requestId);
  if (previous) return previous;
  const r = await withRequestDeadline(new AbortController().signal, async signal => await supabase.rpc("business_create_pipeline_setup", {
    p_sector: draft.sectorId, p_name: draft.name.trim(),
    p_columns: draft.columns.map(c => ({ name: c.name.trim() })),
    p_request: draft.requestId, p_visibility: draft.visibility,
  }).abortSignal(signal));
  if (r.error) {
    try { const recovered = await pipelineSetupStatus(draft.requestId); if (recovered) return recovered; }
    catch { /* Keep the same request ID for a later reconciliation. */ }
    throw setupError(r.error);
  }
  if (!r.data?.[0]) throw new PipelineSetupError("A criação ainda não foi confirmada. Tente recuperar o resultado.", true);
  return r.data[0];
}
