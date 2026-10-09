import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { emitCard } from "../dist/workflows/hapvida/emitCard.js";
import { OperationRepository } from "../dist/db/OperationRepository.js";
import { EphemeralCredentialStore, OperationScopedSecretProvider } from "../dist/secrets/EphemeralCredentialStore.js";
import { createServer } from "../dist/server.js";
import { OperationEventBus } from "../dist/events/EventBus.js";
import { ExplicitCredentialResolver } from "../dist/credentials/CredentialResolver.js";

// Every portal request is intercepted. No real credentials or beneficiary data are used.
const browser = await chromium.launch({ headless: true, ...(process.env.KOA_TEST_BROWSER_EXECUTABLE
  ? { executablePath: process.env.KOA_TEST_BROWSER_EXECUTABLE } : { channel: process.env.KOA_BROWSER_CHANNEL || "chrome" }) });
const output = process.env.KOA_TEST_PDF_OUTPUT_DIR;
if (output) await mkdir(output, { recursive: true });
const html = body => `<!doctype html><html><head><meta charset="utf-8"><title>Carteira Provisória</title>
  <style>.card { border: 1px solid #345; margin: 12px; padding: 16px; width: 600px; break-inside: avoid; } body { font: 16px Arial; }</style></head><body>${body}</body></html>`;
const primary = "TITULAR DE TESTE", dependent = "DEPENDENTE DE TESTE", unrelated = "OUTRO TITULAR DE TESTE";
const cardId = index => String(900000000001 + index);

