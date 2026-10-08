import { describe, expect, it } from "vitest";
import { parseKoaDate, validateKoaPeriod } from "./koaDate";

describe("koa date validation", () => {
  it("accepts a strict DD/MM/YYYY date at the start of the year", () => {
    expect(parseKoaDate("01/01/2026")).toMatchObject({
      valid: true,
      value: "01/01/2026",
    });
  });

  it("accepts a strict DD/MM/YYYY date at the end of the year", () => {
    expect(parseKoaDate("31/12/2026")).toMatchObject({
      valid: true,
      value: "31/12/2026",
    });
  });

  it("rejects years with more than four digits", () => {
    expect(parseKoaDate("01/01/20020")).toEqual({
      valid: false,
      reason: "format",
    });
  });

  it("rejects impossible calendar dates", () => {
    expect(parseKoaDate("31/02/2026")).toEqual({
      valid: false,
      reason: "impossible",
    });
  });

  it("rejects periods where the start date is after the end date", () => {
    expect(validateKoaPeriod("31/12/2026", "01/01/2026")).toEqual({
      valid: false,
      reason: "order",
    });
  });
});
