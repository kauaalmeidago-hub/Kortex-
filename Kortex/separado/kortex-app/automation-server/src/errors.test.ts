import { describe, expect, it } from "vitest";
import { createReauthRequiredError } from "./errors.js";

describe("automation errors", () => {
  it("creates a retryable REAUTH_REQUIRED error for expired portal sessions", () => {
    const error = createReauthRequiredError("Abra o onboarding do perfil Koa.");

    expect(error.code).toBe("REAUTH_REQUIRED");
    expect(error.retryable).toBe(true);
    expect(error.safeDetails).toBe("Abra o onboarding do perfil Koa.");
  });
});
