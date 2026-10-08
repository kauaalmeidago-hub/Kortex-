const SENSITIVE_KEY_PATTERN = /(password|senha|pass|pwd|token|cookie|authorization|secret|credential|access_token|refresh_token)/i;

export function containsSensitiveKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;

  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveKey(item));
  }

  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) return true;
    return containsSensitiveKey(nested);
  });
}

export function redact<T>(value: T): T {
  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item)) as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(nested);
  }
  return output as T;
}

export function sanitizeDiagnosticText(value: string | undefined) {
  if (!value) return value;

  return value
    .replace(/fill\((["'`])(?:\\.|(?!\1)[\s\S])*\1\)/gi, 'fill("[REDACTED]")')
    .replace(
      /\b(password|senha|pass|pwd|token|cookie|authorization|secret|credential|access_token|refresh_token)\b\s*[:=]\s*(["'`][\s\S]*?["'`]|[^\s,;}]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "sb_secret_[REDACTED]");
}

export function sanitizeUrl(rawUrl: string | undefined) {
  if (!rawUrl) return undefined;

  try {
    const parsed = new URL(rawUrl);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl.split("?")[0]?.split("#")[0];
  }
}

export function sanitizeErrorDetails(value: string | undefined) {
  return sanitizeDiagnosticText(value);
}
