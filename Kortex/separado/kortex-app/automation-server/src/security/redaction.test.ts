import { describe, expect, it } from "vitest";
import { containsSensitiveKey, redact, sanitizeUrl } from "./redaction.js";

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

  it("removes query and auth parts from urls", () => {
    expect(sanitizeUrl("https://user:pass@example.com/path?token=abc#hash")).toBe("https://example.com/path");
  });
});
