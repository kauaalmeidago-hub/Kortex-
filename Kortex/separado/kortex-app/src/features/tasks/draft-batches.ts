import type { TaskDraft } from "@/integrations/supabase/taskTypes";
import { dateKey, taskValues, validateTask, type TaskCatalog } from "./model";
export function draftIssue(d: TaskDraft, catalog: TaskCatalog) {
  const p = d.payload as Record<string, unknown>;
  const unresolved = Array.isArray(p?.unresolved)
    ? p.unresolved.filter((v) => typeof v === "string")
    : [];
  return unresolved.length
    ? `Revise as pendências: ${unresolved.join(" ")}`
    : validateTask(taskValues(p), catalog, true);
}
export function compactDueDate(value: string) {
  const key = dateKey(value);
  return key
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      }).format(new Date(key + "T12:00:00Z"))
    : "Sem prazo";
}
export function groupDrafts(drafts: TaskDraft[], catalog: TaskCatalog) {
  const groups = new Map<
    string,
    { id: string; name: string; drafts: TaskDraft[] }
  >();
  for (const d of [...drafts].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  )) {
    const v = taskValues(d.payload as never);
    const key = v.sector_id || "pending";
    if (!groups.has(key))
      groups.set(key, {
        id: key,
        name:
          catalog.sectors.find((s) => s.id === v.sector_id)?.name ||
          "Destino a revisar",
        drafts: [],
      });
    groups.get(key)!.drafts.push(d);
  }
  return Array.from(groups.values());
}
export function draftRecipient(d: TaskDraft, catalog: TaskCatalog) {
  const v = taskValues(d.payload as never);
  if (v.assigned_to) {
    const p = catalog.people.find((p) => p.user_id === v.assigned_to);
    return p?.full_name || p?.email || "Responsável indisponível";
  }
  const b = catalog.boards?.find((b) => b.board_id === v.board_id);
  return b?.visibility === "personal" ? "Fila pessoal" : "Fila do setor";
}
