import { describe, expect, it, vi } from "vitest";
import type { Page, Request } from "playwright";
import { HapvidaLoginPage } from "./HapvidaLoginPage.js";

function locator() {
  const result = { first: () => result, or: () => result, fill: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined), count: vi.fn(async () => 1),
    getAttribute: vi.fn(async () => "pk_carteira_provisoria.login_empresa_proc") };
  return result;
}

function fixture() {
  const company = locator(); const password = locator(); const button = locator();
  const form = locator(); const captcha = locator(); const fallback = locator();
  const request = { url: () => "https://webhap.hapvida.com.br/pls/webhap/pk_carteira_provisoria.login_empresa_proc",
    method: () => "POST", isNavigationRequest: () => true } as Request;
  const response = { request: () => request, status: () => 200 };
  const page = {
    url: () => "https://webhap.hapvida.com.br/pls/webhap/pk_carteira_provisoria.login_empresa_form",
    locator: (selector: string) => selector.includes("p_cd_empresa") ? company : selector.includes("p_cd_senha") ? password :
      selector === "#btn_entrar" ? button : selector === "#cd_form_login_emp" ? form : selector === "#pTokenCaptcha" ? captcha : fallback,
    getByLabel: () => fallback, getByPlaceholder: () => fallback, getByRole: () => fallback,
    waitForFunction: vi.fn(async () => true), waitForLoadState: vi.fn(async () => undefined),
    waitForRequest: vi.fn(async (_predicate: (request: Request) => boolean) => request),
    waitForResponse: vi.fn(async () => response),
  };
  const login = new HapvidaLoginPage(page as unknown as Page, page.url(), 100);
  return { login, page, company, password, button, form, captcha, request, response };
}
const credential = { username: "123456", password: "synthetic-password" };

describe("Hapvida card login submission", () => {
  it("waits for the portal's POST and response rather than treating a click as a login", async () => {
    const f = fixture();
    await f.login.login(credential);
    expect(f.company.fill).toHaveBeenCalledWith(credential.username);
    expect(f.password.fill).toHaveBeenCalledWith(credential.password);
    expect(f.page.waitForRequest.mock.invocationCallOrder[0]).toBeLessThan(f.button.click.mock.invocationCallOrder[0]!);
    expect(f.page.waitForResponse.mock.invocationCallOrder[0]).toBeLessThan(f.button.click.mock.invocationCallOrder[0]!);
    expect(f.page.waitForLoadState).toHaveBeenCalledWith("domcontentloaded", { timeout: 100 });
    const predicate = f.page.waitForRequest.mock.calls[0]![0];
    expect(predicate(f.request)).toBe(true);
    expect(predicate({ ...f.request, method: () => "GET" } as Request)).toBe(false);
    expect(predicate({ ...f.request, url: () => "https://other.test/pls/webhap/pk_carteira_provisoria.login_empresa_proc" } as Request)).toBe(false);
  });

  it("does not fill a password if the reCAPTCHA API is unavailable", async () => {
    const f = fixture();
    f.page.waitForFunction.mockRejectedValue(new Error("timeout"));
    await expect(f.login.login(credential)).rejects.toMatchObject({ code: "PORTAL_AUTH_UNAVAILABLE" });
    expect(f.password.fill).not.toHaveBeenCalled();
    expect(f.button.click).not.toHaveBeenCalled();
  });

  it("reports an unsent form as a portal failure without exposing the credential", async () => {
    const f = fixture();
    f.page.waitForRequest.mockResolvedValue(undefined as unknown as Request);
    const error = await f.login.login(credential).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "PORTAL_AUTH_UNAVAILABLE", step: "authenticate", retryable: true });
    expect(JSON.stringify(error)).not.toContain(credential.password);
    expect(f.page.waitForLoadState).not.toHaveBeenCalled();
  });

  it.each([403, 500])("reports HTTP %s as a portal failure", async (status) => {
    const f = fixture();
    f.response.status = () => status;
    await expect(f.login.login(credential)).rejects.toMatchObject({ code: "PORTAL_AUTH_UNAVAILABLE" });
  });

  it("reports a failed response or incomplete navigation as a portal failure", async () => {
    const f = fixture();
    f.page.waitForResponse.mockResolvedValue(undefined as unknown as typeof f.response);
    await expect(f.login.login(credential)).rejects.toMatchObject({ code: "PORTAL_AUTH_UNAVAILABLE" });
    const incomplete = fixture();
    incomplete.page.waitForLoadState.mockRejectedValue(new Error("navigation timeout"));
    await expect(incomplete.login.login(credential)).rejects.toMatchObject({ code: "PORTAL_AUTH_UNAVAILABLE" });
  });
});
