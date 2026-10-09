import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationRecord, PortalCredential } from "../types.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn(), on: vi.fn(), pool: vi.fn(),
  transaction: vi.fn(), release: vi.fn(), fallback: vi.fn() }));
vi.mock("pg", () => ({ default: { Pool: class {
  constructor(options: unknown) { mocks.pool(options); }
  query = mocks.query; connect = mocks.connect; end = mocks.end; on = mocks.on;
} } }));
import { VaultCredentialStore } from "./VaultCredentialStore.js";

const registrationId = "11111111-1111-4111-8111-111111111111";
const vaultId = "22222222-2222-4222-8222-222222222222";
const credential: PortalCredential = { username: "0TEST", password: "fixture-password-only", metadata: { rememberOnDevice: true } };
function operation(): OperationRecord {
  const now = new Date().toISOString();
  return { id: "operation-1", type: "CARD_ISSUE", status: "authenticating", companyId: "company-1", workspaceId: "workspace-1",
    portal: "ndi", credentialRef: "ndi:company-1:login:0TEST", input: {}, artifacts: [], createdAt: now, updatedAt: now };
}
function row(overrides = {}) {
  return { id: registrationId, status: "active", portal_login_code: "0TEST", vault_secret_id: vaultId,
    name: `koa-portal:${registrationId}`, decrypted_secret: JSON.stringify(credential), ...overrides };
}
const store = () => new VaultCredentialStore("postgres://fixture@db.test/postgres", { get: mocks.fallback });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [row()] });
  mocks.connect.mockResolvedValue({ query: mocks.transaction, release: mocks.release });
  mocks.transaction.mockImplementation(async (sql: string) => ({ rows:
    sql.startsWith("SELECT id FROM public.companies") ? [{ id: "company-1" }] :
    sql.includes("INSERT INTO public.automation_credentials") ? [{ id: registrationId }] :
    sql.includes("vault.create_secret") ? [{ id: vaultId }] : [] }));
  mocks.end.mockResolvedValue(undefined);
});

describe("reading protected portal access", () => {
  it("reads the requested reference and strips transient remember flags", async () => {
    const secrets = store();
    expect(await secrets.get(operation().credentialRef)).toEqual({ username: "0TEST", password: credential.password });
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([operation().credentialRef]);
    expect(mocks.fallback).not.toHaveBeenCalled();
    await secrets.close(); expect(mocks.end).toHaveBeenCalledOnce();
  });
  it.each([{ rows: [] }, { rows: [row({ vault_secret_id: null })] }])("uses only the same legacy local reference when it has no vault association", async ({ rows }) => {
    mocks.query.mockResolvedValue({ rows });
    mocks.fallback.mockResolvedValue(credential);
    expect(await store().get(operation().credentialRef)).toEqual(credential);
    expect(mocks.fallback).toHaveBeenCalledWith(operation().credentialRef);
  });
  it("never restores a disabled credential through the local fallback", async () => {
    mocks.query.mockResolvedValue({ rows: [row({ status: "inactive", vault_secret_id: null })] });
    await expect(store().get(operation().credentialRef)).rejects.toMatchObject({ code: "CREDENTIAL_NOT_VALIDATED" });
    expect(mocks.fallback).not.toHaveBeenCalled();
  });
  it.each([
    { name: "koa-portal:another-credential" },
    { portal_login_code: "0OTHER" },
    { decrypted_secret: "malformed fixture-password-only" },
    { decrypted_secret: JSON.stringify({ username: "0TEST", password: "" }) },
  ])("rejects mismatched or damaged vault data without exposing a password", async overrides => {
    mocks.query.mockResolvedValue({ rows: [row(overrides)] });
    const error = await store().get(operation().credentialRef).catch(error => error);
    expect(error).toMatchObject({ code: "INVALID_CREDENTIAL" });
    expect(String(error)).not.toContain(credential.password);
    expect(mocks.fallback).not.toHaveBeenCalled();
  });
  it("reports a database outage separately from absent or incorrect portal credentials", async () => {
    mocks.query.mockRejectedValue(new Error(`database error ${credential.password}`));
    const error = await store().get(operation().credentialRef).catch(error => error);
    expect(error).toMatchObject({ code: "CREDENTIAL_STORE_UNAVAILABLE", retryable: true });
    expect(String(error)).not.toContain(credential.password);
    expect(mocks.fallback).not.toHaveBeenCalled();
  });
  it("rejects missing access when no legacy fallback is configured", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(new VaultCredentialStore("postgres://fixture@db.test/postgres").get("ndi:missing"))
      .rejects.toMatchObject({ code: "CREDENTIAL_NOT_FOUND" });
  });
  it("requires verified TLS for a remote database without discarding the configured CA", () => {
    new VaultCredentialStore("postgres://fixture@db.test/postgres?sslmode=disable&sslrootcert=%2Fcerts%2Froot.crt");
    const url = new URL(mocks.pool.mock.calls[0]![0].connectionString);
    expect(url.searchParams.get("sslmode")).toBe("verify-full");
    expect(url.searchParams.get("sslrootcert")).toBe("/certs/root.crt");
  });
  it("does not impose remote TLS on an isolated loopback test database", () => {
    new VaultCredentialStore("postgres://fixture@127.0.0.1/postgres");
    expect(new URL(mocks.pool.mock.calls[0]![0].connectionString).searchParams.has("sslmode")).toBe(false);
  });
});

