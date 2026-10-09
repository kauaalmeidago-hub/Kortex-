import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { KoaBrowserProfileManager } from "../dist/browser/KoaBrowserProfileManager.js";
import { refreshPortalSessionWithCredential, validateSavedPortalSession } from "../dist/browser/PortalSessionCheck.js";

// Requests are intercepted with synthetic HTML; this never contacts either real portal.
const root = await mkdtemp(path.join(os.tmpdir(), "koa-portal-sessions-"));
const urls = { hapvida: "https://webhap.hapvida.com.br/pls/webhap/pk_carteira_provisoria.login_empresa_form",
  ndi: "https://sigo.sh.srv.br/pls/webmin/pk_carteira_provisoria.login_empresa_form" };
const config = { automationRoot: root, authDir: path.join(root, "auth"), browserProfileDir: path.join(root, "profile"),
  browserStatusPath: path.join(root, "status.json"), profileLockTtlMs: 5000, hapvidaCardPortalUrl: urls.hapvida,
  ndiCardPortalUrl: urls.ndi, actionTimeoutMs: 1500, navigationTimeoutMs: 1500, authTimeoutMs: 250 };
const executablePath = process.env.KOA_TEST_BROWSER_EXECUTABLE;
const browser = await chromium.launch({ headless: true, ...(executablePath
  ? { executablePath } : { channel: process.env.KOA_BROWSER_CHANNEL || "chrome" }) });
const html = body => `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
const login = html(`<form id="cd_form_login_emp" action="/auth" method="post">
  <label for="p_cd_empresa">Empresa</label><input id="p_cd_empresa" name="p_cd_empresa">
  <label for="p_cd_senha">Senha</label><input type="password" id="p_cd_senha" name="p_cd_senha">
  <button id="btn_entrar" type="submit">OK</button></form>`);
const period = html("<h1>Datas de adesão</h1>");
const createContext = browser.newContext.bind(browser);

async function check(name, portal, mode, errorCode) {
  const manager = new KoaBrowserProfileManager({ ...config, browserStatusPath: path.join(root, `${name}-status.json`) });
  const states = new Map(); const read = [], saved = [], submitted = [];
  if (mode === "saved" || mode === "wrong-host") states.set(portal, { cookies: [{ name: "fixture", value: "valid",
    domain: new URL(urls[portal]).hostname, path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] });
  if (mode === "missing-ndi") states.set("hapvida", { cookies: [], origins: [] });
  manager.readStorageState = async target => { read.push(target); return states.get(target); };
  manager.saveSession = async (context, target) => { saved.push(target); states.set(target, await context.storageState()); };
  const routedBrowser = { newContext: async options => {
    const context = await createContext(options);
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (mode === "wrong-host" && url.hostname === "webhap.hapvida.com.br") {
        await route.fulfill({ status: 200, contentType: "text/html", body: period }); return;
      }
      assert.equal(url.hostname, new URL(urls[portal]).hostname);
      let body = login;
      if (url.pathname === "/auth") {
        const values = new URLSearchParams(request.postData());
        assert.equal(values.get("p_cd_empresa"), "0TEST"); assert.equal(values.get("p_cd_senha"), "synthetic-password");
        submitted.push(portal);
        body = mode === "rejected" ? html("<p>Identificacao invalida</p>") : mode === "unconfirmed" ? login : period;
      } else if (mode === "saved") body = period;
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
    });
    if (mode === "wrong-host") {
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage(), goto = page.goto.bind(page);
        page.goto = (_url, options) => goto("https://webhap.hapvida.com.br/period", options);
        return page;
      };
    }
    return context;
  } };
  const action = () => mode === "refresh" || mode === "rejected" || mode === "unconfirmed"
    ? refreshPortalSessionWithCredential(config, routedBrowser, manager, portal, urls[portal], { username: "0TEST", password: "synthetic-password" })
    : validateSavedPortalSession(config, routedBrowser, manager, portal, urls[portal]);
  if (errorCode) {
    await assert.rejects(action, error => error.code === errorCode);
    assert.deepEqual(saved, []);
  } else {
    const valid = await action();
    const expected = mode !== "wrong-host" && mode !== "missing-ndi";
    assert.equal(valid, expected);
    assert.deepEqual(saved, expected ? [portal] : []);
    if (expected) assert.equal((await manager.getStatus())[portal === "ndi" ? "ndiSessionValidated" : "hapvidaSessionValidated"], true);
  }
  if (mode === "missing-ndi") assert.deepEqual(read, ["ndi"]);
  assert(submitted.length <= 1);
  assert.equal(browser.contexts().length, 0);
  console.log(JSON.stringify({ case: name, result: "PASS", portal, saved }));
}

try {
  await check("ndi-saved-session", "ndi", "saved");
  await check("hapvida-saved-session", "hapvida", "saved");
  await check("ndi-secure-login", "ndi", "refresh");
  await check("hapvida-secure-login", "hapvida", "refresh");
  await check("ndi-does-not-borrow-hapvida-session", "ndi", "missing-ndi");
  await check("ndi-other-portal-page-rejected", "ndi", "wrong-host");
  await check("ndi-password-rejected", "ndi", "rejected", "AUTHENTICATION_FAILED");
  await check("ndi-unconfirmed-login", "ndi", "unconfirmed", "PORTAL_AUTH_UNAVAILABLE");
} finally { await browser.close(); await rm(root, { recursive: true, force: true }); }
