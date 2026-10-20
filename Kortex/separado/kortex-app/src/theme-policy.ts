import { appEnvironment } from "@/features/access/environment";
export type ThemeMode = "light" | "dark";
export const lightPortal = appEnvironment === "production";
export function resolveTheme(
  saved: string | null,
  forced = lightPortal,
): ThemeMode {
  return forced ? "light" : saved === "dark" ? "dark" : "light";
}
export function applyTheme(mode: ThemeMode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.style.colorScheme = mode;
}
