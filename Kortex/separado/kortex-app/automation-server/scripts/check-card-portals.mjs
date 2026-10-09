import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { BrowserManager } from "../dist/browser/BrowserManager.js";
import { KoaBrowserProfileManager } from "../dist/browser/KoaBrowserProfileManager.js";
import { OperationRepository } from "../dist/db/OperationRepository.js";
import { ExplicitCredentialResolver } from "../dist/credentials/CredentialResolver.js";
import { EphemeralCredentialStore, OperationScopedSecretProvider } from "../dist/secrets/EphemeralCredentialStore.js";
import { searchCardPortals } from "../dist/workflows/CardPortalSearch.js";
import { validateCardPdfBytes } from "../dist/workflows/hapvida/downloadValidation.js";

// All requests are intercepted with synthetic HTML. No real portal, passwords or beneficiary data.
const root = await mkdtemp(path.join(os.tmpdir(), "koa-card-portals-"));
const urls = {
  hapvida: "https://webhap.hapvida.com.br/pls/webhap/pk_carteira_provisoria.login_empresa_form",
  ndi: "https://sigo.sh.srv.br/pls/webmin/pk_carteira_provisoria.login_empresa_form",
};
const executablePath = process.env.KOA_TEST_BROWSER_EXECUTABLE;
const browser = await chromium.launch({ headless: true, ...(executablePath
  ? { executablePath } : { channel: process.env.KOA_BROWSER_CHANNEL || "chrome" }) });
const html = body => `<!doctype html><html><head><meta charset="utf-8"><title>Emissao de Carteira Provisoria</title></head><body>${body}</body></html>`;
const login = html(`<form id="cd_form_login_emp" action="/auth" method="post">
  <label for="p_cd_empresa">Empresa</label><input id="p_cd_empresa" name="p_cd_empresa">
  <label for="p_cd_senha">Senha</label><input type="password" id="p_cd_senha" name="p_cd_senha">
  <button type="submit" id="btn_entrar">OK</button></form>`);
const period = html(`<h1>Datas de adesão</h1><form action="/beneficiaries" method="get">
  <label for="start">Data inicial</label><input id="start" name="start">
  <label for="end">Data final</label><input id="end" name="end">
  <button type="submit">OK</button></form>`);
const config = {
  automationRoot: root, authDir: path.join(root, ".auth"), browserProfileDir: path.join(root, "profile"),
  browserStatusPath: path.join(root, "status.json"), profileLockTtlMs: 60000,
  downloadsDir: path.join(root, "downloads"), artifactsDir: path.join(root, "artifacts"),
  allowedAutomationHosts: ["webhap.hapvida.com.br", "sigo.sh.srv.br"],
  hapvidaCardPortalUrl: urls.hapvida, ndiCardPortalUrl: urls.ndi,
  actionTimeoutMs: 3000, navigationTimeoutMs: 3000, authTimeoutMs: 3000,
  features: { cardIssue: true, cardIssueActiveUsersPreflight: false }, traceAuth: false,
};

