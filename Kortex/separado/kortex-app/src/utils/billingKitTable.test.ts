import { describe, expect, it } from "vitest";
import {
  filterBillingItems,
  paginateBillingItems,
  type BillingFilters,
  type BillingKitItem,
} from "./billingKitTable";

// Unit fixtures only; never used by the page or a production data provider.
const items: BillingKitItem[] = [
  {
    id: "a",
    company: "Clínica de teste",
    operator: "Hapvida",
    competence: "12/2025",
    updatedAt: "31/12/2025",
    status: "pending",
  },
  {
    id: "b",
    company: "Empresa de teste",
    operator: "NDI",
    competence: "01/2026",
    updatedAt: "01/01/2026",
    status: "processing",
  },
  {
    id: "c",
    company: "Clínica de teste",
    operator: "NDI",
    competence: "02/2026",
    updatedAt: "02/01/2026",
    status: "pending",
  },
];
const filters: BillingFilters = {
  operators: ["Hapvida", "NDI"],
  month: "all",
  year: "all",
  status: "all",
};

describe("billing table controls", () => {
  it("searches companies without accents and does not search the operator", () => {
    expect(
      filterBillingItems(items, " clinica ", filters, {
        key: "company",
        direction: "asc",
      }).map((item) => item.id),
    ).toEqual(["a", "c"]);
    expect(
      filterBillingItems(items, "Hapvida", filters, {
        key: "company",
        direction: "asc",
      }),
    ).toEqual([]);
  });
  it("combines all filters without merging company/operator/competence records", () => {
    expect(
      filterBillingItems(
        items,
        "clínica",
        { operators: ["NDI"], month: "02", year: "2026", status: "pending" },
        { key: "updatedAt", direction: "desc" },
      ),
    ).toEqual([items[2]]);
    expect(
      filterBillingItems(
        items,
        "",
        { ...filters, operators: [] },
        { key: "company", direction: "asc" },
      ),
    ).toEqual([]);
  });
  it("orders competences across the year boundary chronologically", () => {
    expect(
      filterBillingItems(items, "", filters, {
        key: "competence",
        direction: "asc",
      }).map((item) => item.id),
    ).toEqual(["a", "b", "c"]);
    expect(
      filterBillingItems(items, "", filters, {
        key: "competence",
        direction: "desc",
      }).map((item) => item.id),
    ).toEqual(["c", "b", "a"]);
  });
  it("orders real dates chronologically without mutating source records", () => {
    expect(
      filterBillingItems(items, "", filters, {
        key: "updatedAt",
        direction: "desc",
      }).map((item) => item.id),
    ).toEqual(["c", "b", "a"]);
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
  it("shows the active page even beyond five pages", () => {
    const result = paginateBillingItems(
      Array.from({ length: 123 }, (_, index) => index),
      7,
      10,
    );
    expect(result.pages).toEqual([5, 6, 7, 8, 9]);
    expect(result).toMatchObject({
      page: 7,
      first: 61,
      last: 70,
      totalPages: 13,
    });
    expect(result.items).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 68, 69]);
  });
  it("clamps pagination after filtering and handles empty results honestly", () => {
    expect(paginateBillingItems(items, 8, 10)).toMatchObject({
      page: 1,
      first: 1,
      last: 3,
      totalPages: 1,
    });
    expect(paginateBillingItems([], 8, 10)).toMatchObject({
      page: 1,
      first: 0,
      last: 0,
      items: [],
      pages: [1],
    });
  });
});
