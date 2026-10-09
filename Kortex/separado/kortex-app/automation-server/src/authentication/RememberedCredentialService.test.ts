import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationConfig } from "../config.js";
import type { OperationRecord, PortalCredential } from "../types.js";
import { AutomationError } from "../errors.js";

const mocks = vi.hoisted(() => ({ protect: vi.fn(), save: vi.fn(), close: vi.fn() }));
vi.mock("../security/DpapiProtector.js", () => ({ protectWithDpapi: mocks.protect }));
vi.mock("../secrets/VaultCredentialStore.js", () => ({ VaultCredentialStore: class {
  saveValidated = mocks.save;
  close = mocks.close;
} }));

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
    mocks.save.mockResolvedValue(true);
    mocks.close.mockResolvedValue(undefined);
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
    expect(mocks.save).not.toHaveBeenCalled();
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes only local ciphertext and delegates the validated access to the database vault", async () => {
    expect(await service.saveValidatedCredential(operation, credential)).toEqual({ rememberedOnDevice: true, metadataRegistered: true, storedInDatabase: true });
    expect(mocks.protect).toHaveBeenCalledWith(JSON.stringify({ username: credential.username, password: credential.password }));
    expect(await readFile(target, "utf8")).toBe("dpapi-ciphertext");
    expect(mocks.save).toHaveBeenCalledWith(operation, credential);
    expect(mocks.close).toHaveBeenCalledOnce();
    if (process.platform !== "win32") expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it("can retain access in the database when DPAPI is unavailable", async () => {
    mocks.protect.mockRejectedValue(new Error("password=synthetic-password"));
    expect(await service.saveValidatedCredential(operation, credential)).toEqual({ rememberedOnDevice: false, metadataRegistered: true, storedInDatabase: true });
    expect(mocks.save).toHaveBeenCalledWith(operation, credential);
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not expose either storage failure or write plaintext when both stores fail", async () => {
    mocks.protect.mockRejectedValue(new Error("password=synthetic-password"));
    mocks.save.mockRejectedValue(new Error("password=synthetic-password"));
    const error = await service.saveValidatedCredential(operation, credential).catch((error: Error) => error);
    expect(error).toMatchObject({ code: "CREDENTIAL_SAVE_FAILED", step: "remember_credentials" });
    expect(String(error)).not.toContain(credential.password);
    expect(mocks.close).toHaveBeenCalledOnce();
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not claim a database save when only the local backup succeeded", async () => {
    mocks.save.mockRejectedValue(new Error("database unavailable"));
    expect(await service.saveValidatedCredential(operation, credential)).toEqual({ rememberedOnDevice: true, metadataRegistered: false, storedInDatabase: false });
    expect(await readFile(target, "utf8")).toBe("dpapi-ciphertext");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("cannot overwrite a local backup after the database detects an ownership mismatch", async () => {
    mocks.save.mockRejectedValue(new AutomationError("CREDENTIAL_SCOPE_INVALID", "Acesso de outro cadastro."));
    await expect(service.saveValidatedCredential(operation, credential)).rejects.toMatchObject({ code: "CREDENTIAL_SCOPE_INVALID" });
    expect(mocks.protect).not.toHaveBeenCalled();
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(mocks.close).toHaveBeenCalledOnce();
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
    expect(await service.saveValidatedCredential(operation, credential)).toEqual({ rememberedOnDevice: true, metadataRegistered: true, storedInDatabase: true });
    expect(await readFile(ndiFile, "utf8")).toBe("dpapi-ciphertext");
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ portal: "ndi", credentialRef: "ndi:company-1:login:0ABC1234" }), credential);
  });
});
