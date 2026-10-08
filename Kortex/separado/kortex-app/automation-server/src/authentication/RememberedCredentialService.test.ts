import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationConfig } from "../config.js";
import type { OperationRecord, PortalCredential } from "../types.js";

const mocks = vi.hoisted(() => ({ protect: vi.fn(), query: vi.fn(), end: vi.fn(), pool: vi.fn() }));
vi.mock("../security/DpapiProtector.js", () => ({ protectWithDpapi: mocks.protect }));
vi.mock("pg", () => ({ default: { Pool: class {
  constructor(options: unknown) { mocks.pool(options); }
  query = mocks.query;
  end = mocks.end;
} } }));

import { RememberedCredentialService } from "./RememberedCredentialService.js";

describe("remembering a validated worker credential", () => {
  let dir: string;
  let service: RememberedCredentialService;
  let operation: OperationRecord;
  let credential: PortalCredential;
  let target: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.protect.mockResolvedValue("dpapi-ciphertext");
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.end.mockResolvedValue(undefined);
    dir = await mkdtemp(path.join(os.tmpdir(), "koa-remember-test-"));
    service = new RememberedCredentialService({ secretsDir: dir, databaseUrl: "postgres://test", } as AutomationConfig);
    const now = new Date().toISOString();
    operation = { id: "operation-1", type: "CARD_ISSUE", status: "authenticating", companyId: "company-1",
      workspaceId: "workspace-1", portal: "hapvida", credentialRef: "hapvida:company-1", input: {}, artifacts: [], createdAt: now, updatedAt: now };
    credential = { username: "0ABC1234", password: "synthetic-password", metadata: { rememberOnDevice: true } };
    target = path.join(dir, Buffer.from(operation.credentialRef).toString("base64url") + ".credential.dpapi");
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("does not write or register credentials without explicit remember consent", async () => {
    credential.metadata = { rememberOnDevice: false };
    expect(await service.saveValidatedCredential(operation, credential)).toMatchObject({ rememberedOnDevice: false });
    expect(mocks.protect).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes only DPAPI ciphertext and registers only non-secret metadata", async () => {
    expect(await service.saveValidatedCredential(operation, credential)).toEqual({ rememberedOnDevice: true, metadataRegistered: true });
    expect(mocks.protect).toHaveBeenCalledWith(JSON.stringify({ username: credential.username, password: credential.password }));
    expect(await readFile(target, "utf8")).toBe("dpapi-ciphertext");
    expect(JSON.stringify(mocks.query.mock.calls)).not.toContain(credential.password);
    expect(mocks.query.mock.calls[0]?.[1]).toContain(operation.credentialRef);
    if (process.platform !== "win32") expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it("does not expose the original DPAPI failure or write plaintext", async () => {
    mocks.protect.mockRejectedValue(new Error("password=synthetic-password"));
    const error = await service.saveValidatedCredential(operation, credential).catch((error: Error) => error);
    expect(error).toMatchObject({ code: "CREDENTIAL_SAVE_FAILED", step: "remember_credentials" });
    expect(String(error)).not.toContain(credential.password);
    expect(mocks.query).not.toHaveBeenCalled();
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports metadata failure separately while retaining the usable encrypted local credential", async () => {
    mocks.query.mockRejectedValue(new Error("database unavailable"));
    expect(await service.saveValidatedCredential(operation, credential)).toEqual({ rememberedOnDevice: true, metadataRegistered: false });
    expect(await readFile(target, "utf8")).toBe("dpapi-ciphertext");
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("rejects a movement before writing a card portal credential", async () => {
    operation.type = "INCLUSION_HOLDER";
    await expect(service.saveValidatedCredential(operation, credential)).rejects.toMatchObject({ code: "AUTHENTICATION_NOT_SUPPORTED" });
    expect(mocks.protect).not.toHaveBeenCalled();
  });

  it("stores validated NDI access separately and registers the correct operator", async () => {
    operation.portal = "ndi";
    operation.credentialRef = "ndi:company-1:login:0ABC1234";
    const ndiFile = path.join(dir, Buffer.from(operation.credentialRef).toString("base64url") + ".credential.dpapi");
    expect(await service.saveValidatedCredential(operation, credential)).toEqual({ rememberedOnDevice: true, metadataRegistered: true });
    expect(await readFile(ndiFile, "utf8")).toBe("dpapi-ciphertext");
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([operation.credentialRef, "NDI - company-1", "ndi"]));
    expect(JSON.stringify(mocks.query.mock.calls)).not.toContain(credential.password);
  });
});
