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
});
