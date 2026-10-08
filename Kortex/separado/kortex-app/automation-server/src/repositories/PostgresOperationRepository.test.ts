import { describe, expect, it } from "vitest";
import { SET_OPERATION_STATUS_SQL, UPDATE_OPERATION_SQL } from "./PostgresOperationRepository.js";

describe("PostgresOperationRepository SQL", () => {
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
