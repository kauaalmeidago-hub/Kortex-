import { AutomationError } from "../../errors.js";

export function requireInput(input: Record<string, unknown>, keys: string[]) {
  const missing = keys.filter((key) => {
    const value = input[key];
    return value == null || String(value).trim() === "";
  });

  if (missing.length > 0) {
    throw new AutomationError("MISSING_REQUIRED_DATA", "Dados obrigatorios ausentes.", {
      safeDetails: `Campos ausentes: ${missing.join(", ")}.`,
      retryable: false,
    });
  }
}
