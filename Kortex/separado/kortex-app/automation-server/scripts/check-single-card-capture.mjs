import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { HapvidaCardPage } from "../dist/workflows/hapvida/pageObjects/HapvidaCardPage.js";
import { prepareSingleCardPrint } from "../dist/workflows/hapvida/singleCardCapture.js";
import { validateCardPdfBytes } from "../dist/workflows/hapvida/downloadValidation.js";

// Local documents only; family cards intentionally share a page, so page-level extraction cannot pass.
const browser = await chromium.launch({ headless: true, ...(process.env.KOA_TEST_BROWSER_EXECUTABLE
  ? { executablePath: process.env.KOA_TEST_BROWSER_EXECUTABLE } : { channel: process.env.KOA_BROWSER_CHANNEL || "chrome" }) });
const output = process.env.KOA_TEST_PDF_OUTPUT_DIR;
if (output) await mkdir(output, { recursive: true });
const people = ["TITULAR PESSOA DE TESTE", "DEPENDENTE PESSOA DE TESTE", "OUTRO BENEFICIARIO DE TESTE"];
const ids = ["900000000001", "900000000002", "900000000003"];
const identity = index => ({ beneficiaryName: people[index], cardIdentifiers: [ids[index]], requireIdentifier: true });
const html = body => `<!doctype html><html><head><meta charset="utf-8"><title>Carteira Provisória</title><style>
  body { font:16px Arial; } .card { border:2px solid #235; padding:14px; margin:10px; width:610px; break-inside:avoid; }
  #print-area .card h2 { color:#235; } .back { border-top:1px solid #235; padding-top:10px; }</style></head><body>${body}</body></html>`;
const logo = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="90" height="25"%3E%3Crect width="90" height="25" fill="%23235"/%3E%3C/svg%3E';
const card = (name, id, { readonly = false, table = false, short = false, footer = true } = {}) => {
  const printedName = short ? name.split(" ").slice(0, 2).join(" ") : name;
  const value = readonly ? `<input readonly value="${printedName}">` : printedName;
  const fields = table ? `<tr><td>Nome: ${value}</td></tr><tr><td>Carteirinha: ${id}</td></tr><tr><td>Plano: TESTE</td></tr><tr><td>Validade: 31/12/2026</td></tr>`
    : `<p>Nome: ${value}</p><p>Carteirinha: ${id}</p><p>Plano: TESTE</p><p>Validade: 31/12/2026</p>`;
  const end = footer ? '<div class="back">ATENDIMENTO 24 HORAS. TERMOS DO CARTAO DE TESTE.</div>' : "";
  return table ? `<table class="card"><tbody><tr><td><img src='${logo}'><h2>Carteira Provisória</h2></td></tr>${fields}<tr><td>${end}</td></tr></tbody></table>`
    : `<section class="card"><img src='${logo}'><h2>Carteira Provisória</h2>${fields}${end}</section>`;
};
const manifest = [];

