import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { emitCard } from "../dist/workflows/hapvida/emitCard.js";
import { paginateCardDelivery } from "../dist/workflows/hapvida/cardDeliveryLayout.js";
import { OperationRepository } from "../dist/db/OperationRepository.js";
import { createServer } from "../dist/server.js";
import { OperationEventBus } from "../dist/events/EventBus.js";
import { ExplicitCredentialResolver } from "../dist/credentials/CredentialResolver.js";

// Every portal request is fulfilled locally. All names, credentials and identifiers are synthetic.
const browser = await chromium.launch({ headless: true, ...(process.env.KOA_TEST_BROWSER_EXECUTABLE
  ? { executablePath: process.env.KOA_TEST_BROWSER_EXECUTABLE } : { channel: process.env.KOA_BROWSER_CHANNEL || "chrome" }) });
const output = process.env.KOA_TEST_PDF_OUTPUT_DIR;
if (output) await mkdir(output, { recursive: true });
const id = index => String(900000000101 + index);
const people = [
  { name: "BEATRIZ DEPENDENTE DEMONSTRACAO", type: "Dependente", holder: id(4) },
  { name: "ALBERTO TITULAR DEMONSTRACAO", type: "Titular" },
  { name: "ANA DEPENDENTE DEMONSTRACAO", type: "Dependente", holder: id(1) },
  { name: "ANTONIO DEPENDENTE DEMONSTRACAO", type: "Dependente", holder: id(1) },
  { name: "BRUNO TITULAR DEMONSTRACAO", type: "Titular" },
  { name: "ALICE DEPENDENTE DEMONSTRACAO", type: "Dependente", holder: id(1) },
  { name: "CARLOS TITULAR DEMONSTRACAO", type: "Titular" },
];
const html = body => `<!doctype html><html><head><meta charset="utf-8"><title>Carteira Provisória</title><style>
  body { font:16px Arial; } .card { border:1px solid #345; width:640px; padding:18px; margin:12px; }
  .card h2 { color:#063367; } .terms { border-top:1px solid #345; padding-top:12px; }</style></head><body>${body}</body></html>`;
const manifest = [];

