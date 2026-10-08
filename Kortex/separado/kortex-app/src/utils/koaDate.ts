export type KoaDateValidation =
  | { valid: true; value: string; timestamp: number }
  | { valid: false; reason: "format" | "impossible" };

export type KoaPeriodValidation =
  | { valid: true; periodStart: string; periodEnd: string }
  | { valid: false; reason: "start" | "end" | "order" };

const STRICT_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function parseKoaDate(value: string): KoaDateValidation {
  const trimmed = value.trim();
  const match = STRICT_DATE_PATTERN.exec(trimmed);
  if (!match) return { valid: false, reason: "format" };

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12 || day < 1) return { valid: false, reason: "impossible" };

  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDayOfMonth) return { valid: false, reason: "impossible" };

  return {
    valid: true,
    value: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${String(year).padStart(4, "0")}`,
    timestamp: Date.UTC(year, month - 1, day),
  };
}

export function validateKoaPeriod(periodStart: string, periodEnd: string): KoaPeriodValidation {
  const start = parseKoaDate(periodStart);
  if (!start.valid) return { valid: false, reason: "start" };

  const end = parseKoaDate(periodEnd);
  if (!end.valid) return { valid: false, reason: "end" };

  if (start.timestamp > end.timestamp) return { valid: false, reason: "order" };

  return {
    valid: true,
    periodStart: start.value,
    periodEnd: end.value,
  };
}
