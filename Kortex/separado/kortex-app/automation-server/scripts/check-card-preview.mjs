import assert from "node:assert/strict";
import { chromium } from "playwright";
import { HapvidaCardPage } from "../dist/workflows/hapvida/pageObjects/HapvidaCardPage.js";
import { validateCardPdfBytes } from "../dist/workflows/hapvida/downloadValidation.js";
import { emitCard } from "../dist/workflows/hapvida/emitCard.js";

// Local HTML fixtures only: no real credentials, portal calls or beneficiary data.
const expected = { beneficiaryName: "MARIA DE TESTE" };
const html = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>Emissao de Carteira Provisória</title></head><body>${body}</body></html>`;
const card = html("<section><p>Hapvida</p><p>Nome: MARIA DE TESTE</p><p>Codigo: 000000</p><p>Plano: TESTE</p></section>");
const executablePath = process.env.KOA_TEST_BROWSER_EXECUTABLE;
const browser = await chromium.launch({ headless: true, ...(executablePath
  ? { executablePath } : { channel: process.env.KOA_BROWSER_CHANNEL || "chrome" }) });
const context = await browser.newContext();
await context.route("**/*", (route) => route.abort());
try {
  const cases = [
    { name: "hidden-title-real-card", markup: card, reproduce: true },
    { name: "real-card-with-print-button", markup: card.replace("</body>", "<button>Imprimir todos</button></body>") },
    { name: "hidden-title-and-visible-heading", markup: html("<h1>Carteira Provisória</h1><p>MARIA DE TESTE</p>") },
    { name: "delayed-card-content", markup: html(`<p id="name"></p><script>setTimeout(() => document.getElementById('name').textContent = 'MARIA DE TESTE', 100);</script>`) },
    { name: "wrong-beneficiary", markup: html("<p>Nome: JOAO DE TESTE</p>"), error: "CARD_VALIDATION_FAILED" },
    { name: "title-only", markup: html(""), error: "CARD_PREVIEW_NOT_FOUND" },
    { name: "hidden-beneficiary", markup: html('<p hidden>MARIA DE TESTE</p>'), error: "CARD_PREVIEW_NOT_FOUND" },
    { name: "selection-list", markup: html('<table><tr><td>MARIA DE TESTE</td><td><input type="checkbox"></td></tr></table>'), error: "CARD_PREVIEW_NOT_FOUND" },
    { name: "hidden-checkbox-selection-list", markup: html('<table><tr><td>MARIA DE TESTE</td><td><input id="member" hidden type="checkbox"><label for="member">Selecionar</label></td></tr></table><button>Imprimir selecionados</button>'), error: "CARD_PREVIEW_NOT_FOUND" },
    { name: "aria-selection-list", markup: html('<table><tr><td>MARIA DE TESTE</td><td><span role="checkbox" aria-checked="true">Selecionar</span></td></tr></table>'), error: "CARD_PREVIEW_NOT_FOUND" },
    { name: "login-form", markup: html('<p>MARIA DE TESTE</p><input type="password">'), error: "CARD_PREVIEW_NOT_FOUND" },
    { name: "portal-error", markup: html("<p>Não foi possível gerar a carteirinha de MARIA DE TESTE</p>"), error: "CARD_PREVIEW_NOT_FOUND" },
  ];
  for (const test of cases) {
    const page = await context.newPage();
    await page.setContent(test.markup);
    if (test.reproduce) {
      // The production failure resolved its text locator to this hidden node.
      // Use the node directly so the regression also runs on text engines
      // that now exclude <head> when searching by text.
      const oldLocator = page.locator("title");
      assert.equal(await oldLocator.evaluate((element) => element.tagName), "TITLE");
      await assert.rejects(oldLocator.waitFor({ state: "visible", timeout: 120 }), /Timeout/);
    }
    const preview = new HapvidaCardPage(page, test.error ? 250 : 1500);
    if (test.error) {
      await assert.rejects(preview.waitForCardPreview(expected), (error) => error.code === test.error);
    } else {
      await preview.waitForCardPreview(expected);
      const pdf = validateCardPdfBytes(await page.pdf({ format: "A4", printBackground: true }));
      assert(pdf.length > 100);
    }
    console.log(JSON.stringify({ case: test.name, result: "PASS" }));
    await page.close();
  }
  for (const mode of ["popup", "same-tab"]) {
    const page = await context.newPage();
    const writeCard = mode === "popup"
      ? "const target = window.open('about:blank'); target.document.write(card); target.document.close();"
      : "document.open(); document.write(card); document.close();";
    await page.setContent(html(`<button id="print">Imprimir selecionados</button><script>
      const card = ${JSON.stringify(card)};
      document.getElementById('print').onclick = () => { ${writeCard} };
    </script>`));
    const result = await new HapvidaCardPage(page).requestSelectedCards([expected]);
    assert.equal(result === page, mode === "same-tab");
    await new HapvidaCardPage(result, 1500).waitForCardPreview(expected);
    validateCardPdfBytes(await result.pdf({ format: "A4", printBackground: true }));
    console.log(JSON.stringify({ case: mode, result: "PASS" }));
    if (result !== page) await result.close();
    await page.close();
  }

  const page = await context.newPage();
  const selection = `<table><tr><td>MARIA DE TESTE</td><td><input type="checkbox"></td></tr></table>
    <button id="print">Imprimir selecionados</button>`;
  const period = html(`<h1>Datas de adesão</h1><input type="text"><input type="text"><button id="period">OK</button>
    <script>
      document.getElementById('period').onclick = () => {
        document.body.innerHTML = ${JSON.stringify(selection)};
        document.getElementById('print').onclick = () => {
          const target = window.open('about:blank'); target.document.write(${JSON.stringify(card)}); target.document.close();
        };
      };
    </script>`);
  await context.route("https://portal.test/card", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: period }));
  const now = new Date().toISOString();
  const operation = { id: "offline-card", type: "CARD_ISSUE", portal: "hapvida", status: "starting", companyId: "offline-company",
    credentialRef: "offline-credential", input: { ...expected, periodStart: "2026-10-01", periodEnd: "2026-10-31" },
    artifacts: [], createdAt: now, updatedAt: now };
  const events = []; let savedPdf;
  await emitCard(operation, new AbortController().signal, {
    config: { hapvidaCardPortalUrl: "https://portal.test/card", features: { cardIssueActiveUsersPreflight: false } },
    browserManager: {
      withContext: async (_operation, _signal, callback) => callback(context, page),
      validateAllowedUrl() {}, validatePortalSession: async () => true, saveSession: async () => undefined,
    },
    secretProvider: { get: async () => { throw new Error("This authenticated fixture must not request a password"); } },
    repository: { get: async () => operation, update: async (_id, patch) => Object.assign(operation, patch) },
    artifactStorage: { save: async (input) => {
      savedPdf = validateCardPdfBytes(input.bytes, input.fileName);
      return { fileName: input.fileName, mimeType: input.mimeType, storagePath: input.fileName,
        storageProvider: "offline-test", sizeBytes: input.bytes.length, checksum: "offline-test" };
    } },
    updateStatus: async (status, step) => Object.assign(operation, { status, currentStep: step }),
    emitEvent: async (event) => { events.push(event); return event; },
  });
  assert.equal(operation.status, "success");
  assert.equal(operation.artifacts.length, 1);
  assert(savedPdf.length > 100);
  assert(events.some((event) => event.type === "artifact.created"));
  console.log(JSON.stringify({ case: "authenticated-workflow-to-pdf-artifact", result: "PASS" }));
  await page.close();
} finally {
  await context.close();
  await browser.close();
}