async function check(label, { portal = "ndi", index = 0, frame = false, readonly = false, table = false,
  short = false, homonym = false, duplicate = false, wrongId = false, splitIdentity = false, missingData = false, unknown = false, hiddenPrintIdentity = false } = {}) {
  const context = await browser.newContext();
  await context.route("**/*", route => route.abort());
  const page = await context.newPage();
  const target = identity(index);
  const names = homonym ? people.map(() => people[index]) : people;
  let content = names.map((name, position) => card(name, duplicate ? ids[index] : wrongId && position === index ? "999999999999" : ids[position], { readonly, table, short })).join("");
  if (splitIdentity) content = card(people[index], "999999999999") + card(people[(index + 1) % people.length], ids[index]);
  if (missingData) content = `<section class="card"><h2>Carteira Provisória</h2><p>Nome: ${people[index]}</p><p>Carteirinha: ${ids[index]}</p></section>`;
  if (unknown) content += card("PESSOA FORA DA LISTA", "900000000099");
  const document = html(`<div id="print-area">${content}</div><button>Imprimir todos</button>${hiddenPrintIdentity ? "<style>@media print { .card p { display:none!important; } }</style>" : ""}`);
  await page.setContent(frame ? html('<p>Documento da família</p><iframe width="1000" height="1100"></iframe>') : document);
  if (frame) await page.locator("iframe").evaluate((element, markup) => { element.srcdoc = markup; }, document);
  const excluded = names.map((beneficiaryName, position) => ({ ...identity(position), beneficiaryName })).filter((_, position) => position !== index);
  try {
    // Whole-frame validation deliberately succeeds for the split-identity regression; capture must reject it.
    const documents = await new HapvidaCardPage(page, 700).waitForCardPreviews([target]);
    const action = () => prepareSingleCardPrint(page, documents, target, excluded, `Carteirinha - ${people[index]}`);
    if (duplicate || splitIdentity || missingData || hiddenPrintIdentity) {
      await assert.rejects(action, error => error.code === "CARD_CAPTURE_FAILED");
      console.log(JSON.stringify({ case: label, result: "PASS", blocked: true }));
      return;
    }
    const box = await action();
    const text = await page.locator("body").innerText();
    assert(text.includes(short ? people[index].split(" ").slice(0, 2).join(" ") : people[index]));
    assert(text.includes(ids[index]));
    assert(text.includes("ATENDIMENTO 24 HORAS"));
    assert(text.includes("31/12/2026"));
    assert.equal(await page.locator("img").count(), 1);
    assert.equal(await page.locator('input, button, iframe').count(), 0);
    for (let position = 0; position < people.length; position++) {
      if (position === index) continue;
      assert(!text.includes(ids[position]));
      if (!homonym) assert(!text.includes(people[position]));
    }
    assert(!text.includes("PESSOA FORA DA LISTA"));
    const pdf = validateCardPdfBytes(await page.pdf({ width: `${box.width}px`, height: `${box.height}px`,
      margin: { top:"0", right:"0", bottom:"0", left:"0" }, printBackground:true, preferCSSPageSize:false }));
    if (output) {
      await writeFile(path.join(output, `${label}.pdf`), pdf);
      manifest.push({ file: `${label}.pdf`, name: short ? people[index].split(" ").slice(0, 2).join(" ") : people[index], id: ids[index],
        excludedIds: ids.filter((_, position) => position !== index), footer: "ATENDIMENTO 24 HORAS", pages: 1 });
    }
    console.log(JSON.stringify({ case: label, portal, result: "PASS", pdfBytes: pdf.length, width: box.width, height: box.height }));
  } catch (error) {
    if (wrongId && error.code === "CARD_VALIDATION_FAILED") { console.log(JSON.stringify({ case: label, result: "PASS", blocked: true })); return; }
    throw error;
  } finally { await context.close(); }
}

try {
  for (const portal of ["ndi", "hapvida"]) {
    await check(`${portal}-holder-from-joint-page`, { portal });
    await check(`${portal}-dependent-in-middle-of-page`, { portal, index:1 });
    await check(`${portal}-chosen-last-card`, { portal, index:2 });
    await check(`${portal}-family-in-iframe-readonly`, { portal, frame:true, readonly:true, index:1 });
    await check(`${portal}-nested-table-cards`, { portal, table:true, index:1 });
    await check(`${portal}-shortened-name-with-card-id`, { portal, short:true, frame:true, index:1 });
    await check(`${portal}-homonym-selected-by-card-id`, { portal, homonym:true, index:1 });
    await check(`${portal}-unknown-extra-person-excluded`, { portal, unknown:true });
  }
  await check("duplicate-identity-cannot-be-isolated", { homonym:true, duplicate:true });
  await check("name-and-number-on-different-cards-blocked", { splitIdentity:true });
  await check("incomplete-card-cannot-be-isolated", { missingData:true });
  await check("full-name-wrong-number-blocked", { wrongId:true });
  await check("identity-hidden-by-print-css-blocked", { hiddenPrintIdentity:true });
  if (output) await writeFile(path.join(output, "single-capture-manifest.json"), JSON.stringify(manifest, null, 2));
} finally { await browser.close(); }
