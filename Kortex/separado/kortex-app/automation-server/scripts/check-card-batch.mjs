import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { HapvidaCardPage } from "../dist/workflows/hapvida/pageObjects/HapvidaCardPage.js";
import { emitCard } from "../dist/workflows/hapvida/emitCard.js";
import { validateCardPdfBytes } from "../dist/workflows/hapvida/downloadValidation.js";

// Synthetic HTML only. The requests cannot reach a real portal or use real credentials.
const executablePath = process.env.KOA_TEST_BROWSER_EXECUTABLE;
const browser = await chromium.launch({ headless: true, ...(executablePath
  ? { executablePath } : { channel: process.env.KOA_BROWSER_CHANNEL || "chrome" }) });
const output = process.env.KOA_TEST_PDF_OUTPUT_DIR;
if (output) await mkdir(output, { recursive: true });
const names = ["JOANA PESSOA DE TESTE", "PEDRO PESSOA DE TESTE", "ANA PESSOA DE TESTE"];
const id = index => `90000000${String(index + 1).padStart(4, "0")}`;
const html = body => `<!doctype html><html><head><meta charset="utf-8"><title>Emissão de Carteira Provisória</title>
  <style>body { font: 16px Arial; color: #111; } .card { width: 620px; min-height: 175px; padding: 16px; border: 1px solid #345; margin: 12px; break-inside: avoid; }
  .card h2 { color: #345; }</style></head><body>${body}</body></html>`;
const inline = value => JSON.stringify(value).replaceAll("<", "\\u003c");
const master = place => `<label><input id="selecionar_todos_${place}" type="checkbox" onchange="document.querySelectorAll('input[id^=member-]').forEach(input => input.checked = this.checked); window.fixtureMasterSelected = this.checked;">Selecionar todos</label>`;
const selection = (people, options = {}) => {
  const cell = options.legacy ? "td" : "th";
  return `<table><thead><tr><${cell}>Nome do beneficiário</${cell}><${cell}>Carteirinha</${cell}>
    ${options.legacy ? `<${cell}>Produto</${cell}>` : ""}${options.sharedCpf ? `<${cell}>CPF</${cell}>` : ""}
    <${cell}>${options.master === "header" ? master("header") : "Selecionar"}</${cell}></tr></thead><tbody>${people.map((name, index) =>
    `<tr><td>${name}</td><td>${id(index)}</td>${options.legacy ? "<td>ASSISTENCIA MEDICA</td>" : ""}${options.sharedCpf ? "<td>111.222.333-44</td>" : ""}
    <td><input id="member-${index}" type="checkbox" ${options.preselected === index ? "checked" : ""}></td></tr>`).join("")}</tbody>
    ${options.master === "footer" ? `<tfoot><tr><td colspan="5">${master("footer")}</td></tr></tfoot>` : ""}</table>`;
};
const card = (name, index, options = {}) => `<section class="card"><h2>Carteira Provisória - ${options.portal || "NDI"}</h2>
  <p>Nome: ${options.readonly ? `<input readonly value="${name}">` : name}</p>
  <p>Carteirinha: ${options.wrongCode ? "999999999999" : id(index)}</p>${options.sharedCpf ? "<p>CPF: 111.222.333-44</p>" : ""}<p>Plano: TESTE</p><p>Validade: 31/12/2026</p></section>`;

