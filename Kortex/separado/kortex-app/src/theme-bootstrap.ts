import { applyTheme, resolveTheme } from "./theme-policy";
let saved: string | null = null;
try {
  saved = localStorage.getItem("crm-theme-mode");
} catch {
  /* Optional preference. */
}
applyTheme(resolveTheme(saved));
