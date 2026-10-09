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
const selection = (people, options = {}) => `<table><thead><tr><th>Nome</th><th>Carteirinha</th>${options.sharedCpf ? "<th>CPF</th>" : ""}<th>Selecionar</th></tr></thead><tbody>${people.map((name, index) =>
  `<tr><td>${name}</td><td>${id(index)}</td>${options.sharedCpf ? "<td>111.222.333-44</td>" : ""}<td><input id="member-${index}" type="checkbox" ${options.preselected === index ? "checked" : ""}></td></tr>`).join("")}</tbody></table>`;
const card = (name, index, options = {}) => `<section class="card"><h2>Carteira Provisória - ${options.portal || "NDI"}</h2>
  <p>Nome: ${options.readonly ? `<input readonly value="${name}">` : name}</p>
  <p>Carteirinha: ${options.wrongCode ? "999999999999" : id(index)}</p>${options.sharedCpf ? "<p>CPF: 111.222.333-44</p>" : ""}<p>Plano: TESTE</p><p>Validade: 31/12/2026</p></section>`;

async function workflowCase(label, { portal = "ndi", bulk = false, frame = false, readonly = false, shortened = false,
  wrongCode = false, omitLast = false, preselected, people = names, sharedCpf = false, error } = {}) {
  const context = await browser.newContext();
  const portalUrl = `https://${portal === "ndi" ? "sigo.sh.srv.br" : "webhap.hapvida.com.br"}/card`;
  const page = await context.newPage();
  page.setDefaultTimeout(1500);
  const list = selection(people, { preselected, sharedCpf });
  const cards = people.map((name, index) => card(shortened ? name.split(" ").slice(0, 2).join(" ") : name, index, { readonly, wrongCode, portal, sharedCpf }));
  const print = `<button id="print">Imprimir selecionados</button><script>
    document.getElementById('print').onclick = () => {
      const cards = ${JSON.stringify(cards)};
      const checked = Array.from(document.querySelectorAll('tbody input:checked')).map(input => Number(input.id.split('-')[1]));
      let result = checked.map(index => cards[index]);
      ${omitLast ? "result.pop();" : ""}
      const documentHtml = ${JSON.stringify(html("__CARDS__"))}.replace('__CARDS__', result.join(''));
      const content = ${frame ? JSON.stringify(html('<p>Documento de impressão</p><iframe id="document" width="800" height="1000"></iframe>')) : "documentHtml"};
      const popup = window.open('about:blank'); popup.document.write(content); popup.document.close();
      ${frame ? "popup.document.getElementById('document').srcdoc = documentHtml;" : ""}
    };
  </script>`;
  const period = html(`<h1>Datas de adesão</h1><input aria-label="Data inicial"><input aria-label="Data final"><button id="search">OK</button>
    <script>document.getElementById('search').onclick = () => { document.body.innerHTML = ${inline(list + print)};
      const script = document.createElement('script'); script.textContent = document.body.querySelector('script').textContent; document.body.appendChild(script); };</script>`);
  await context.route("**/*", route => {
    assert.equal(route.request().url(), portalUrl);
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: period });
  });
  const now = new Date().toISOString();
  const operation = { id: `test-${label}`, type: "CARD_ISSUE", status: "starting", companyId: "synthetic-company", portal,
    credentialRef: `${portal}:synthetic:login:0TEST`, input: { beneficiaryName: bulk ? "TODOS" : people[0],
      ...(bulk ? { contractCode: "0TEST" } : {}), periodStart: "2020-01-01", periodEnd: "2026-10-09" },
    artifacts: [], createdAt: now, updatedAt: now };
  const pdfs = [], events = [];
  const workflow = {
    config: { hapvidaCardPortalUrl: portalUrl, ndiCardPortalUrl: portalUrl, actionTimeoutMs: error ? 400 : 2000,
      features: { cardIssueActiveUsersPreflight: false } },
    browserManager: { withContext: async (_op, _signal, callback) => callback(context, page), validateAllowedUrl() {},
      validatePortalSession: async () => true, saveSession: async () => {}, invalidateSession: async () => {} },
    secretProvider: { get: async () => ({ username: "0TEST", password: "synthetic-password" }) },
    repository: { get: async () => operation, update: async (_id, patch) => Object.assign(operation, patch) },
    artifactStorage: { save: async input => {
      validateCardPdfBytes(input.bytes); pdfs.push(input);
      if (output) await writeFile(path.join(output, `${label}.pdf`), input.bytes);
      return { ...input, storageProvider: "fixture", storagePath: input.fileName, sizeBytes: input.bytes.length, checksum: "fixture" };
    } },
    updateStatus: async (status, step) => Object.assign(operation, { status, currentStep: step }),
    emitEvent: async event => { events.push(event); return event; },
  };
  if (bulk) {
    // The workflow requires login for the exact requested code; this synthetic context starts authenticated.
    await context.unroute("**/*");
    const loginMarkup = html(`<form id="cd_form_login_emp" action="/auth" method="post"><label for="p_cd_empresa">Empresa</label><input id="p_cd_empresa" name="p_cd_empresa">
      <label for="p_cd_senha">Senha</label><input id="p_cd_senha" name="p_cd_senha" type="password"><button>OK</button></form>`);
    await context.route("**/*", route => {
      const url = new URL(route.request().url()); assert.equal(url.origin, new URL(portalUrl).origin);
      if (url.pathname === "/auth") assert.equal(new URLSearchParams(route.request().postData()).get("p_cd_senha"), "synthetic-password");
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
      assert.equal(events.filter(event => event.type === "artifact.created").length, 1);
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

  const context = await browser.newContext(); await context.route("**/*", route => route.abort());
  const page = await context.newPage();
  for (const test of [
    { name: "empty-company-list", markup: "<p>Nenhum beneficiário encontrado</p>", error: "BENEFICIARY_NOT_FOUND" },
    { name: "paginator-not-a-complete-batch", markup: selection(names) + '<button>Próxima página</button>', error: "CARD_BATCH_INCOMPLETE" },
  ]) {
    await page.setContent(html(test.markup));
    await assert.rejects(() => new HapvidaCardPage(page, 500).selectAllBeneficiaries(), error => error.code === test.error);
    console.log(JSON.stringify({ case: test.name, result: "PASS" }));
  }
  await context.close();
} finally { await browser.close(); }
