import assert from "node:assert/strict";
import { chromium } from "playwright";
import { HapvidaCardPage } from "../dist/workflows/hapvida/pageObjects/HapvidaCardPage.js";

// Synthetic layouts only: no credentials, beneficiary data or live portal requests.
const executablePath = process.env.KOA_TEST_BROWSER_EXECUTABLE;
const browser = await chromium.launch({ headless: true, ...(executablePath
  ? { executablePath } : { channel: process.env.KOA_BROWSER_CHANNEL || "chrome" }) });
const context = await browser.newContext();
await context.route("**/*", route => route.abort());
const name = "MARIA DE TESTE";
const box = (id, attributes = "") => `<input id="${id}" type="checkbox" ${attributes}>`;
const row = (content, control) => `<tr><td>${content}</td><td>${control}</td></tr>`;
const table = rows => `<table>${rows}</table>`;
const print = "<button>Imprimir selecionados</button>";
const cases = [
  { name: "name-only-row-before-selectable-row", body: table(row(name, "") + row(name, box("chosen"))), selected: ["chosen"] },
  { name: "hidden-first-control", body: table(row(name, box("template", 'style="display:none"') + box("chosen"))), selected: ["chosen"] },
  { name: "hidden-matching-row", body: `<table><tr hidden><td>${name}</td><td>${box("template")}</td></tr>${row(name, box("chosen"))}</table>`, selected: ["chosen"] },
  { name: "normalized-name", body: table(row("  Mária   de  Téste ", box("chosen"))), selected: ["chosen"] },
  { name: "label-for-hidden-checkbox", body: table(row(name, box("chosen", 'style="display:none"') + '<label for="chosen">Selecionar</label>')), selected: ["chosen"] },
  { name: "wrapping-label", body: table(row(name, `<label>${box("chosen", 'style="display:none"')}Selecionar</label>`)), selected: ["chosen"] },
  { name: "wrapping-label-after-unrelated-label", body: table(row(name, `<label>${box("other", "disabled")}Outro</label><label>${box("chosen", 'style="display:none"')}Selecionar</label>`)), selected: ["chosen"] },
  { name: "native-radio", body: table(row(name, '<input id="chosen" type="radio" name="beneficiary">')), selected: ["chosen"] },
  { name: "aria-checkbox", body: table(row(name, '<span id="chosen" role="checkbox" tabindex="0" aria-checked="false" onclick="this.setAttribute(\'aria-checked\', \'true\')">Selecionar</span>')), selected: ["chosen"] },
  { name: "nested-table", body: `<table><tr><td>${table(row(name, box("chosen")))}</td></tr></table>`, selected: ["chosen"] },
  { name: "homonyms-require-identifier", body: table(row(name, box("first")) + row(name, box("second"))), error: "BENEFICIARY_AMBIGUOUS" },
  { name: "homonyms-resolved-by-cpf", body: table(row(`${name} 111.111.111-11`, box("first")) + row(`${name} 222.222.222-22`, box("chosen"))), input: { cpf: "22222222222" }, selected: ["chosen"] },
  { name: "homonyms-resolved-by-birth-date", body: table(row(`${name} 01/01/1990`, box("first")) + row(`${name} 02/02/1992`, box("chosen"))), input: { birthDate: "1992-02-02" }, selected: ["chosen"] },
  { name: "identifier-does-not-match", body: table(row(`${name} 111.111.111-11`, box("first")) + row(`${name} 222.222.222-22`, box("second"))), input: { cpf: "33333333333" }, error: "BENEFICIARY_NOT_FOUND" },
  { name: "other-name-prefix", body: table(row("MARIA DE TESTEIRA", box("other")) + row(name, box("chosen"))), selected: ["chosen"] },
  { name: "missing-control", body: table(row(name, "")), error: "PORTAL_CHANGED" },
  { name: "disabled-control", body: table(row(name, box("disabled", "disabled"))), error: "PORTAL_CHANGED" },
  { name: "unconfirmed-selection", body: table(row(name, '<span role="checkbox" aria-checked="false" tabindex="0">Selecionar</span>')), error: "BENEFICIARY_SELECTION_FAILED" },
  { name: "already-selected", body: table(row(name, box("chosen", "checked"))), selected: ["chosen"] },
];

try {
  for (const test of cases) {
    const page = await context.newPage();
    page.setDefaultTimeout(1500);
    await page.setContent(`<!doctype html><html><body>${test.body}${print}</body></html>`);
    const cardPage = new HapvidaCardPage(page, 1500);
    const action = () => cardPage.selectBeneficiary({ beneficiaryName: name, ...test.input });
    if (test.error) await assert.rejects(action, error => error.code === test.error);
    else await action();
    const selected = await page.locator('input:checked, [aria-checked="true"]').evaluateAll(elements => elements.map(element => element.id));
    assert.deepEqual(selected, test.selected ?? [], test.name);
    console.log(JSON.stringify({ case: test.name, result: "PASS" }));
    await page.close();
  }

  const resultRows = table(row(name, box("chosen"))) + print;
  for (const test of [
    { name: "delayed-list", result: resultRows, delay: 100 },
    { name: "explicit-empty-result", result: "<p>Nenhum beneficiário encontrado</p>", delay: 0 },
    { name: "list-never-ready", error: "PORTAL_RESULTS_NOT_READY" },
  ]) {
    const page = await context.newPage();
    await page.setContent(`<h1>Datas de adesão</h1><button id="search">OK</button><div id="results"></div><script>
      document.getElementById('search').onclick = () => {
        const results = document.getElementById('results');
        results.setAttribute('aria-busy', 'true'); results.textContent = 'Carregando';
        ${test.result ? `setTimeout(() => { results.innerHTML = ${JSON.stringify(test.result)}; results.removeAttribute('aria-busy'); }, ${test.delay});` : ""}
      };
    </script>`);
    const cardPage = new HapvidaCardPage(page, test.error ? 250 : 1500);
    if (test.error) await assert.rejects(() => cardPage.submitPeriod(), error => error.code === test.error);
    else {
      await cardPage.submitPeriod();
      if (test.delay) {
        await cardPage.selectBeneficiary({ beneficiaryName: name });
        assert.equal(await page.locator("#chosen").isChecked(), true);
      } else await assert.rejects(() => cardPage.selectBeneficiary({ beneficiaryName: name }), error => error.code === "BENEFICIARY_NOT_FOUND");
    }
    console.log(JSON.stringify({ case: test.name, result: "PASS" }));
    await page.close();
  }
} finally { await context.close(); await browser.close(); }
