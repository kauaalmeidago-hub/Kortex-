export type AppEnvironment = "development" | "staging" | "production";
export function resolveEnvironment(
  mode: string,
  configured?: string,
): AppEnvironment {
  if (configured === "staging") return "staging";
  if (mode === "development" || mode === "test") return "development";
  return "production";
}
export const appEnvironment = resolveEnvironment(
  import.meta.env.MODE,
  import.meta.env.VITE_APP_ENV,
);
export const fullModules = appEnvironment !== "production";
export const environmentKey = `${appEnvironment}:${import.meta.env.VITE_SUPABASE_URL}`;
