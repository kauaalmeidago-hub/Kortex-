import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, Page } from "playwright";
import type { AutomationConfig } from "../config.js";
import { AutomationError } from "../errors.js";
import type { KoaBrowserProfileManager } from "./KoaBrowserProfileManager.js";

const mocks = vi.hoisted(() => ({ open: vi.fn(), login: vi.fn(), rejected: vi.fn(), constructor: vi.fn() }));
vi.mock("../workflows/hapvida/pageObjects/HapvidaLoginPage.js", () => ({ HapvidaLoginPage: class {
  constructor(...args: unknown[]) { mocks.constructor(...args); }
  open = mocks.open; login = mocks.login;
  invalidIdentificationMessage() { return { isVisible: mocks.rejected }; }
} }));
import { refreshPortalSessionWithCredential, validateSavedPortalSession } from "./PortalSessionCheck.js";

const url = "https://sigo.sh.srv.br/card";
const config = { actionTimeoutMs: 1000, navigationTimeoutMs: 1000, authTimeoutMs: 1000 } as AutomationConfig;
function fixture() {
  const page = { goto: vi.fn(async () => undefined), url: () => url } as unknown as Page;
  const context = { newPage: vi.fn(async () => page), setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(), close: vi.fn(async () => undefined) };
  const browser = { newContext: vi.fn(async () => context) };
  const manager = { readStorageState: vi.fn(async () => ({ cookies: [], origins: [] })),
    validatePortalSession: vi.fn(async () => true), saveSession: vi.fn(async () => undefined), markSessionValidated: vi.fn(async () => undefined) };
  const check = () => validateSavedPortalSession(config, browser as unknown as Browser, manager as unknown as KoaBrowserProfileManager, "ndi", url);
  const refresh = () => refreshPortalSessionWithCredential(config, browser as unknown as Browser, manager as unknown as KoaBrowserProfileManager,
    "ndi", url, { username: "0TEST", password: "synthetic-password" });
  return { page, context, browser, manager, check, refresh };
}

beforeEach(() => { vi.clearAllMocks(); mocks.open.mockResolvedValue(undefined); mocks.login.mockResolvedValue(undefined); mocks.rejected.mockResolvedValue(false); });
describe("operator-scoped browser session checks", () => {
  it("loads, validates and saves only the NDI session", async () => {
    const f = fixture(); expect(await f.check()).toBe(true);
    expect(f.manager.readStorageState).toHaveBeenCalledWith("ndi");
    expect(f.manager.validatePortalSession).toHaveBeenCalledWith("ndi", f.page);
    expect(f.manager.saveSession).toHaveBeenCalledWith(f.context, "ndi");
    expect(f.manager.markSessionValidated).toHaveBeenCalledWith("ndi");
    expect(f.context.close).toHaveBeenCalledOnce();
  });
  it("does not borrow Hapvida state when no NDI session exists", async () => {
    const f = fixture(); f.manager.readStorageState.mockResolvedValue(undefined as never);
    expect(await f.check()).toBe(false);
    expect(f.manager.readStorageState).toHaveBeenCalledExactlyOnceWith("ndi");
    expect(f.browser.newContext).not.toHaveBeenCalled();
  });
  it("rejects a redirect to another operator", async () => {
    const f = fixture(); f.page.url = () => "https://webhap.hapvida.com.br/period";
    expect(await f.check()).toBe(false);
    expect(f.manager.validatePortalSession).not.toHaveBeenCalled();
    expect(f.manager.saveSession).not.toHaveBeenCalled();
  });
  it("reports a portal outage without saving an unvalidated session", async () => {
    const f = fixture(); vi.mocked(f.page.goto).mockRejectedValue(new Error("network timeout"));
    await expect(f.check()).rejects.toMatchObject({ code: "PORTAL_AUTH_UNAVAILABLE" });
    expect(f.manager.saveSession).not.toHaveBeenCalled(); expect(f.context.close).toHaveBeenCalledOnce();
  });
  it("refreshes NDI with its own label and saves only after validated login", async () => {
    const f = fixture(); expect(await f.refresh()).toBe(true);
    expect(mocks.constructor).toHaveBeenCalledWith(f.page, url, 1000, "NDI");
    expect(mocks.login).toHaveBeenCalledWith({ username: "0TEST", password: "synthetic-password" });
    expect(f.manager.saveSession).toHaveBeenCalledWith(f.context, "ndi");
    expect(f.manager.markSessionValidated).toHaveBeenCalledWith("ndi");
    expect(f.context.close).toHaveBeenCalledOnce();
  });
  it("recognizes an actual credential rejection and leaves the session unsaved", async () => {
    const f = fixture(); f.manager.validatePortalSession.mockResolvedValue(false); mocks.rejected.mockResolvedValue(true);
    await expect(f.refresh()).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    expect(f.manager.saveSession).not.toHaveBeenCalled(); expect(f.manager.markSessionValidated).not.toHaveBeenCalled();
  });
  it("does not classify an unconfirmed login as a rejected password", async () => {
    const f = fixture(); f.manager.validatePortalSession.mockResolvedValue(false);
    await expect(f.refresh()).rejects.toMatchObject({ code: "PORTAL_AUTH_UNAVAILABLE", retryable: true });
    expect(f.manager.saveSession).not.toHaveBeenCalled();
  });
  it("stops when the login reports required human verification", async () => {
    const f = fixture(); mocks.login.mockRejectedValue(new AutomationError("HUMAN_VERIFICATION_REQUIRED", "Verificacao necessaria."));
    await expect(f.refresh()).rejects.toMatchObject({ code: "HUMAN_VERIFICATION_REQUIRED" });
    expect(f.manager.saveSession).not.toHaveBeenCalled(); expect(f.context.close).toHaveBeenCalledOnce();
  });
});
