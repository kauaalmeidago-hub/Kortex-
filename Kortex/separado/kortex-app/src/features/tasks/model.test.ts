import { describe, expect, it } from "vitest";
import {
  canEdit,
  dateKey,
  defaultTaskFilters,
  formatTaskDate,
  overdue,
  personLabel,
  selectTasks,
  taskValues,
  todayKey,
  validateTask,
} from "./model";
import { taskCatalogFixture, taskFixture, taskIds } from "@/test/taskFixtures";
describe("task rules", () => {
  it("preserves calendar dates and Sao Paulo relative-day context", () => {
    expect(dateKey("2026-10-20T15:00:00Z")).toBe("2026-10-20");
    expect(dateKey("2026-10-20")).toBe("2026-10-20");
    expect(dateKey("2026-10-20T00:00:00Z")).toBe("2026-10-19");
    expect(formatTaskDate("2026-10-20")).toMatch(/^20/);
    expect(todayKey(new Date("2026-10-16T01:30:00Z"))).toBe("2026-10-15");
    expect(formatTaskDate(null)).toBe("Sem vencimento");
  });
  it("combines date boundaries with the current stage, priority and search", () => {
    const cat = taskCatalogFixture();
    const values = [
      taskFixture({ id: "today", due_date: "2026-10-16", priority: "high" }),
      taskFixture({
        id: "seventh",
        due_date: "2026-10-23T15:00:00Z",
        priority: "high",
      }),
      taskFixture({ id: "eighth", due_date: "2026-10-24", priority: "high" }),
      taskFixture({
        id: "yesterday",
        due_date: "2026-10-15",
        priority: "high",
      }),
      taskFixture({
        id: "completed",
        due_date: "2026-10-20",
        status: "done",
        priority: "high",
      }),
      taskFixture({
        id: "removed",
        due_date: "2026-10-20",
        deleted_at: "2026-10-16T15:00:00Z",
        priority: "high",
      }),
      taskFixture({
        id: "other-priority",
        due_date: "2026-10-20",
        priority: "low",
      }),
    ];
    const filter = {
      ...defaultTaskFilters,
      query: values[0].title,
      priority: "high",
      stage: values[0].stage_id,
      date: "upcoming",
    };
    expect(
      selectTasks(values, filter, cat, taskIds.user, "2026-10-16")
        .map((t) => t.id)
        .sort(),
    ).toEqual(["seventh", "today"]);
    expect(
      selectTasks(
        values,
        { ...filter, date: "today" },
        cat,
        taskIds.user,
        "2026-10-16",
      ).map((t) => t.id),
    ).toEqual(["today"]);
    expect(
      selectTasks(
        values,
        { ...filter, date: "overdue" },
        cat,
        taskIds.user,
        "2026-10-16",
      ).map((t) => t.id),
    ).toEqual(["yesterday"]);
  });
  it("uses medium and the configured first stage without inventing corporate links", () => {
    expect(taskValues(undefined, "review")).toMatchObject({
      priority: "medium",
      stage_id: "review",
      company_id: "",
      operator: "",
      project: "",
      assigned_to: "",
      operational_code: "",
    });
  });
  it("validates text, date and actual corporate pairs without truncating", () => {
    const cat = taskCatalogFixture();
    const v = taskValues(taskFixture());
    expect(validateTask(v, cat)).toBeNull();
    expect(validateTask({ ...v, title: "" }, cat)).toMatch(/título/);
    expect(validateTask({ ...v, description: "x".repeat(501) }, cat)).toMatch(
      /500/,
    );
    expect(validateTask({ ...v, due_date: "2026-02-30" }, cat)).toMatch(/data/);
    expect(
      validateTask(
        { ...v, company_id: cat.companies[0].id, operator: "Outra" },
        cat,
      ),
    ).toMatch(/operadora/);
    expect(validateTask({ ...v, project: "Inexistente" }, cat)).toMatch(
      /projeto/,
    );
    expect(v.description).toBe(taskFixture().description);
  });
  it("requires an active sector and eligible recipient only for distribution", () => {
    const cat = taskCatalogFixture(),
      v = taskValues(taskFixture());
    expect(validateTask(v, cat)).toBeNull();
    expect(validateTask(v, cat, true)).toMatch(/setor/);
    expect(
      validateTask(
        { ...v, sector_id: taskIds.sector, assigned_to: "" },
        cat,
        true,
      ),
    ).toBeNull();
    expect(
      validateTask(
        { ...v, sector_id: taskIds.sector, assigned_to: taskIds.other },
        cat,
        true,
      ),
    ).toMatch(/responsável/);
  });
  it("never labels completed or canceled tasks overdue", () => {
    expect(overdue(taskFixture({ due_date: "2026-01-01" }), "2026-10-15")).toBe(
      true,
    );
    for (const status of ["done", "canceled"] as const)
      expect(
        overdue(taskFixture({ due_date: "2026-01-01", status }), "2026-10-15"),
      ).toBe(false);
  });
  it("shows people without technical IDs and keeps sector queues read-only", () => {
    const cat = taskCatalogFixture();
    expect(personLabel(taskIds.user, cat.people, taskIds.user)).toBe("Você");
    expect(personLabel(null, cat.people)).toBe("Sem responsável");
    expect(personLabel("unknown-id", cat.people)).not.toContain("unknown");
    expect(
      canEdit(
        taskFixture({
          assigned_to: null,
          sector_id: taskIds.sector,
          created_by: taskIds.admin,
        }),
        taskIds.user,
      ),
    ).toBe(false);
    expect(
      canEdit(taskFixture({ created_by: taskIds.admin }), taskIds.user),
    ).toBe(true);
  });
  it("filters one authorized dataset without hiding received tasks or sector queues", () => {
    const cat = taskCatalogFixture();
    const a = taskFixture({
      company_id: cat.companies[0].id,
      operational_code: "000EMP-A",
      project: "PME",
      operator: "Hapvida",
      stage_id: "review",
      status: "review",
    });
    const b = taskFixture({
      id: "b",
      title: "Outra",
      assigned_to: null,
      sector_id: taskIds.sector,
      created_by: taskIds.admin,
      priority: "high",
    });
    expect(
      selectTasks(
        [a, b],
        { ...defaultTaskFilters, query: "000emp-a" },
        cat,
        taskIds.user,
      ),
    ).toEqual([a]);
    expect(
      selectTasks(
        [a, b],
        {
          ...defaultTaskFilters,
          stage: "review",
          project: "PME",
          operator: "Hapvida",
        },
        cat,
      ),
    ).toEqual([a]);
    expect(
      selectTasks(
        [a, b],
        { ...defaultTaskFilters, sector: taskIds.sector },
        cat,
        taskIds.user,
      ),
    ).toEqual([b]);
    expect(selectTasks([b, a], defaultTaskFilters, cat, taskIds.user)).toEqual([
      a,
      b,
    ]);
    expect(selectTasks([a, b], defaultTaskFilters, cat, taskIds.user)).toEqual([
      a,
      b,
    ]);
  });
});
