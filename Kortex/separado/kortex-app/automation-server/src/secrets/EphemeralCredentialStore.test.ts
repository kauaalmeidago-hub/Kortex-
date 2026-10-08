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

describe("ephemeral credential generations", () => {
  it("preserves a fresh submission when a previous execution cleans up", () => {
    const store = new EphemeralCredentialStore();
    store.put("operation-1", "hapvida:company-1", { username: "old", password: "old-password" }, 60_000);
    const previousExecution = store.snapshotGeneration();
    store.put("operation-1", "hapvida:company-1", { username: "new", password: "new-password", metadata: { rememberOnDevice: true } }, 60_000);
    store.clear("operation-1", previousExecution);
    expect(store.get("operation-1", "hapvida:company-1")).toMatchObject({ username: "new", metadata: { rememberOnDevice: true } });
    store.clear("operation-1", store.snapshotGeneration());
    expect(store.get("operation-1", "hapvida:company-1")).toBeUndefined();
  });

  it("prevents an old execution from consuming a password submitted for the resumed execution", async () => {
    const store = new EphemeralCredentialStore();
    const fallback = { get: vi.fn(async () => ({ username: "fallback", password: "fallback-password" })) };
    const oldProvider = new OperationScopedSecretProvider("operation-1", store, fallback);
    store.put("operation-1", "hapvida:company-1", { username: "new", password: "new-password" }, 60_000);
    expect((await oldProvider.get("hapvida:company-1")).username).toBe("fallback");
    const resumedProvider = new OperationScopedSecretProvider("operation-1", store, fallback);
    expect((await resumedProvider.get("hapvida:company-1")).username).toBe("new");
    expect(store.get("operation-1", "hapvida:company-1")).toBeUndefined();
  });
});

