export const profileSectors = [
  { value: "financeiro", label: "Financeiro" },
  { value: "relacionamento", label: "Relacionamento" },
  { value: "comercial", label: "Comercial" },
] as const;
export type ProfileSector = (typeof profileSectors)[number]["value"];
export type AuthMode = "login" | "signup" | "forgot" | "reset" | "callback";
export type AuthFields = {
  name: string;
  sector: string;
  email: string;
  password: string;
  confirmPassword: string;
};
export type AuthErrors = Partial<Record<keyof AuthFields, string>>;

export function isProfileSector(value: unknown): value is ProfileSector {
  return profileSectors.some((sector) => sector.value === value);
}
export function validateAuthFields(
  mode: AuthMode,
  fields: AuthFields,
  minPasswordLength = 6,
): AuthErrors {
  const errors: AuthErrors = {};
  if (mode === "reset") minPasswordLength = Math.max(8, minPasswordLength);
  if (mode === "signup") {
    if (!fields.name.trim()) errors.name = "Informe seu nome.";
    else if (fields.name.trim().length > 160)
      errors.name = "Use até 160 caracteres no nome.";
    if (!isProfileSector(fields.sector)) errors.sector = "Selecione seu setor.";
  }
  if (
    mode !== "reset" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())
  )
    errors.email = "Informe um e-mail válido.";
  if (mode !== "forgot") {
    if (!fields.password) errors.password = "Informe sua senha.";
    else if (mode !== "login" && fields.password.length < minPasswordLength)
      errors.password = `Use pelo menos ${minPasswordLength} caracteres.`;
  }
  if (mode === "signup" || mode === "reset") {
    if (!fields.confirmPassword) errors.confirmPassword = "Confirme sua senha.";
    else if (fields.password !== fields.confirmPassword)
      errors.confirmPassword = "As senhas precisam ser iguais.";
  }
  return errors;
}
export function authMode(
  pathname: string,
  search: string,
  hash: string,
): AuthMode {
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  if (
    /reset-password|nova-senha/.test(pathname) ||
    fragment.get("type") === "recovery"
  )
    return "reset";
  if (/forgot-password|recuperar-senha/.test(pathname)) return "forgot";
  if (/signup|criar-conta/.test(pathname)) return "signup";
  if (
    /callback/.test(pathname) ||
    new URLSearchParams(search).has("code") ||
    fragment.has("access_token") ||
    fragment.has("error_description")
  )
    return "callback";
  return "login";
}
// Only same-origin application paths can survive an OAuth or email round trip.
export function safeAuthDestination(value: unknown, origin: string): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    return "/";
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || /^\/auth(?:\/|$)/.test(url.pathname))
      return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
export function authReturnUrl(
  origin: string,
  path: string,
  destination: string,
) {
  const url = new URL(path, origin);
  url.searchParams.set("next", safeAuthDestination(destination, origin));
  return url.toString();
}