async function workflowCase(label, { portal = "ndi", bulk = false, frame = false, readonly = false, shortened = false,
  wrongCode = false, omitLast = false, preselected, people = names, sharedCpf = false, error,
  legacy = false, master: masterPlace, printAll = false, allLabel = "Imprimir tudo", sameTab = false,
  companyCode = "0TEST", companyId = "synthetic-company" } = {}) {
  const context = await browser.newContext();
  const portalUrl = `https://${portal === "ndi" ? "sigo.sh.srv.br" : "webhap.hapvida.com.br"}/card`;
  const page = await context.newPage();
  page.setDefaultTimeout(1500);
  const actions = [], milestones = new Map();
  await context.exposeFunction("fixturePrinted", action => actions.push(action));
  const list = selection(people, { preselected, sharedCpf, legacy, master: masterPlace });
  const cards = people.map((name, index) => card(shortened ? name.split(" ").slice(0, 2).join(" ") : name, index, { readonly, wrongCode, portal, sharedCpf }));
  const print = `<button id="print">Imprimir selecionados</button>${printAll ? `<input id="print-all" type="button" value="${allLabel}">` : ""}<script>
    const printCards = async all => {
      const cards = ${JSON.stringify(cards)};
      const checked = Array.from(document.querySelectorAll('input[id^=member-]:checked')).map(input => Number(input.id.split('-')[1]));
      await window.fixturePrinted({ all, checked, masterSelected: window.fixtureMasterSelected === true });
      let result = (all ? cards : checked.map(index => cards[index]));
      ${omitLast ? "result.pop();" : ""}
      const documentHtml = ${JSON.stringify(html("__CARDS__"))}.replace('__CARDS__', result.join(''));
      const content = ${frame ? JSON.stringify(html('<p>Documento de impressão</p><iframe id="document" width="800" height="1000"></iframe>')) : "documentHtml"};
      const popup = ${sameTab ? "window" : "window.open('about:blank')"}; popup.document.open(); popup.document.write(content); popup.document.close();
      ${frame ? "popup.document.getElementById('document').srcdoc = documentHtml;" : ""}
    };
    document.getElementById('print').onclick = () => printCards(false);
    ${printAll ? "document.getElementById('print-all').onclick = () => printCards(true);" : ""}
  </script>`;
  const period = html(`<h1>Datas de adesão</h1><input aria-label="Data inicial"><input aria-label="Data final"><button id="search">OK</button>
    <script>document.getElementById('search').onclick = () => { document.body.innerHTML = ${inline(list + print)};
      const script = document.createElement('script'); script.textContent = document.body.querySelector('script').textContent; document.body.appendChild(script); };</script>`);
  await context.route("**/*", route => {
    assert.equal(route.request().url(), portalUrl);
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: period });
  });
  const now = new Date().toISOString();
  const operation = { id: `test-${label}`, type: "CARD_ISSUE", status: "starting", companyId, portal,
    credentialRef: `${portal}:${companyId}:login:${companyCode}`, input: { beneficiaryName: bulk ? "TODOS" : people[0],
      ...(bulk || companyCode !== "0TEST" ? { contractCode: companyCode } : {}), periodStart: "2020-01-01", periodEnd: "2026-10-09" },
    artifacts: [], createdAt: now, updatedAt: now };
  const pdfs = [], events = [];
  const workflow = {
    config: { hapvidaCardPortalUrl: portalUrl, ndiCardPortalUrl: portalUrl, actionTimeoutMs: error ? 400 : 2000,
      features: { cardIssueActiveUsersPreflight: false } },
    browserManager: { withContext: async (_op, _signal, callback) => callback(context, page), validateAllowedUrl() {},
      validatePortalSession: async () => true, saveSession: async () => {}, invalidateSession: async () => {} },
    secretProvider: { get: async ref => { assert.equal(ref, operation.credentialRef); return { username: companyCode, password: "synthetic-password" }; } },
    repository: { get: async () => operation, update: async (_id, patch) => Object.assign(operation, patch) },
    artifactStorage: { save: async input => {
      validateCardPdfBytes(input.bytes); pdfs.push(input);
      if (output) await writeFile(path.join(output, `${label}.pdf`), input.bytes);
      return { ...input, storageProvider: "fixture", storagePath: input.fileName, sizeBytes: input.bytes.length, checksum: "fixture" };
    } },
    updateStatus: async (status, step) => { milestones.set(status + ":" + step, performance.now()); return Object.assign(operation, { status, currentStep: step }); },
    emitEvent: async event => { events.push(event); return event; },
  };
  if (bulk || companyCode !== "0TEST") {
    // The workflow requires login for the exact requested code; this synthetic context starts authenticated.
    await context.unroute("**/*");
    const loginMarkup = html(`<form id="cd_form_login_emp" action="/auth" method="post"><label for="p_cd_empresa">Empresa</label><input id="p_cd_empresa" name="p_cd_empresa">
      <label for="p_cd_senha">Senha</label><input id="p_cd_senha" name="p_cd_senha" type="password"><button>OK</button></form>`);
    await context.route("**/*", route => {
      const url = new URL(route.request().url()); assert.equal(url.origin, new URL(portalUrl).origin);
      if (url.pathname === "/auth") {
        const fields = new URLSearchParams(route.request().postData());
        assert.equal(fields.get("p_cd_senha"), "synthetic-password"); assert.equal(fields.get("p_cd_empresa"), companyCode);
      }
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: url.pathname === "/auth" ? period : loginMarkup });
    });
  }
  try {
    if (error) {
      await assert.rejects(() => emitCard(operation, new AbortController().signal, workflow), failure => failure.code === error);
      assert.equal(pdfs.length, 0); assert.notEqual(operation.status, "success");
    } else {
      await emitCard(operation, new AbortController().signal, workflow);
      assert.equal(operation.status, "success"); assert.equal(pdfs.length, 1);
      assert.equal(operation.result.beneficiaryCount, bulk ? people.length : 1);
      assert.equal(operation.result.beneficiaryScope, bulk ? "all" : "single");
      assert.equal(operation.result.operator, portal);
      assert.equal(operation.result.companyId, companyId);
      assert.equal(pdfs[0].metadata.companyId, companyId);
      assert.equal(events.filter(event => event.type === "artifact.created").length, 1);
      assert.deepEqual(events.filter(event => event.step === "card_print_requested").map(event => event.data), [
        { operator: portal, command: bulk && printAll ? "all" : "selected", beneficiaryScope: bulk ? "all" : "single", beneficiaryCount: bulk ? people.length : 1 },
      ]);
      assert.equal(actions.length, 1);
      assert.equal(actions[0].all, bulk && printAll);
      assert.equal(actions[0].checked.length, bulk ? people.length : 1);
      if (bulk && masterPlace) assert.equal(actions[0].masterSelected, true);
      if (sameTab) {
        const printMs = milestones.get("verifying:Validando carteirinha gerada") - milestones.get("processing:Emitindo carteirinha");
        assert(printMs < 2500, `Same-tab printing unnecessarily waited ${printMs}ms for a popup`);
        console.log(JSON.stringify({ case: label, sameTabPrintMs: Math.round(printMs) }));
      }
    }
    assert(!JSON.stringify({ operation, events }).includes("synthetic-password"));
    console.log(JSON.stringify({ case: label, result: "PASS", pdfs: pdfs.length, count: operation.result?.beneficiaryCount }));
  } finally { await context.close(); }
}