describe("retaining validated access in the database", () => {
  it("stores the password only as a bound vault parameter and commits its company/operator association atomically", async () => {
    expect(await store().saveValidated(operation(), credential)).toBe(true);
    const calls = mocks.transaction.mock.calls;
    const publicRegistration = calls.find(([sql]) => sql.includes("INSERT INTO public.automation_credentials"))!;
    expect(publicRegistration[1].slice(0, 4)).toEqual(["workspace-1", "company-1", "ndi", operation().credentialRef]);
    expect(JSON.stringify(publicRegistration)).not.toContain(credential.password);
    expect(JSON.stringify(calls.map(([sql]) => sql))).not.toContain(credential.password);
    const secretWrite = calls.find(([sql]) => sql.includes("vault.create_secret"))!;
    expect(JSON.parse(secretWrite[1][0])).toEqual({ username: "0TEST", password: credential.password });
    expect(secretWrite[1][1]).toBe(`koa-portal:${registrationId}`);
    expect(calls.find(([sql]) => sql.includes("INSERT INTO koa_private"))?.[1]).toEqual([registrationId, vaultId]);
    expect(calls.at(-1)?.[0]).toBe("COMMIT"); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("updates an existing password without creating another secret", async () => {
    const original = mocks.transaction.getMockImplementation()!;
    mocks.transaction.mockImplementation((sql, params) => sql.includes("SELECT vault_secret_id")
      ? Promise.resolve({ rows: [{ vault_secret_id: vaultId }] }) : original(sql, params));
    await store().saveValidated(operation(), { ...credential, password: "replacement-fixture-password" });
    const calls = mocks.transaction.mock.calls;
    expect(calls.some(([sql]) => sql.includes("vault.create_secret"))).toBe(false);
    expect(calls.find(([sql]) => sql.includes("vault.update_secret"))?.[1]).toEqual([
      vaultId, JSON.stringify({ username: "0TEST", password: "replacement-fixture-password" }), `koa-portal:${registrationId}`,
    ]);
    expect(calls.at(-1)?.[0]).toBe("COMMIT");
  });
  it.each(["company", "reference"])("cannot save or reassign access outside its %s scope", async scope => {
    const original = mocks.transaction.getMockImplementation()!;
    mocks.transaction.mockImplementation((sql, params) =>
      (scope === "company" ? sql.startsWith("SELECT id FROM public.companies") : sql.includes("INSERT INTO public.automation_credentials"))
        ? Promise.resolve({ rows: [] }) : original(sql, params));
    await expect(store().saveValidated(operation(), credential)).rejects.toMatchObject({ code: "CREDENTIAL_SCOPE_INVALID" });
    expect(mocks.transaction.mock.calls.some(([sql]) => sql.includes("vault.create_secret"))).toBe(false);
    expect(mocks.transaction.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("rolls back both registration and secret on a vault failure without disclosing the cause", async () => {
    const original = mocks.transaction.getMockImplementation()!;
    mocks.transaction.mockImplementation((sql, params) => sql.includes("vault.create_secret")
      ? Promise.reject(new Error(`SQL failure ${credential.password}`)) : original(sql, params));
    const error = await store().saveValidated(operation(), credential).catch(error => error);
    expect(error).toMatchObject({ code: "CREDENTIAL_DATABASE_SAVE_FAILED" });
    expect(String(error)).not.toContain(credential.password);
    expect(mocks.transaction.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(mocks.transaction.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("requires explicit storage consent before opening a database transaction", async () => {
    await expect(store().saveValidated(operation(), { ...credential, metadata: { rememberOnDevice: false } }))
      .rejects.toMatchObject({ code: "CREDENTIAL_PERSISTENCE_NOT_AUTHORIZED" });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
