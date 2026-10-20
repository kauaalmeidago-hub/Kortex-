import { describe, expect, it } from "vitest";
import { resolveEnvironment } from "./environment";
describe("environment module boundary", () => {
  it("keeps development and test complete", () => {
    expect(resolveEnvironment("development")).toBe("development");
    expect(resolveEnvironment("test")).toBe("development");
  });
  it("requires explicit staging configuration", () => {
    expect(resolveEnvironment("production", "staging")).toBe("staging");
  });
  it("fails closed to production for unknown or forged development build flags", () => {
    expect(resolveEnvironment("production", "development")).toBe("production");
    expect(resolveEnvironment("production")).toBe("production");
    expect(resolveEnvironment("unknown", "invalid")).toBe("production");
  });
});