try {
  await workflowCase("ndi-framed-card", { frame: true });
  await workflowCase("ndi-readonly-name", { frame: true, readonly: true });
  await workflowCase("ndi-short-name-verified-id", { frame: true, shortened: true });
  await workflowCase("ndi-short-name-wrong-id", { frame: true, shortened: true, wrongCode: true, error: "CARD_VALIDATION_FAILED" });
  await workflowCase("ndi-full-name-wrong-id", { frame: true, wrongCode: true, error: "CARD_VALIDATION_FAILED" });
  await workflowCase("ndi-individual-clears-other-selection", { preselected: 1 });
  await workflowCase("ndi-all-framed-multipage", { bulk: true, frame: true, people: Array.from({ length: 12 }, (_, index) => `PESSOA DE TESTE ${String.fromCharCode(65 + index)}`) });
  await workflowCase("hapvida-all-cards", { portal: "hapvida", bulk: true });
  await workflowCase("ndi-partial-batch-rejected", { bulk: true, frame: true, omitLast: true, error: "CARD_VALIDATION_FAILED" });
  await workflowCase("ndi-homonyms-verified-ids", { bulk: true, frame: true, people: [names[0], names[0]] });
  await workflowCase("ndi-missing-homonym-rejected", { bulk: true, frame: true, people: [names[0], names[0]], omitLast: true, error: "CARD_VALIDATION_FAILED" });
  await workflowCase("ndi-common-cpf-not-complete-batch", { bulk: true, frame: true, people: [names[0], names[0]], sharedCpf: true, omitLast: true, error: "CARD_VALIDATION_FAILED" });
  await workflowCase("ndi-all-td-header-master-print-everything", { bulk: true, legacy: true, master: "header", printAll: true, sameTab: true,
    companyCode: "0FIRST", companyId: "company-first", people: ["PESSOA DA EMPRESA PRIMEIRA A", "PESSOA DA EMPRESA PRIMEIRA B"] });
  await workflowCase("hapvida-all-other-company-print-all", { portal: "hapvida", bulk: true, legacy: true, master: "header", printAll: true,
    allLabel: "Imprimir todos", companyCode: "0SECOND", companyId: "company-second", people: ["PESSOA DA EMPRESA SEGUNDA A", "PESSOA DA EMPRESA SEGUNDA B", "PESSOA DA EMPRESA SEGUNDA C"] });
  await workflowCase("ndi-all-footer-control-print-all", { bulk: true, legacy: true, master: "footer", printAll: true, allLabel: "Imprimir todas", frame: true });
  await workflowCase("ndi-individual-keeps-selected-print-button", { legacy: true, master: "header", printAll: true, sameTab: true });
  await workflowCase("ndi-individual-large-list-without-popup-delay", { sameTab: true, people: Array.from({ length: 100 }, (_, index) => `PESSOA DE EMPRESA TESTE ${String.fromCharCode(65 + index % 26)} ${String.fromCharCode(65 + Math.floor(index / 26))}`) });

  const context = await browser.newContext(); await context.route("**/*", route => route.abort());
  const page = await context.newPage();
  for (const test of [
    { name: "empty-company-list", markup: "<p>Nenhum beneficiário encontrado</p>", error: "BENEFICIARY_NOT_FOUND" },
    { name: "paginator-not-a-complete-batch", markup: selection(names) + '<button>Próxima página</button>', error: "CARD_BATCH_INCOMPLETE" },
    { name: "unknown-selectable-row-still-blocked", markup: '<table><tr><td><input type="checkbox"></td><td>123</td></tr></table>', error: "CARD_BATCH_INCOMPLETE" },
  ]) {
    await page.setContent(html(test.markup));
    await assert.rejects(() => new HapvidaCardPage(page, 500).selectAllBeneficiaries(), error => error.code === test.error);
    console.log(JSON.stringify({ case: test.name, result: "PASS" }));
  }
  await context.close();
} finally { await browser.close(); }
