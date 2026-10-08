import { describe, expect, it } from "vitest";
import { OperationRepository } from "./OperationRepository.js";
import { EphemeralCredentialStore, OperationScopedSecretProvider } from "../secrets/EphemeralCredentialStore.js";
import type { OperationRecord } from "../types.js";

describe("stored reauthentication handoff", () => {
  it("persists a corrected code and reference before the resumed worker consumes the password", async () => {
    const repository = new OperationRepository(":memory:");
    try {
      const now = new Date().toISOString();
      const operation: OperationRecord = { id: "operation-1", type: "CARD_ISSUE", status: "awaiting_authentication", companyId: "company-1", portal: "hapvida", credentialRef: "hapvida:company-1:login:0OLD", input: { contractCode: "0OLD" }, artifacts: [], createdAt: now, updatedAt: now };
      repository.create(operation);
      const store = new EphemeralCredentialStore();
      store.put(operation.id, "hapvida:company-1:login:0NEW", { username: "0NEW", password: "synthetic-new-password" }, 60000);
      repository.update(operation.id, { status: "queued", credentialRef: "hapvida:company-1:login:0NEW", input: { contractCode: "0NEW" } });
      const resumed = repository.get(operation.id)!;
      expect(resumed.input.contractCode).toBe("0NEW");
      const provider = new OperationScopedSecretProvider(operation.id, store, { get: async () => { throw new Error("Saved access must not replace submitted credentials"); } });
      expect(await provider.get(resumed.credentialRef)).toMatchObject({ username: "0NEW", password: "synthetic-new-password" });
      expect(JSON.stringify({ resumed, events: repository.getEvents(operation.id) })).not.toContain("synthetic-new-password");
    } finally { repository.close(); }
  });
});