async function check(label, { portal = "ndi", all = false, target = 1, include = false, noDependentControls = false,
  orphan = false, homonym = false, extraPrintedPerson = false, fallbackPrint = false } = {}) {
  const repository = new OperationRepository(":memory:");
  const now = new Date().toISOString(), url = `https://${portal === "ndi" ? "sigo.sh.srv.br" : "webhap.hapvida.com.br"}/card`;
  const persons = people.map(person => ({ ...person }));
  if (homonym) persons[4].name = persons[1].name;
  if (orphan) persons[0].holder = "900000099999";
  let operation = { id:`test-${label}`, type:"CARD_ISSUE", status:"starting", companyId:"company-demo", portal,
    credentialRef:`${portal}:company-demo:login:0DEMO`, input:{ beneficiaryName:all ? "TODOS" : persons[target].name,
      ...(all ? { contractCode:"0DEMO" } : {}), periodStart:"2026-01-01", periodEnd:"2026-10-09" }, artifacts:[], createdAt:now, updatedAt:now };
  repository.create(operation);
  const printed=[], pdfs=[], queued=[];
  const config={ hapvidaCardPortalUrl:url, ndiCardPortalUrl:url, actionTimeoutMs:2000, authTimeoutMs:2000,
    apiToken:"synthetic-api", features:{ cardIssue:true, cardIssueActiveUsersPreflight:false } };
  const list=html(`<table><tr><th>Nome</th><th>Carteirinha</th><th>Tipo</th><th>Matricula do titular</th><th>Selecionar</th></tr>
    ${persons.map((person,index)=>`<tr><td>${person.name}</td><td>${id(index)}</td><td>${person.type}</td><td>${person.holder||""}</td>
    <td>${noDependentControls && person.type==="Dependente" ? "" : `<input type="checkbox" id="member-${index}">`}</td></tr>`).join("")}</table>
    <button id="print">Imprimir selecionados</button><button id="print-all">Imprimir tudo</button><script>
    const persons=${JSON.stringify(persons)};
    async function printCards(all) {
      const checked=Array.from(document.querySelectorAll('input:checked')).map(element=>Number(element.id.split('-')[1]));
      let chosen=all ? persons.map((_,index)=>index) : checked;
      ${noDependentControls ? "if(!all)for(const index of checked)persons.forEach((person,position)=>{if(person.holder===String(900000000101+index)&&!chosen.includes(position))chosen.push(position);});" : ""}
      ${extraPrintedPerson ? "if(!chosen.includes(6))chosen.push(6);" : ""}
      await window.fixturePrinted({all,checked,chosen});
      const cards=chosen.map(index=>'<section class="card"><h2>Carteira Provisória - ${portal.toUpperCase()}</h2><p>Nome: '+persons[index].name+'</p><p>Carteirinha: '+String(900000000101+index)+'</p><p>Plano: DEMONSTRACAO</p><p>Validade: 31/12/2026</p><div class="terms">ORIENTACOES DE ATENDIMENTO PRESERVADAS. DADOS DE DEMONSTRACAO.</div></section>').join('');
      const markup=${JSON.stringify(html("__CARDS__"))}.replace('__CARDS__',cards);
      document.open();document.write(markup);document.close();
    }
    document.getElementById('print').onclick=()=>printCards(false);
    document.getElementById('print-all').onclick=()=>printCards(true);
    </script>`);
  const period=html('<h1>Datas de adesão</h1><form action="/members"><input aria-label="Data inicial"><input aria-label="Data final"><button>OK</button></form>');
  const login=html('<form id="cd_form_login_emp" action="/auth" method="post"><label for="p_cd_empresa">Empresa</label><input id="p_cd_empresa" name="p_cd_empresa"><label for="p_cd_senha">Senha</label><input id="p_cd_senha" name="p_cd_senha" type="password"><button>OK</button></form>');
  const workflow={ config, repository,
    browserManager:{ validateAllowedUrl(){}, validatePortalSession:async()=>true, saveSession:async()=>{}, invalidateSession:async()=>{},
      withContext:async(_operation,_signal,callback)=>{
        const context=await browser.newContext();context.setDefaultTimeout(2500);
        await context.exposeFunction("fixturePrinted",data=>printed.push(data));
        await context.route("**/*",route=>{ const current=new URL(route.request().url());assert.equal(current.origin,new URL(url).origin);
          return route.fulfill({contentType:"text/html; charset=utf-8",body:current.pathname==="/members"?list:current.pathname==="/auth"?period:all?login:period}); });
        const originalNewPage=context.newPage.bind(context);
        if (fallbackPrint) context.newPage=async()=>{ const page=await originalNewPage();page.pdf=async()=>{throw new Error("Force the Chromium print fallback");};return page; };
        try{return await callback(context,await context.newPage());}finally{await context.close();}
      } },
    secretProvider:{get:async()=>({username:"0DEMO",password:"synthetic-password"})},
    artifactStorage:{save:async input=>{pdfs.push(input);if(output)await writeFile(path.join(output,`${label}.pdf`),input.bytes);
      return{fileName:input.fileName,mimeType:input.mimeType,storagePath:input.fileName,storageProvider:"fixture",sizeBytes:input.bytes.length};}},
    updateStatus:async(status,step)=>Object.assign(operation,repository.update(operation.id,{status,currentStep:step})),
    emitEvent:async event=>repository.appendEvent({...event,createdAt:new Date().toISOString()}),
  };
  const run=()=>emitCard(operation,new AbortController().signal,workflow);
  const app=await createServer({config,repository,queue:{enqueue:op=>queued.push(op)},credentialResolver:new ExplicitCredentialResolver(),eventBus:new OperationEventBus()});
  try {
    if(orphan) { await assert.rejects(run,error=>error.code==="CARD_FAMILY_MAPPING_FAILED");assert.equal(pdfs.length,0);console.log(JSON.stringify({case:label,result:"PASS",blocked:true}));return; }
    await run();operation=repository.get(operation.id);
    if(operation.status==="awaiting_confirmation") {
      assert.equal(pdfs.length,0);assert.equal(printed.length,0);
      const response=await app.inject({method:"POST",url:`/api/operations/${operation.id}/card-dependents`,headers:{"x-koa-automation-token":"synthetic-api"},payload:{confirmationId:operation.result.cardDependentConfirmation.id,includeDependents:include}});
      assert.equal(response.statusCode,202,response.body);assert.deepEqual(queued,[operation.id]);
      operation=repository.get(operation.id);await run();operation=repository.get(operation.id);
    }
    assert.equal(operation.status,"success");assert.equal(pdfs.length,1);assert.equal(printed.length,1);
    const expected=all?persons.map((_,index)=>index):[target,...(include?persons.map((person,index)=>person.holder===id(target)?index:-1).filter(index=>index>=0):[])];
    assert.equal(operation.result.beneficiaryCount,expected.length);
    assert.deepEqual(new Set(operation.result.beneficiaryNames),new Set(expected.map(index=>persons[index].name)));
    assert.equal(operation.result.cardDeliveryVersion,1);assert(pdfs[0].bytes.length>100000);
    const fileName=all?"carteirinhas-empresa-0demo.pdf":persons[target].name.toLowerCase().replaceAll(" ","-")+".pdf";
    assert.equal(pdfs[0].fileName,fileName);
    const members=expected.map(index=>({id:String(index),beneficiaryName:persons[index].name,role:persons[index].type==="Titular"?"holder":"dependent",
      ...(persons[index].holder?{holderId:String(Number(persons[index].holder)-900000000101)}:{})}));
    const layouts=paginateCardDelivery(members);
    assert.equal(operation.result.pageCount,layouts.length);
    manifest.push({file:`${label}.pdf`,title:all?"carteirinhas da empresa 0demo":persons[target].name.toLowerCase(),fileName,
      uniqueIds:expected.map(id),excludedIds:persons.map((_,index)=>index).filter(index=>!expected.includes(index)).map(id),
      pages:layouts.map(layout=>({template:layout.template,members:layout.members.map(member=>({id:id(Number(member.id)),name:member.beneficiaryName,role:member.role}))}))});
    assert(!JSON.stringify({operation:repository.get(operation.id),events:repository.getEvents(operation.id)}).includes("synthetic-password"));
    console.log(JSON.stringify({case:label,result:"PASS",cards:expected.length,pages:layouts.length,filename:fileName}));
  } finally {await app.close();repository.close();}
}

try {
  for(const portal of ["ndi","hapvida"]) {
    await check(`${portal}-branded-individual-holder`,{portal});
    await check(`${portal}-branded-individual-dependent`,{portal,target:2});
    await check(`${portal}-branded-family-three-dependents`,{portal,include:true});
    await check(`${portal}-branded-all-separated-families`,{portal,all:true});
    await check(`${portal}-branded-all-holder-only-controls`,{portal,all:true,noDependentControls:true});
    await check(`${portal}-branded-family-holder-only-controls`,{portal,include:true,noDependentControls:true});
  }
  await check("branded-homonymous-holders-with-correct-dependents",{all:true,homonym:true});
  await check("branded-selected-family-excludes-extra-person",{include:true,extraPrintedPerson:true});
  await check("branded-orphan-dependent-cannot-be-misgrouped",{all:true,orphan:true});
  await check("branded-chromium-print-fallback",{fallbackPrint:true});
  if(output)await writeFile(path.join(output,"branded-delivery-manifest.json"),JSON.stringify(manifest,null,2));
} finally {await browser.close();}