async function check(name, outcomes, expectedOperator, expectedError, legacy = false, initialPortal = "hapvida", savedOtherPassword) {
  const repository = new OperationRepository(":memory:");
  const now = new Date().toISOString();
  const operation = { id: `fixture-${name}`, type: "CARD_ISSUE", portal: initialPortal, status: "starting", companyId: "synthetic-company",
    credentialRef: `${initialPortal}:synthetic-company:login:0TEST`,
    input: { portalSearch: "auto", contractCode: "0TEST", beneficiaryName: "MARIA DE TESTE", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
    artifacts: [], createdAt: now, updatedAt: now };
  if (legacy) delete operation.input.portalSearch;
  repository.create(operation);
  const store = new EphemeralCredentialStore();
  store.put(operation.id, operation.credentialRef, { username: "0TEST", password: "synthetic-password", metadata: { autoPortalCredential: true } }, 60000);
  const opened = [], savedSessions = [], pdfs = [], credentialsUsed = [];
  const profile = new KoaBrowserProfileManager(config);
  profile.saveSession = async (_context, portal) => { savedSessions.push(portal); };
  const provider = { createContext: async operation => {
    const portal = operation.portal; opened.push(portal);
    const context = await browser.newContext();
    context.setDefaultTimeout(3000); context.setDefaultNavigationTimeout(3000);
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.hostname, new URL(urls[portal]).hostname);
      let markup;
      if (url.pathname === "/auth") {
        const input = new URLSearchParams(request.postData());
        assert.equal(input.get("p_cd_empresa"), "0TEST"); assert.equal(input.get("p_cd_senha"), portal !== initialPortal && savedOtherPassword ? savedOtherPassword : "synthetic-password");
        credentialsUsed.push(portal);
        markup = outcomes[portal] === "rejected" ? html("<p>Identificacao invalida</p>") : period;
      } else if (url.pathname === "/beneficiaries") {
        assert.equal(url.searchParams.get("start"), "01/10/2026");
        assert.equal(url.searchParams.get("end"), "31/10/2026");
        const card = html(`<section><p>${portal === "ndi" ? "NDI" : "Hapvida"}</p><p>Nome: MARIA DE TESTE</p><p>Codigo: 000000</p><p>Plano: TESTE</p></section>`);
        markup = outcomes[portal] === "not_found" ? html("<p>Nenhum beneficiario encontrado</p>")
          : html(`<table><tr><td>MARIA DE TESTE</td><td>${outcomes[portal] === "missing_control" ? "" : '<input type="checkbox">'}</td></tr></table>
            <button id="print">Imprimir selecionados</button><script>
              document.getElementById('print').onclick = () => { const target = window.open('about:blank');
                target.document.write(${JSON.stringify(card)}); target.document.close(); };
            </script>`);
      } else markup = login;
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: markup });
    });
    const page = await context.newPage();
    return { context, page, close: () => context.close() };
  } };
  const workflow = {
    config, repository, browserManager: new BrowserManager(config, provider, profile), credentialResolver: new ExplicitCredentialResolver(),
    secretProvider: new OperationScopedSecretProvider(operation.id, store, { get: async ref => { if (savedOtherPassword && !ref.startsWith(`${initialPortal}:`)) return { username: "0TEST", password: savedOtherPassword }; throw new Error("Synthetic saved access missing"); } }),
    artifactStorage: { save: async input => {
      pdfs.push(input); validateCardPdfBytes(input.bytes); assert(input.bytes.length > 100);
      return { storageProvider: "fixture", storagePath: input.fileName, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.bytes.length, checksum: "fixture-checksum" };
    } },
    updateStatus: async (status, currentStep) => repository.update(operation.id, { status, currentStep }),
    emitEvent: async event => repository.appendEvent({ ...event, createdAt: new Date().toISOString() }),
  };
  try {
    if (expectedError) {
      await assert.rejects(searchCardPortals(operation, new AbortController().signal, workflow), error => error.code === expectedError);
      assert.equal(pdfs.length, 0);
    } else {
      await searchCardPortals(operation, new AbortController().signal, workflow);
      const result = repository.get(operation.id);
      assert.equal(result.status, "success"); assert.equal(result.portal, expectedOperator);
      assert.equal(result.result.operator, expectedOperator); assert.equal(pdfs.length, 1);
      assert.equal(result.input.portalSearch, "auto");
      assert.equal(pdfs[0].metadata.operator, expectedOperator);
      assert(savedSessions.includes(expectedOperator));
    }
    assert.deepEqual(opened, expectedOperator === initialPortal ? [initialPortal] : [initialPortal, initialPortal === "ndi" ? "hapvida" : "ndi"]);
    assert.deepEqual(credentialsUsed, opened);
    assert(!JSON.stringify({ operation: repository.get(operation.id), events: repository.getEvents(operation.id) }).includes("synthetic-password"));
    assert.equal(store.get(operation.id, `${initialPortal}:synthetic-company:login:0TEST`), undefined);
    console.log(JSON.stringify({ case: name, result: "PASS", portals: opened, operator: expectedOperator, pdfs: pdfs.length }));
  } finally { repository.close(); }
}

try {
  await check("hapvida-success", { hapvida: "found", ndi: "found" }, "hapvida");
  await check("hapvida-not-found-ndi-pdf", { hapvida: "not_found", ndi: "found" }, "ndi");
  await check("hapvida-rejected-ndi-pdf", { hapvida: "rejected", ndi: "found" }, "ndi");
  await check("legacy-hapvida-rejected-ndi-pdf", { hapvida: "rejected", ndi: "found" }, "ndi", undefined, true);
  await check("legacy-hapvida-missing-control-ndi-pdf", { hapvida: "missing_control", ndi: "found" }, "ndi", undefined, true);
  await check("both-not-found", { hapvida: "not_found", ndi: "not_found" }, undefined, "BENEFICIARY_NOT_FOUND");
  await check("hapvida-rejected-ndi-with-own-saved-password", { hapvida: "rejected", ndi: "found" }, "ndi", undefined, false, "hapvida", "ndi-synthetic-password");
  await check("ndi-rejected-hapvida-with-own-saved-password", { hapvida: "found", ndi: "rejected" }, "hapvida", undefined, false, "ndi", "hapvida-synthetic-password");
  await check("ndi-rejected-hapvida-authenticated-without-beneficiary", { hapvida: "not_found", ndi: "rejected" }, undefined, "AUTHENTICATION_FAILED", false, "ndi");
  await check("both-accesses-rejected", { hapvida: "rejected", ndi: "rejected" }, undefined, "AUTHENTICATION_FAILED");
} finally { await browser.close(); await rm(root, { recursive: true, force: true }); }
