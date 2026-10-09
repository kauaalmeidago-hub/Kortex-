import { describe, expect, it } from "vitest";
import type { AutomationConfig } from "../config.js";
import { portalBrowserOptions } from "./portalBrowserOptions.js";

const config = { hapvidaCardPortalUrl: "https://webhap.hapvida.com.br/card", hapvidaPortalUrl: "https://webhap.hapvida.com.br/legacy",
  ndiCardPortalUrl: "https://sigo.sh.srv.br/card" } as AutomationConfig;

describe("browser command portal selection", () => {
  it("keeps Hapvida as the default and uses its card URL", () => {
    expect(portalBrowserOptions(config, [])).toMatchObject({ portal: "hapvida", url: config.hapvidaCardPortalUrl });
  });
  it.each([["--operator=ndi"], ["--operator", "NDI"]])("selects NDI using either argument syntax (%s)", (...args) => {
    expect(portalBrowserOptions(config, args)).toMatchObject({ portal: "ndi", label: "NDI", url: config.ndiCardPortalUrl });
  });
  it("preserves the requested company and the leading zero in its code", () => {
    expect(portalBrowserOptions(config, ["--operator=ndi", "--company-id=company-1", "--company-code", "0NEW"]))
      .toMatchObject({ companyId: "company-1", companyCode: "0NEW" });
  });
  it.each([["--operator=other"], ["--operator="], ["--operator"], ["--operator", "--company-id=test"]])("rejects unsupported or missing operator arguments (%s)", (...args) => {
    expect(() => portalBrowserOptions(config, args)).toThrow();
  });
  it("does not use a Hapvida URL when the NDI URL is missing", () => {
    expect(() => portalBrowserOptions({ ...config, ndiCardPortalUrl: undefined }, ["--operator=ndi"]))
      .toThrow(expect.objectContaining({ code: "PORTAL_URL_NOT_CONFIGURED" }));
  });
});
