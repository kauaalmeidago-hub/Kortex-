import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("pg", () => ({ default: { Pool: class { query = mock.query; on() { return this; } async end() {} } } }));
import { PostgresCredentialResolver } from "./PostgresCredentialResolver.js";

describe("credentials for a requested portal code", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.query.mockResolvedValue({ rows: [] }); });
  it("looks up the requested code and allocates a distinct reference for a new access", async () => {
    const resolver = new PostgresCredentialResolver("postgres://test");
    const first = await resolver.resolve({ companyId: "company-1", operator: "hapvida", portalLoginCode: "0FIRST" });
    const second = await resolver.resolve({ companyId: "company-1", operator: "hapvida", portalLoginCode: "0NEW" });
    expect(mock.query.mock.calls[1]?.[1]).toEqual(["company-1", "hapvida", "0NEW"]);
    expect(mock.query.mock.calls[1]?.[0]).toContain("metadata->>'portalLoginCode' = $3::text");
    expect(first.credentialRef).not.toBe(second.credentialRef);
    expect(second.credentialRef).toBe("hapvida:company-1:login:0NEW");
  });
  it("reuses the verified credential for the requested code", async () => {
    mock.query.mockResolvedValue({ rows: [{ id: "credential-new", credential_ref: "hapvida:company-1:login:0NEW" }] });
    expect(await new PostgresCredentialResolver("postgres://test").resolve({ companyId: "company-1", operator: "hapvida", portalLoginCode: "0NEW" }))
      .toEqual({ credentialId: "credential-new", credentialRef: "hapvida:company-1:login:0NEW" });
  });
  it("prefers only an active verified portal for the exact company and code, without reading a password", async () => {
    mock.query.mockResolvedValue({ rows: [{ operator: "ndi" }] });
    const resolver = new PostgresCredentialResolver("postgres://test");
    expect(await resolver.preferredCardPortal({ companyId: "company-2", portalLoginCode: " 0NDI " })).toBe("ndi");
    const [sql, parameters] = mock.query.mock.calls[0]!;
    expect(parameters).toEqual(["company-2", "0NDI"]);
    expect(sql).toContain("status = 'active'"); expect(sql).toContain("last_verified_at IS NOT NULL");
    expect(sql).toContain("metadata->>'portalLoginCode' = $2");
    expect(sql).not.toMatch(/password|decrypted|vault\./i);
  });
  it("keeps the default portal for a new code or an unsupported returned operator", async () => {
    const resolver = new PostgresCredentialResolver("postgres://test");
    expect(await resolver.preferredCardPortal({ companyId: "company-1", portalLoginCode: "0NEW" })).toBeUndefined();
    mock.query.mockResolvedValue({ rows: [{ operator: "other" }] });
    expect(await resolver.preferredCardPortal({ companyId: "company-1", portalLoginCode: "0NEW" })).toBeUndefined();
  });
  it("does not use a generic company session to choose a portal for a missing code", async () => {
    expect(await new PostgresCredentialResolver("postgres://test").preferredCardPortal({ companyId: "company-1", portalLoginCode: " " })).toBeUndefined();
    expect(mock.query).not.toHaveBeenCalled();
  });
  it("reports a credential database outage without turning it into a password request", async () => {
    mock.query.mockRejectedValue(new Error("connection failed"));
    await expect(new PostgresCredentialResolver("postgres://test").preferredCardPortal({ companyId: "company-1", portalLoginCode: "0NDI" }))
      .rejects.toMatchObject({ code: "CREDENTIAL_STORE_UNAVAILABLE" });
  });
});
