import { describe, expect, it, vi } from "vitest";
import type { SecretProvider } from "./SecretProvider.js";
import { EphemeralCredentialStore, OperationScopedSecretProvider } from "./EphemeralCredentialStore.js";

describe("EphemeralCredentialStore", () => {
  it("consumes operation-scoped credentials before falling back to the persistent provider", async () => {
    const store = new EphemeralCredentialStore();
    const fallback: SecretProvider = {
      get: async () => ({ username: "fallback", password: "fallback-secret" }),
    };

    store.put("operation-1", "hapvida:company-1", { username: "0ABC", password: "sample-secret" }, 60_000);

    const provider = new OperationScopedSecretProvider("operation-1", store, fallback);
    await expect(provider.get("hapvida:company-1")).resolves.toEqual({
      username: "0ABC",
      password: "sample-secret",
      metadata: undefined,
    });
    await expect(provider.get("hapvida:company-1")).resolves.toEqual({
      username: "fallback",
      password: "fallback-secret",
    });
  });

  it("expires and clears operation-scoped credentials", async () => {
    vi.useFakeTimers();
    try {
      const store = new EphemeralCredentialStore();
      const fallback: SecretProvider = {
        get: async () => ({ username: "fallback", password: "fallback-secret" }),
      };

      store.put("operation-1", "hapvida:company-1", { username: "0ABC", password: "sample-secret" }, 1_000);
      vi.advanceTimersByTime(1_001);

      const provider = new OperationScopedSecretProvider("operation-1", store, fallback);
      await expect(provider.get("hapvida:company-1")).resolves.toEqual({
        username: "fallback",
        password: "fallback-secret",
      });

      store.put("operation-1", "hapvida:company-1", { username: "0ABC", password: "sample-secret" }, 60_000);
      store.clear("operation-1");

      await expect(provider.get("hapvida:company-1")).resolves.toEqual({
        username: "fallback",
        password: "fallback-secret",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
