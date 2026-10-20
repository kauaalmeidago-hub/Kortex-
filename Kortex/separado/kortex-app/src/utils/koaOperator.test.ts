import { describe, expect, it } from "vitest";
import { inferCardOperatorFromContractCode } from "./koaOperator";

describe("inferCardOperatorFromContractCode", () => {
  it.each([
    ["EKKRY", "ndi"],
    ["DWPGU", "ndi"],
    ["0FXXD", "ndi"],
    ["0FKC3", "ndi"],
    ["0BMMC", "hapvida"],
    ["0GP26", "hapvida"],
    [" 0ABC ", "hapvida"],
  ] as const)("infers %s as %s", (code, expected) => {
    expect(inferCardOperatorFromContractCode(code)).toBe(expected);
  });

  it("allows configured prefixes to override the default convention", () => {
    expect(inferCardOperatorFromContractCode("HAP01", { hapvidaPrefixes: ["HAP"] })).toBe("hapvida");
    expect(inferCardOperatorFromContractCode("01234", { ndiPrefixes: ["01"] })).toBe("ndi");
  });
});
