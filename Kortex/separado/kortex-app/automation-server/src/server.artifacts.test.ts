import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationConfig } from "./config.js";
import type { OperationRecord } from "./types.js";
import type { ArtifactStorage } from "./storage/ArtifactStorage.js";
import { OperationEventBus } from "./events/EventBus.js";
import { createServer } from "./server.js";
import { ExplicitCredentialResolver } from "./credentials/CredentialResolver.js";

describe("authenticated card download", () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  const bytes = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF");
  const read = vi.fn();
  const getSignedUrl = vi.fn();
  beforeEach(async () => {
    vi.clearAllMocks(); read.mockResolvedValue(bytes);
    const now = new Date().toISOString();
    const operation: OperationRecord = {
      id: "operation-1", type: "CARD_ISSUE", status: "success", companyId: "company-1", portal: "hapvida", credentialRef: "ref", input: {},
      artifacts: [{ id: "artifact-1", kind: "pdf", fileName: "carteirinha.pdf", mimeType: "application/pdf", path: "operations/workspace/operation-1/carteirinha.pdf", storageProvider: "supabase", createdAt: now }],
      createdAt: now, updatedAt: now,
    };
    app = await createServer({
      config: { apiToken: "test-api", features: {} } as AutomationConfig,
      repository: { create: vi.fn(), get: async () => operation, update: vi.fn(), appendEvent: vi.fn(), getEvents: () => [] },
      queue: {} as never, credentialResolver: new ExplicitCredentialResolver(), eventBus: new OperationEventBus(),
      artifactStorage: { read, getSignedUrl, save: vi.fn(), delete: vi.fn() } as ArtifactStorage,
    });
  });
  afterEach(async () => { await app.close(); });
  const download = () => app.inject({ method: "GET", url: "/api/operations/operation-1/artifacts/carteirinha.pdf", headers: { "x-koa-automation-token": "test-api" } });
  it("returns PDF bytes as an attachment without redirecting credentials to storage", async () => {
    const response = await download();
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(bytes);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''carteirinha.pdf");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.location).toBeUndefined();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
  it("rejects an anonymous download before reading private storage", async () => {
    expect((await app.inject({ method: "GET", url: "/api/operations/operation-1/artifacts/carteirinha.pdf" })).statusCode).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps a transient download error separate and allows another download of the saved PDF", async () => {
    read.mockRejectedValueOnce(new Error("storage unavailable"));
    const failed = await download();
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error).toBe("ARTIFACT_DOWNLOAD_FAILED");
    expect((await download()).rawPayload).toEqual(bytes);
  });
});
