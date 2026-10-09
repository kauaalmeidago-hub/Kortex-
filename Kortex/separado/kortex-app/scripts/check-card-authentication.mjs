import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer as createViteServer } from "vite";
import { createServer } from "../automation-server/dist/server.js";
import { OperationEventBus } from "../automation-server/dist/events/EventBus.js";
import { EphemeralCredentialStore } from "../automation-server/dist/secrets/EphemeralCredentialStore.js";
import { ExplicitCredentialResolver } from "../automation-server/dist/credentials/CredentialResolver.js";

// Real React fields and authenticated HTTP handoff; all data and authentication services are synthetic.
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(path.join(appRoot, "automation-server/package.json"))("playwright");
const { default: react } = await import(createRequire(path.join(appRoot, "package.json")).resolve("@vitejs/plugin-react-swc"));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = typeof input === "string" ? input : input.url ?? input.href;
  if (url?.startsWith("https://supabase.test/auth/v1/user")) return new Response(JSON.stringify({ id: "test-user" }), { headers: { "content-type": "application/json" } });
  return originalFetch(input, options);
};
let operation, events = [], queued = [];
const store = new EphemeralCredentialStore();
const repository = { get: async () => ({ ...operation }), update: async (_id, patch) => Object.assign(operation, patch),
  appendEvent: async event => { events.push(event); return event; }, getEvents: async () => events };
const server = await createServer({ config: { apiToken: "test-local-token", supabaseUrl: "https://supabase.test", supabaseSecretKey: "synthetic-server-key",
  repositoryMode: "sqlite", authMaxAttempts: 3, authChallengeTtlMinutes: 30, features: { cardIssue: true } }, repository,
  eventBus: new OperationEventBus(), queue: { enqueue: id => queued.push(id) }, credentialResolver: new ExplicitCredentialResolver(), ephemeralCredentialStore: store });
await server.listen({ host: "127.0.0.1", port: 0 });
const apiUrl = `http://127.0.0.1:${server.server.address().port}`;
const html = '<html><body><div id="root"></div><script type="module">import React from "react";import {createRoot} from "react-dom/client";import {KoaAuthenticationCard} from "/src/components/KoaAuthenticationCard.tsx";import {getOperation,submitOperationAuthentication} from "/src/services/automationApi.ts";const op=await getOperation("operation-test");createRoot(document.getElementById("root")).render(React.createElement(KoaAuthenticationCard,{defaultCompanyCode:op.companyCode,portal:op.portal,notFoundPortals:op.result?.cardPortalSearch?.notFound,onCancelOperation:()=>{},onReviewRequest:()=>{window.reviewed=true;},onSubmitAuthentication:async(input)=>{const result=await submitOperationAuthentication({...input,operationId:op.operationId});return result.ok?undefined:"Confira o código da empresa.";}}));</script></body></html>';
const vite = await createViteServer({ root: appRoot, configFile: false, plugins: [react(), { name: "card-auth-test", configureServer(dev) {
  dev.middlewares.use(async (req, res, next) => { if (req.url !== "/card-auth-test.html") return next(); res.setHeader("content-type", "text/html"); res.end(await dev.transformIndexHtml(req.url, html)); });
} }], define: { "import.meta.env.VITE_AUTOMATION_PROVIDER": JSON.stringify("local"), "import.meta.env.VITE_AUTOMATION_API_URL": JSON.stringify(apiUrl), "import.meta.env.DEV": "false" },
resolve: { alias: { "@": path.join(appRoot, "src") } }, server: { host: "127.0.0.1", port: 0 } });
await vite.listen();
const uiUrl = `http://127.0.0.1:${vite.httpServer.address().port}/card-auth-test.html`;
const browser = await chromium.launch({ headless: true, ...(process.env.KOA_TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.KOA_TEST_BROWSER_EXECUTABLE } : { channel: "chrome" }) });
try {
  for (const portal of ["ndi", "hapvida"]) for (const correctCode of [false, true]) {
    const now = new Date().toISOString(), label = portal === "ndi" ? "NDI" : "Hapvida";
    operation = { id: "operation-test", type: "CARD_ISSUE", status: "awaiting_authentication", requestedBy: "test-user", companyId: "company-test", portal,
      credentialRef: `${portal}:company-test:login:0TEST`, input: { contractCode: "0TEST", beneficiaryName: "BENEFICIARIO DE DEMONSTRACAO" },
      result: { cardPortalSearch: { notFound: [portal === "ndi" ? "hapvida" : "ndi"] } }, artifacts: [], createdAt: now, updatedAt: now };
    events = []; queued = []; store.clear(operation.id);
    const context = await browser.newContext(), page = await context.newPage();
    await page.route("**/src/integrations/supabase/client.ts*", route => route.fulfill({ contentType: "application/javascript", body: 'export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"synthetic-user-jwt"}}})}};' }));
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(uiUrl);
    await page.getByText("0TEST", { exact: true }).waitFor();
    assert.equal(await page.locator('input[name="koa-portal-company-code"]').count(), 0);
    const password = page.getByLabel(`Senha ${label}`, { exact: true });
    assert(await page.getByText("0TEST", { exact: true }).evaluate((code, passwordId) => !!(code.compareDocumentPosition(document.getElementById(passwordId)) & Node.DOCUMENT_POSITION_FOLLOWING), await password.getAttribute("id")));
    await page.getByRole("button", { name: "Revisar nome e período" }).click(); assert.equal(await page.evaluate(() => window.reviewed), true);
    if (correctCode) {
      await page.getByRole("button", { name: "Alterar código" }).click();
      await page.getByLabel("Código da empresa", { exact: true }).fill(operation.input.beneficiaryName);
      await password.fill("synthetic-password"); await page.getByRole("button", { name: "Entrar e continuar" }).click();
      await page.getByRole("alert").waitFor(); assert.equal(queued.length, 0); assert.equal(operation.input.contractCode, "0TEST");
      await page.getByLabel("Código da empresa", { exact: true }).fill("0NEW");
    }
    await password.fill("synthetic-password");
    const response = page.waitForResponse(value => value.url().endsWith("/reauth") && value.status() === 200);
    await page.getByRole("button", { name: "Entrar e continuar" }).click(); await response;
    assert.equal(operation.input.contractCode, correctCode ? "0NEW" : "0TEST");
    assert.equal(operation.input.beneficiaryName, "BENEFICIARIO DE DEMONSTRACAO"); assert.deepEqual(queued, [operation.id]);
    assert.equal(store.get(operation.id, operation.credentialRef).username, operation.input.contractCode);
    assert(!JSON.stringify({ operation, events }).includes("synthetic-password")); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ case: `${portal}-${correctCode ? "explicit-code-correction" : "request-code-above-password"}`, result: "PASS" }));
    await context.close();
  }
} finally { await browser.close(); await server.close(); await vite.close(); globalThis.fetch = originalFetch; }