async function check(label, { portal = "ndi", include = false, change = false, unexpected = false, missing = false, disabled = false, locked = false, noDependentControl = false, requestedDependent = false } = {}) {
  const repository = new OperationRepository(":memory:"), store = new EphemeralCredentialStore();
  const portalUrl = `https://${portal === "ndi" ? "sigo.sh.srv.br" : "webhap.hapvida.com.br"}/card`;
  const now = new Date().toISOString();
  let operation = { id: `fixture-${label}`, type: "CARD_ISSUE", status: "starting", companyId: "company-fixture", portal,
    credentialRef: `${portal}:company-fixture:login:0TEST`, input: { contractCode: "0TEST", beneficiaryName: requestedDependent ? dependent : primary,
      periodStart: "2026-01-01", periodEnd: "2026-10-09" }, artifacts: [], createdAt: now, updatedAt: now };
  repository.create(operation);
  store.put(operation.id, operation.credentialRef, { username: "0TEST", password: "synthetic-password" }, 300000);
  let changed = false;
  const actions = [], pdfs = [], queued = [];
  const config = { hapvidaCardPortalUrl: portalUrl, ndiCardPortalUrl: portalUrl, actionTimeoutMs: 1200,
    authTimeoutMs: 1200, apiToken: "synthetic-api", features: { cardIssue: true, cardIssueActiveUsersPreflight: false } };
  const workflow = { config, repository,
    browserManager: { validateAllowedUrl() {}, validatePortalSession: async () => true, saveSession: async () => {}, invalidateSession: async () => {},
      withContext: async (_operation, _signal, callback) => {
        const context = await browser.newContext(); context.setDefaultTimeout(1500);
        await context.exposeFunction("fixturePrinted", checked => actions.push(checked));
        const people = [primary, changed ? "DEPENDENTE ALTERADO DE TESTE" : dependent, unrelated];
        const cards = people.map((name, index) => `<section class="card"><h2>Carteira Provisória - ${portal}</h2><p>Nome: ${name}</p><p>Carteirinha: ${cardId(index)}</p><p>Plano: TESTE</p></section>`);
        const list = html(`<table><tr><th>Nome do beneficiário</th><th>Carteirinha</th><th>Tipo</th><th>Matrícula do titular</th><th>Selecionar</th></tr>
          ${people.map((name, index) => `<tr><td>${name}</td><td>${cardId(index)}</td><td>${index === 1 ? "Dependente" : "Titular"}</td><td>${index === 1 ? cardId(0) : ""}</td>
            <td>${noDependentControl && index === 1 ? "" : `<input id="member-${index}" type="checkbox" ${index === 2 ? "checked" : ""} ${(disabled || locked) && index === 1 ? "disabled" : ""}
              ${index === 0 ? 'onchange="const child=document.getElementById(\'member-1\');if(child)child.checked = this.checked"' : ""}>`}</td></tr>`).join("")}</table>
          <button id="print">Imprimir selecionados</button><button id="print-all">Imprimir tudo</button><script>
            document.getElementById('print-all').onclick = () => { throw new Error('A family request must never print the whole company'); };
            document.getElementById('print').onclick = async () => {
              const chosen = Array.from(document.querySelectorAll('input[id^=member-]:checked')).map(input => Number(input.id.split('-')[1]));
              await window.fixturePrinted(chosen);
              const cards = ${JSON.stringify(cards)};
              const selected = ${unexpected || noDependentControl ? "[0,1]" : "chosen"}.map(index => cards[index]); ${missing ? "selected.pop();" : ""}
              const content = ${JSON.stringify(html("__CARDS__"))}.replace('__CARDS__', selected.join(''));
              document.open(); document.write(content); document.close();
            };</script>`);
        const period = html(`<h1>Datas de adesão</h1><form action="/members"><input aria-label="Data inicial"><input aria-label="Data final"><button>OK</button></form>`);
        const login = html('<form id="cd_form_login_emp" method="post" action="/auth"><label for="p_cd_empresa">Empresa</label><input id="p_cd_empresa" name="p_cd_empresa"><label for="p_cd_senha">Senha</label><input type="password" id="p_cd_senha" name="p_cd_senha"><button>OK</button></form>');
        await context.route("**/*", route => {
          const url = new URL(route.request().url()); assert.equal(url.origin, new URL(portalUrl).origin);
          if (url.pathname === "/auth") {
            const fields = new URLSearchParams(route.request().postData());
            assert.equal(fields.get("p_cd_empresa"), "0TEST"); assert.equal(fields.get("p_cd_senha"), "synthetic-password");
          }
          return route.fulfill({ contentType: "text/html; charset=utf-8", body: url.pathname === "/auth" ? period : url.pathname === "/members" ? list : login });
        });
        try { return await callback(context, await context.newPage()); } finally { await context.close(); }
      } },
    retainCardConfirmationCredential: (op, credential) => store.put(op.id, op.credentialRef, credential, 300000),
    artifactStorage: { save: async input => {
      pdfs.push(input); if (output) await writeFile(path.join(output, `${label}.pdf`), input.bytes);
      return { fileName: input.fileName, storageProvider: "fixture", storagePath: input.fileName, mimeType: input.mimeType, sizeBytes: input.bytes.length };
    } },
    updateStatus: async (status, step) => { const updated = repository.update(operation.id, { status, currentStep: step }); Object.assign(operation, updated); return updated; },
    emitEvent: async event => repository.appendEvent({ ...event, createdAt: new Date().toISOString() }),
  };
  const run = async () => {
    const generation = store.snapshotGeneration();
    workflow.secretProvider = new OperationScopedSecretProvider(operation.id, store, { get: async () => { throw new Error("A valid credential must survive the confirmation pause in RAM only"); } }, generation);
    try { await emitCard(operation, new AbortController().signal, workflow); }
    finally { store.clear(operation.id, generation); }
  };
  const app = await createServer({ config, repository, queue: { enqueue: id => queued.push(id) }, credentialResolver: new ExplicitCredentialResolver(), eventBus: new OperationEventBus() });
  try {
    await run(); operation = repository.get(operation.id);
    if (requestedDependent) {
      assert.equal(operation.status, "success"); assert.equal(pdfs.length, 1);
      assert.equal(operation.result.beneficiaryCount, 1); assert.deepEqual(operation.result.beneficiaryNames, [dependent]);
      assert.equal(operation.result.cardDependentConfirmation, undefined);
      assert.deepEqual(actions, [noDependentControl ? [0] : [1]]);
      assert(!JSON.stringify({ operation, events: repository.getEvents(operation.id) }).includes("synthetic-password"));
      console.log(JSON.stringify({ case: label, result: "PASS", pdfs: pdfs.length }));
      return;
    }
    assert.equal(operation.status, "awaiting_confirmation");
    assert.equal(pdfs.length, 0); assert.equal(actions.length, 0);
    assert.deepEqual(operation.result.cardDependentConfirmation.dependentNames, [dependent]);
    assert.equal(repository.getEvents(operation.id).filter(event => event.step === "card_print_requested").length, 0);
    const before = operation.result.cardDependentConfirmation.id;
    const accepted = await app.inject({ method: "POST", url: `/api/operations/${operation.id}/card-dependents`, headers: { "x-koa-automation-token": "synthetic-api" },
      payload: { confirmationId: before, includeDependents: include } });
    assert.equal(accepted.statusCode, 202, accepted.body); assert.deepEqual(queued, [operation.id]);
    operation = repository.get(operation.id); changed = change;
    if (missing) {
      await assert.rejects(run, error => error.code === "CARD_VALIDATION_FAILED");
      assert.equal(pdfs.length, 0); assert.notEqual(repository.get(operation.id).status, "success");
    } else {
      await run(); operation = repository.get(operation.id);
      if (change) {
        assert.equal(operation.status, "awaiting_confirmation");
        assert.notEqual(operation.result.cardDependentConfirmation.id, before);
        assert.deepEqual(operation.result.cardDependentConfirmation.dependentNames, ["DEPENDENTE ALTERADO DE TESTE"]);
        assert.equal(pdfs.length, 0); assert.equal(actions.length, 0);
      } else {
        assert.equal(operation.status, "success"); assert.equal(pdfs.length, 1);
        assert.deepEqual(actions, [noDependentControl ? [0] : [0, 1]]);
        assert.equal(operation.result.beneficiaryCount, include ? 2 : 1);
        assert.deepEqual(operation.result.beneficiaryNames, include ? [primary, dependent] : [primary]);
        assert.equal(operation.result.cardDependentConfirmation.decision, include ? "with" : "without");
      }
    }
    assert(!JSON.stringify({ operation: repository.get(operation.id), events: repository.getEvents(operation.id) }).includes("synthetic-password"));
    console.log(JSON.stringify({ case: label, result: "PASS", pdfs: pdfs.length }));
  } finally { await app.close(); repository.close(); }
}

try {
  for (const portal of ["ndi", "hapvida"]) {
    await check(`${portal}-family-with-authorized-dependent`, { portal, include: true });
    await check(`${portal}-family-without-auto-selected-dependent`, { portal, include: false });
    await check(`${portal}-forced-family-delivers-only-primary`, { portal, unexpected: true, locked: true });
    await check(`${portal}-forced-family-delivers-authorized-dependents`, { portal, include: true, locked: true });
    await check(`${portal}-holder-only-control-captures-primary`, { portal, noDependentControl: true });
    await check(`${portal}-holder-only-control-delivers-authorized-family`, { portal, include: true, noDependentControl: true });
    await check(`${portal}-direct-dependent-with-holder-only-control`, { portal, requestedDependent: true, noDependentControl: true });
    await check(`${portal}-direct-dependent-from-forced-family-preview`, { portal, requestedDependent: true, unexpected: true });
  }
  await check("changed-family-requires-new-choice", { include: true, change: true });
  await check("combined-preview-delivers-only-primary", { unexpected: true });
  await check("authorized-dependent-missing-in-preview-blocked", { include: true, missing: true });
  await check("auto-selected-disabled-dependent-accepted", { include: true, disabled: true });
} finally { await browser.close(); }
