import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { OperationRecord } from "../types.js";
import { PostgresOperationRepository, SET_OPERATION_STATUS_SQL, UPDATE_OPERATION_SQL } from "./PostgresOperationRepository.js";

describe("PostgresOperationRepository SQL", () => {
  it("survives an idle pool disconnect without exposing the database exception", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const repository = new PostgresOperationRepository("postgres://synthetic-user:synthetic-secret@localhost/test");
    try {
      const pool = (repository as unknown as { pool: pg.Pool }).pool;
      expect(() => pool.emit("error", new Error("connection lost: synthetic-secret"))).not.toThrow();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("synthetic-secret");
    } finally { await repository.close(); warn.mockRestore(); }
  });
  it("keeps operation status parameter typed as automation_operation_status", () => {
    for (const sql of [UPDATE_OPERATION_SQL, SET_OPERATION_STATUS_SQL]) {
      expect(sql).not.toContain("$2::text");
      expect(sql).toContain("$2::public.automation_operation_status");
    }
  });

  it("supports authentication resume and terminal status transitions without text casts", () => {
    expect(UPDATE_OPERATION_SQL).toContain("status = $2::public.automation_operation_status");
    expect(UPDATE_OPERATION_SQL).toContain("'queued'::public.automation_operation_status");
    expect(UPDATE_OPERATION_SQL).toContain("'awaiting_authentication'::public.automation_operation_status");

    expect(SET_OPERATION_STATUS_SQL).toContain("status = $2::public.automation_operation_status");
    expect(SET_OPERATION_STATUS_SQL).toContain("'awaiting_authentication'::public.automation_operation_status");
    expect(SET_OPERATION_STATUS_SQL).toContain("'success'::public.automation_operation_status");
    expect(SET_OPERATION_STATUS_SQL).toContain("'cancelled'::public.automation_operation_status");
  });

  it("persists an operator switch with the NDI credential and clears the old credential ID", async () => {
    const repository = new PostgresOperationRepository("postgres://localhost/test");
    const now = new Date().toISOString();
    const current: OperationRecord = { id: "operation-1", type: "CARD_ISSUE", status: "authenticating", companyId: "company-1", portal: "hapvida",
      credentialRef: "hapvida:company-1", credentialId: "hapvida-id", input: {}, artifacts: [], createdAt: now, updatedAt: now };
    const row = { id: current.id, operation_type: current.type, status: current.status, company_id: current.companyId, operator: "ndi", credential_ref: "ndi:company-1", credential_id: null,
      payload: {}, progress_metadata: {}, result: null, error_code: null, error_message: null, created_at: now, updated_at: now };
    vi.spyOn(repository, "get").mockResolvedValue(current);
    const pool = (repository as unknown as { pool: pg.Pool }).pool;
    const query = vi.spyOn(pool, "query").mockResolvedValue({ rows: [row] } as never);
    try {
      const updated = await repository.update(current.id, { portal: "ndi", credentialRef: "ndi:company-1", credentialId: undefined });
      expect(updated).toMatchObject({ portal: "ndi", credentialRef: "ndi:company-1" });
      expect(updated?.credentialId).toBeUndefined();
      expect(query.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["ndi"]));
      expect(query.mock.calls[0]?.[1]?.[9]).toBeNull();
      expect(query.mock.calls[0]?.[1]?.[11]).toBe("ndi");
    } finally { await repository.close(); }
  });
});

