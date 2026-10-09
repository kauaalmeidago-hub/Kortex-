import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationError } from "../errors.js";

const mocks = vi.hoisted(() => {
  const page = { goto: vi.fn() };
  const context = { pages: () => [page], newPage: vi.fn() };
  return { config: { browserChannel: "chrome", allowedAutomationHosts: ["webhap.hapvida.com.br", "sigo.sh.srv.br"],
    hapvidaCardPortalUrl: "https://webhap.hapvida.com.br/card", ndiCardPortalUrl: "https://sigo.sh.srv.br/card",
    databaseUrl: "postgres://synthetic", secretsDir: "synthetic-secrets" },
    page, context, lock: {}, query: vi.fn(), poolEnd: vi.fn(), resolve: vi.fn(), resolverClose: vi.fn(), getSecret: vi.fn(),
    launch: vi.fn(), browserClose: vi.fn(), savedCheck: vi.fn(), refresh: vi.fn(), question: vi.fn(), readlineClose: vi.fn(),
    manager: { profileDir: "synthetic-profile", invalidateSession: vi.fn(), launchPersistentContext: vi.fn(), writeStatus: vi.fn(),
      validatePortalSession: vi.fn(), saveSession: vi.fn(), markSessionValidated: vi.fn(), releasePersistentContext: vi.fn() } };
});
vi.mock("../config.js", () => ({ loadConfig: () => mocks.config }));
vi.mock("playwright", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("pg", () => ({ default: { Pool: class { query = mocks.query; end = mocks.poolEnd; } } }));
vi.mock("../credentials/PostgresCredentialResolver.js", () => ({ PostgresCredentialResolver: class { resolve = mocks.resolve; close = mocks.resolverClose; } }));
vi.mock("../secrets/DpapiSecretProvider.js", () => ({ DpapiSecretProvider: class { get = mocks.getSecret; } }));
vi.mock("../browser/KoaBrowserProfileManager.js", () => ({ KoaBrowserProfileManager: class { constructor() { return mocks.manager; } } }));
vi.mock("../browser/PortalSessionCheck.js", () => ({ validateSavedPortalSession: mocks.savedCheck, refreshPortalSessionWithCredential: mocks.refresh }));
vi.mock("node:readline/promises", () => ({ createInterface: () => ({ question: mocks.question, close: mocks.readlineClose }) }));
import { runPortalBrowserCheck } from "./koa-browser-check.js";
import { runPortalOnboarding } from "./koa-browser-onboard.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  mocks.launch.mockResolvedValue({ close: mocks.browserClose });
  mocks.browserClose.mockResolvedValue(undefined);
  mocks.savedCheck.mockResolvedValue(false); mocks.refresh.mockResolvedValue(true);
  mocks.query.mockResolvedValue({ rows: [{ company_id: "company-1" }] });
  mocks.resolve.mockResolvedValue({ credentialRef: "ndi:company-1:login:0TEST" });
  mocks.getSecret.mockResolvedValue({ username: "0TEST", password: "synthetic-password" });
  mocks.manager.launchPersistentContext.mockResolvedValue({ context: mocks.context, lock: mocks.lock });
  mocks.manager.validatePortalSession.mockResolvedValue(true); mocks.question.mockResolvedValue("");
  mocks.page.goto.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("NDI browser check command", () => {
  it("accepts a validated NDI session without requesting a password or querying Hapvida credentials", async () => {
    mocks.savedCheck.mockResolvedValue(true);
    await runPortalBrowserCheck(["--operator=ndi"]);
    expect(mocks.savedCheck.mock.calls[0]?.slice(3)).toEqual(["ndi", mocks.config.ndiCardPortalUrl]);
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.getSecret).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith("SESSION_VALID"); expect(mocks.browserClose).toHaveBeenCalledOnce();
  });
  it("returns REAUTH_REQUIRED if no eligible NDI credential exists", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(runPortalBrowserCheck(["--operator=ndi"])).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(["ndi", null]);
    expect(mocks.manager.invalidateSession).toHaveBeenCalledWith("ndi");
    expect(mocks.getSecret).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("resolves an NDI credential and refreshes the NDI URL", async () => {
    await runPortalBrowserCheck(["--operator=ndi"]);
    expect(mocks.resolve).toHaveBeenCalledWith({ companyId: "company-1", operator: "ndi", portalLoginCode: undefined });
    expect(mocks.getSecret).toHaveBeenCalledWith("ndi:company-1:login:0TEST");
    expect(mocks.refresh.mock.calls[0]?.slice(3, 5)).toEqual(["ndi", mocks.config.ndiCardPortalUrl]);
    expect(mocks.resolverClose).toHaveBeenCalledOnce(); expect(mocks.poolEnd).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("synthetic-password");
  });
  it("requires reauthentication when the local NDI credential file is absent", async () => {
    mocks.getSecret.mockRejectedValue(new AutomationError("CREDENTIAL_NOT_FOUND", "Credencial ausente."));
    await expect(runPortalBrowserCheck(["--operator=ndi"])).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("verifies the specifically requested code instead of accepting another saved session", async () => {
    await runPortalBrowserCheck(["--operator=ndi", "--company-code=0TEST"]);
    expect(mocks.savedCheck).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(["ndi", "0TEST"]);
    expect(mocks.resolve).toHaveBeenCalledWith({ companyId: "company-1", operator: "ndi", portalLoginCode: "0TEST" });
  });
  it("requires a company choice when more than one NDI company is eligible", async () => {
    mocks.query.mockResolvedValue({ rows: [{ company_id: "company-1" }, { company_id: "company-2" }] });
    await expect(runPortalBrowserCheck(["--operator=ndi"])).rejects.toMatchObject({ code: "COMPANY_REQUIRED_FOR_SESSION_REFRESH" });
    expect(mocks.getSecret).not.toHaveBeenCalled();
  });
  it("does not submit a saved credential belonging to a different company code", async () => {
    await expect(runPortalBrowserCheck(["--operator=ndi", "--company-id=company-1", "--company-code=0OTHER"]))
      .rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("NDI manual onboarding command", () => {
  it("opens the NDI URL and saves only its validated session", async () => {
    await runPortalOnboarding(["--operator=ndi"]);
    expect(mocks.page.goto).toHaveBeenCalledWith(mocks.config.ndiCardPortalUrl, { waitUntil: "domcontentloaded" });
    expect(mocks.manager.validatePortalSession).toHaveBeenCalledWith("ndi", mocks.page);
    expect(mocks.manager.saveSession).toHaveBeenCalledExactlyOnceWith(mocks.context, "ndi");
    expect(mocks.manager.markSessionValidated).toHaveBeenCalledWith("ndi");
    expect(mocks.manager.releasePersistentContext).toHaveBeenCalledWith(mocks.context, mocks.lock, false, "ndi");
  });
  it("does not save an unvalidated NDI session or overwrite Hapvida state", async () => {
    mocks.manager.validatePortalSession.mockResolvedValue(false);
    await expect(runPortalOnboarding(["--operator=ndi"])).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(mocks.manager.saveSession).not.toHaveBeenCalled();
    expect(mocks.manager.releasePersistentContext).toHaveBeenCalledWith(mocks.context, mocks.lock, false, "ndi");
    expect(mocks.readlineClose).toHaveBeenCalledOnce();
  });
  it("releases the profile without saving after a navigation error", async () => {
    mocks.page.goto.mockRejectedValue(new Error("network timeout"));
    await expect(runPortalOnboarding(["--operator=ndi"])).rejects.toThrow("network timeout");
    expect(mocks.manager.saveSession).not.toHaveBeenCalled();
    expect(mocks.manager.releasePersistentContext).toHaveBeenCalledWith(mocks.context, mocks.lock, false, "ndi");
  });
  it("retains default Hapvida onboarding", async () => {
    await runPortalOnboarding([]);
    expect(mocks.page.goto).toHaveBeenCalledWith(mocks.config.hapvidaCardPortalUrl, { waitUntil: "domcontentloaded" });
    expect(mocks.manager.saveSession).toHaveBeenCalledWith(mocks.context, "hapvida");
  });
  it("rejects an unsupported operator before opening a browser", async () => {
    await expect(runPortalOnboarding(["--operator=other"])).rejects.toMatchObject({ code: "PORTAL_NOT_SUPPORTED" });
    expect(mocks.manager.launchPersistentContext).not.toHaveBeenCalled();
  });
});
