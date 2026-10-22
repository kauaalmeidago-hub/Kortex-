export type KoaDepartment = "comercial" | "relacionamento" | "financeiro";

// Department is assigned by the backend. User-editable metadata is never a permission source.
export function getKoaDepartment(user: { app_metadata?: Record<string, unknown> }): KoaDepartment | null {
  const value = user.app_metadata?.department ?? user.app_metadata?.setor;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "comercial" || normalized === "relacionamento" || normalized === "financeiro" ? normalized : null;
}
