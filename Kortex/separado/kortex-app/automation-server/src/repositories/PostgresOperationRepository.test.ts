import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
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
});

