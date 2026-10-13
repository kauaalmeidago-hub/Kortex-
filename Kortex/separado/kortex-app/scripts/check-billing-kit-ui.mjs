import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(path.join(appRoot, "automation-server/package.json"))("playwright");
const requireFromApp = createRequire(path.join(appRoot, "package.json"));
const { default: react } = await import(requireFromApp.resolve("@vitejs/plugin-react-swc"));
const artifactDir = process.env.KIT_UI_ARTIFACT_DIR ?? await mkdtemp(path.join(os.tmpdir(), "kortex-kit-ui-"));
await mkdir(artifactDir, { recursive: true });
const html = `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route} from 'react-router-dom';
import AppLayout from '/src/components/AppLayout.tsx';import BillingKitPage from '/src/pages/BillingKitPage.tsx';
import {ThemeProvider} from '/src/contexts/ThemeContext.tsx';import '/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement(ThemeProvider,null,React.createElement(MemoryRouter,{initialEntries:['/kit-faturamento']},React.createElement(Routes,null,React.createElement(Route,{element:React.createElement(AppLayout)},React.createElement(Route,{path:'/kit-faturamento',element:React.createElement(BillingKitPage)}))))));
</script></body></html>`;
const vite = await createViteServer({
  root: appRoot, configFile: false,
  plugins: [react(), { name: "billing-kit-ui-fixture", configureServer(dev) {
    dev.middlewares.use(async (req, res, next) => {
      if (req.url !== "/billing-kit-ui-test.html") return next();
      res.setHeader("content-type", "text/html"); res.end(await dev.transformIndexHtml(req.url, html));
    });
  } }],
  resolve: { alias: { "@": path.join(appRoot, "src") }, dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 0 },
});
await vite.listen();
const uiUrl = `http://127.0.0.1:${vite.httpServer.address().port}/billing-kit-ui-test.html`;
const browser = await chromium.launch({ headless: true, ...(process.env.KOA_TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.KOA_TEST_BROWSER_EXECUTABLE } : { channel: process.env.KOA_BROWSER_CHANNEL ?? "chrome" }) });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true, locale: "pt-BR", reducedMotion: "reduce" });
await context.addInitScript(() => localStorage.setItem("crm-theme-mode", "light"));
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
// Somente dados locais de exemplo. Nenhuma conta, senha ou portal é acessado.
await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(uiUrl).origin ? route.continue() : route.abort());
await page.route("**/src/contexts/AuthContext.tsx*", (route) => route.fulfill({ contentType: "application/javascript", body: "export function useAuth(){return {user:{email:'ui@example.test'},signOut:async()=>{}}}" }));

