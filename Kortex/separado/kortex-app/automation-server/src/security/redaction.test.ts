import { describe, expect, it } from "vitest";
import { containsSensitiveKey, redact, sanitizeDiagnosticText, sanitizeUrl } from "./redaction.js";

describe("redaction", () => {
  it("detects sensitive keys before requests are persisted", () => {
    expect(containsSensitiveKey({ beneficiaryName: "Maria", senha: "secret" })).toBe(true);
    expect(containsSensitiveKey({ beneficiaryName: "Maria", credentialRef: "hapvida:confins" })).toBe(true);
  });

  it("redacts nested secret-like values", () => {
    expect(redact({ a: 1, password: "secret", nested: { token: "abc" } })).toEqual({
      a: 1,
      password: "[REDACTED]",
      nested: { token: "[REDACTED]" },
    });
  });

  it("removes secrets from Playwright diagnostic strings", () => {
    const sanitized = sanitizeDiagnosticText(
      'locator.fill: Timeout. fill("999999") password=mysecret pass=abc pwd=def Authorization=Bearer.abc token=xyz',
    );

    expect(sanitized).toContain('fill("[REDACTED]")');
    expect(sanitized).toContain("password=[REDACTED]");
    expect(sanitized).toContain("pass=[REDACTED]");
    expect(sanitized).toContain("pwd=[REDACTED]");
    expect(sanitized).toContain("token=[REDACTED]");
    expect(sanitized).not.toContain("999999");
    expect(sanitized).not.toContain("mysecret");
    expect(sanitized).not.toContain("abc");
    expect(sanitized).not.toContain("def");
    expect(sanitized).not.toContain("xyz");
  });

  it("removes query and auth parts from urls", () => {
    expect(sanitizeUrl("https://user:pass@example.com/path?token=abc#hash")).toBe("https://example.com/path");
  });
});
