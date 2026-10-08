import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Page, Request, Route } from "playwright";
import type { AutomationConfig } from "../config.js";
import type { OperationRecord } from "../types.js";
import type { BrowserProvider } from "./BrowserProvider.js";
import type { KoaBrowserProfileManager } from "./KoaBrowserProfileManager.js";
import { BrowserManager } from "./BrowserManager.js";

describe("card portal login resource routing", () => {
  it.each([
    ["portal CAPTCHA script", "CARD_ISSUE", "hapvida", "https://www.google.com/recaptcha/api.js", false, false, true],
    ["CAPTCHA iframe", "CARD_ISSUE", "hapvida", "https://www.google.com/recaptcha/api2/anchor", true, true, true],
    ["CAPTCHA frame XHR", "CARD_ISSUE", "hapvida", "https://www.google.com/recaptcha/api2/reload", false, true, true],
    ["top-level CAPTCHA navigation", "CARD_ISSUE", "hapvida", "https://www.google.com/recaptcha/api.js", true, false, false],
    ["Google account", "CARD_ISSUE", "hapvida", "https://accounts.google.com/", false, false, false],
    ["unrelated Google resource", "CARD_ISSUE", "hapvida", "https://www.google.com/search", false, false, false],
    ["NDI CAPTCHA resource", "CARD_ISSUE", "ndi", "https://www.google.com/recaptcha/api.js", false, false, true],
    ["NDI top-level CAPTCHA navigation", "CARD_ISSUE", "ndi", "https://www.google.com/recaptcha/api.js", true, false, false],
    ["other operation", "INCLUSION", "hapvida", "https://www.google.com/recaptcha/api.js", false, false, false],
    ["portal navigation", "CARD_ISSUE", "hapvida", "https://webhap.hapvida.com.br/pls/webhap/login", true, false, true],
  ])("routes %s according to its page and operation", async (_label, type, portal, url, navigation, subframe, allowed) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "koa-route-test-"));
    let handler: ((route: Route) => Promise<void>) | undefined;
    const mainFrame = {};
    const frame = subframe ? {} : mainFrame;
    const page = {
      url: () => portal === "ndi" ? "https://sigo.sh.srv.br/pls/webmin/pk_carteira_provisoria.login_empresa_form" : "https://webhap.hapvida.com.br/pls/webhap/pk_carteira_provisoria.login_empresa_form",
      mainFrame: () => mainFrame, on: vi.fn(),
    };
    Object.assign(frame, { page: () => page });
    const context = { route: async (_pattern: string, callback: typeof handler) => { handler = callback; },
      pages: () => [page], on: vi.fn() };
    const close = vi.fn(async () => undefined);
    const provider = { createContext: async () => ({ context, page, close }) } as unknown as BrowserProvider;
    const config = { downloadsDir: root, allowedAutomationHosts: ["webhap.hapvida.com.br", "sigo.sh.srv.br"] } as AutomationConfig;
    const manager = new BrowserManager(config, provider, {} as KoaBrowserProfileManager);
    const request = { url: () => url, frame: () => frame, isNavigationRequest: () => navigation } as unknown as Request;
    const fallback = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);
    const route = { request: () => request, fallback, abort } as unknown as Route;
    try {
      await manager.withContext({ id: "operation-test", type, portal } as OperationRecord, new AbortController().signal,
        async (_context, _page: Page) => handler!(route));
      expect(fallback).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(abort).toHaveBeenCalledTimes(allowed ? 0 : 1);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