const insideViewport = async (locator, label) => {
  const bounds = await locator.boundingBox();
  assert.ok(bounds, `${label}: visível`);
  const viewport = page.viewportSize();
  assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, `${label}: dentro da tela ${JSON.stringify({ bounds, viewport })}`);
  return bounds;
};
const assertText = async (locator, expected) => assert.ok((await locator.textContent()).includes(expected), `${expected}: ${await locator.textContent()}`);
const rows = () => page.locator("tbody tr");
try {
  await page.goto(uiUrl);
  await page.getByRole("button", { name: "Novo pedido", exact: true }).waitFor();
  await page.locator("tbody tr").last().waitFor();
  assert.equal(await rows().count(), 10);
  const toolbar = page.getByRole("toolbar");
  for (const control of await toolbar.locator("button,input").all()) assert.equal((await control.boundingBox()).height, 36, "Controles da barra com altura consistente");
  assert.equal(await page.getByRole("searchbox").evaluate((element) => getComputedStyle(element).fontSize), "14px");
  assert.ok(await page.getByRole("searchbox").evaluate((element) => getComputedStyle(element).fontFamily.includes("Inter")));
  await page.getByRole("region", { name: "Kit faturamento", exact: true }).screenshot({ path: path.join(artifactDir, "kit-desktop.png") });
  console.log("TOOLBAR_TYPOGRAPHY_AND_TABLE = OK");

  const filterButton = page.getByRole("button", { name: "Filtros", exact: true });
  await filterButton.click();
  const filters = page.getByRole("dialog", { name: "Filtros do kit faturamento", exact: true });
  await filters.waitFor();
  await filters.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  const filterBounds = await insideViewport(filters, "Filtro");
  const triggerBounds = await filterButton.boundingBox();
  assert.equal(Math.round(filterBounds.width), 380);
  assert.ok(Math.abs(filterBounds.x + filterBounds.width - triggerBounds.x - triggerBounds.width) < 2, "Filtro alinhado ao botão");
  assert.ok(Math.abs(filterBounds.y - triggerBounds.y - triggerBounds.height - 8) < 2, "Filtro abaixo do botão");
  await insideViewport(filters.getByRole("button", { name: "Aplicar filtros", exact: true }), "Rodapé do filtro");
  await filters.screenshot({ path: path.join(artifactDir, "kit-filtros.png") });
  await filters.getByRole("checkbox", { name: "Hapvida", exact: true }).click();
  await filters.getByRole("combobox", { name: "Mês", exact: true }).selectOption("09");
  await filters.getByRole("radio", { name: "Pendentes", exact: true }).click();
  assert.equal(await rows().count(), 10, "Edição do filtro ainda não aplicada");
  await filters.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  await assertText(rows().first(), "Cafeteria Noroeste");
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await filters.getByRole("combobox", { name: "Mês", exact: true }).selectOption("08");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Filtros/ }).click();
  assert.equal(await filters.getByRole("combobox", { name: "Mês", exact: true }).inputValue(), "09", "Esc descarta o rascunho");
  await filters.getByRole("button", { name: "Limpar", exact: true }).click();
  await filters.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 10);
  console.log("ANCHORED_FILTERS_APPLY_CLEAR_AND_ESCAPE = OK");

  const search = page.getByRole("searchbox", { name: "Buscar empresa", exact: true });
  await page.keyboard.press("Control+k"); assert.ok(await search.evaluate((element) => element === document.activeElement));
  await search.fill("clinica"); await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1); await assertText(rows().first(), "Clínica Horizonte");
  await search.fill("empresa inexistente"); await assertText(rows().first(), "Nenhuma empresa"); await assertText(page.locator("section > div > footer"), "Mostrando 0 a 0 de 0");
  await search.fill("");
  await page.getByRole("combobox", { name: "Empresas por página", exact: true }).selectOption("5");
  assert.equal(await rows().count(), 5);
  const firstPage = await rows().allTextContents();
  await page.getByRole("button", { name: "Próxima página", exact: true }).click();
  assert.equal(await rows().count(), 5); assert.notDeepEqual(await rows().allTextContents(), firstPage);
  await assertText(page.locator("section > div > footer"), "Mostrando 6 a 10 de 10");
  await page.getByRole("combobox", { name: "Empresas por página", exact: true }).selectOption("10");
  await page.getByRole("checkbox", { name: "Selecionar RM Books", exact: true }).click();
  assert.equal(await page.getByRole("checkbox", { name: "Selecionar empresas desta página", exact: true }).getAttribute("data-state"), "indeterminate");
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Exportar", exact: true }).click();
  const download = await downloadPromise; const csv = await readFile(await download.path(), "utf8");
  assert.ok(csv.includes("RM Books") && !csv.includes("Cafeteria Noroeste"));
  console.log("SEARCH_PAGINATION_SELECTION_AND_EXPORT = OK");

  for (const viewport of [{ width: 1366, height: 768 }, { width: 1366, height: 645 }, { width: 1024, height: 600 }, { width: 768, height: 620 }, { width: 390, height: 640 }, { width: 320, height: 480 }]) {
    await page.setViewportSize(viewport);
    await insideViewport(page.getByRole("button", { name: "Novo pedido", exact: true }), "Novo pedido");
    await insideViewport(page.locator("section > div > footer"), "Paginação");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Sem estouro horizontal da página");
    await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
    const manual = page.getByRole("dialog", { name: "Novo pedido manual", exact: true });
    const bounds = await insideViewport(manual, "Pedido manual"); assert.ok(bounds.width <= 640);
    await insideViewport(manual.getByRole("button", { name: "Cancelar", exact: true }), "Cancelar");
    await insideViewport(manual.getByRole("button", { name: "Solicitar pedido", exact: true }), "Solicitar pedido");
    if (viewport.width === 1366 && viewport.height === 645) await manual.screenshot({ path: path.join(artifactDir, "kit-pedido-manual.png") });
    if (viewport.width === 390) await manual.screenshot({ path: path.join(artifactDir, "kit-pedido-mobile.png") });
    await page.keyboard.press("Escape"); await manual.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.textContent?.includes("Novo pedido"));
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await insideViewport(filters, "Filtro responsivo");
    await insideViewport(filters.getByRole("button", { name: "Aplicar filtros", exact: true }), "Aplicar filtros responsivo");
    await page.keyboard.press("Escape");
    console.log(`RESPONSIVE_${viewport.width}x${viewport.height} = OK`);
  }

  await page.setViewportSize({ width: 1366, height: 645 });
  await page.getByRole("button", { name: "Solicitar pedido: Cafeteria Noroeste", exact: true }).click();
  const manual = page.getByRole("dialog", { name: "Novo pedido manual", exact: true });
  assert.equal(await manual.getByRole("combobox", { name: "Empresa", exact: true }).inputValue(), "2");
  assert.equal(await manual.getByRole("combobox", { name: "Operadora", exact: true }).inputValue(), "NDI");
  await manual.getByRole("button", { name: "Kit faturamento completo", exact: true }).click();
  assert.equal(await manual.getByRole("button", { name: "Kit faturamento completo", exact: true }).getAttribute("aria-pressed"), "true");
  await manual.getByRole("switch", { name: "Marcar como prioridade", exact: true }).click();
  await manual.getByRole("button", { name: "Solicitar pedido", exact: true }).click();
  await assertText(manual.getByRole("alert"), "ainda não está disponível");
  await insideViewport(manual.getByRole("button", { name: "Solicitar pedido", exact: true }), "Rodapé após aviso");
  await page.keyboard.press("Escape");
  console.log("MANUAL_REQUEST_VALUES_AND_HONEST_STATUS = OK");

  await page.getByRole("button", { name: "Abrir KOA", exact: true }).click();
  await page.getByRole("button", { name: "Iniciar a busca", exact: true }).click();
  const koa = page.getByRole("dialog", { name: "KOA", exact: true });
  await insideViewport(koa, "KOA");
  await koa.getByRole("button", { name: "Kit de faturamento", exact: true }).click();
  assert.equal(await koa.getByRole("button", { name: "Iniciar busca", exact: true }).isDisabled(), true);
  await koa.getByRole("button", { name: /RM Books/ }).click();
  await koa.getByRole("button", { name: "Iniciar busca", exact: true }).click();
  await assertText(koa.getByRole("status"), "ainda não está disponível");
  await insideViewport(koa.getByRole("button", { name: "Iniciar busca", exact: true }), "Rodapé KOA");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Abrir KOA");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
  const darkColor = await page.getByRole("dialog", { name: "Novo pedido manual", exact: true }).evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.notEqual(darkColor, "rgb(255, 255, 255)");
  assert.deepEqual(errors, [], "Nenhum erro JavaScript na tela");
  console.log("KOA_PORTRAIT_SELECTION_AND_THEME = OK");
  console.log(`ARTIFACTS = ${artifactDir}`);
} finally {
  await context.close(); await browser.close(); await vite.close();
}
