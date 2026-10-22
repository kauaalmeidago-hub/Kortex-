import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {generateKeyPairSync} from 'node:crypto';
import fs from 'node:fs/promises';
import {openCardEnvelope} from './core.mjs';
const {chromium}=createRequire(new URL('../../automation-server/package.json',import.meta.url))('playwright');
test('published form encrypts in the browser before submitting and renders confirmation',{timeout:240000},async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048}),keyId='b'.repeat(64),id='form-fixture',requests=[],errors=[];
 const publicKey={...keys.publicKey.export({format:'jwk'}),alg:'RSA-OAEP-256',ext:true,key_ops:['encrypt']};
 const origin='https://kortex-usuarios.vercel.app',assets=new Map();
 const html=await (await fetch(origin+'/koa/carteirinha')).text();
 assets.set('/koa/carteirinha',{body:Buffer.from(html),contentType:'text/html'});
 await Promise.all([...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(async match=>{
  const response=await fetch(origin+match[1]);assets.set(match[1],{body:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get('content-type')});
 }));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
 try{
  const context=await browser.newContext({viewport:{width:1024,height:1080}}),page=await context.newPage();page.setDefaultTimeout(60000);
  page.on('pageerror',e=>errors.push(e.message));
  // Fetch the unchanged published assets through Node: this Windows browser's
  // network stalls on external navigation. Only the card API is simulated.
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/koa-cards'){
    const request=route.request().postDataJSON();requests.push(request);
    const body=request.action==='open'?{id,state:'awaiting_access',publicKey,keyId}:{state:'queued'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});return;
   }
   if(assets.has(url.pathname)){await route.fulfill({status:200,...assets.get(url.pathname)});return;}
   if(url.origin!==origin){await route.fulfill({status:204,body:''});return;}
   const response=await fetch(url,{signal:AbortSignal.timeout(25000)});
   await route.fulfill({status:response.status,contentType:response.headers.get('content-type')||'application/octet-stream',body:Buffer.from(await response.arrayBuffer())});
  });
  await page.goto('https://kortex-usuarios.vercel.app/koa/carteirinha#'+'F'.repeat(43),{waitUntil:'domcontentloaded',timeout:45000});
  await page.getByRole('heading',{name:'Sua carteirinha',exact:true}).waitFor();await page.getByLabel('Seu nome completo',{exact:true}).waitFor();console.log('form_rendered');
  await fs.mkdir('outputs/koa-cards',{recursive:true});
  await page.getByLabel('Seu nome completo',{exact:true}).fill('Pessoa Exemplo');await page.getByLabel('Seu CPF',{exact:true}).fill('52998224725');
  await page.getByLabel('Sua data de nascimento',{exact:true}).fill('1990-04-12');await page.getByLabel('Código de acesso da empresa',{exact:true}).fill('12345');
  await page.getByRole('combobox',{name:/^Operadora/}).selectOption('ndi');await page.getByLabel('Senha da operadora',{exact:true}).fill(' fixture-secret ');
  console.log('form_filled');await page.getByRole('button',{name:'Solicitar minha carteirinha',exact:true}).click();await page.getByRole('status').filter({hasText:'Pedido recebido'}).waitFor();console.log('form_submitted');
  const submitted=requests.find(r=>r.action==='submit');assert.ok(submitted);assert.doesNotMatch(JSON.stringify(submitted),/fixture-secret|52998224725|Pessoa Exemplo/);
  const opened=openCardEnvelope(submitted.envelope,keys.privateKey,id);assert.equal(opened.password,' fixture-secret ');assert.equal(opened.cpf,'52998224725');
  assert.deepEqual(errors,[]);assert.equal(await page.locator('input[type=password]').count(),0);
  await page.screenshot({path:'outputs/koa-cards/form-test.png',fullPage:true,animations:'disabled',timeout:45000});
  console.log(JSON.stringify({publishedFormRendered:true,browserEncryptionVerified:true,passwordCleared:true,apiIntercepted:true,noDatabaseOrOutboundWrites:true}));
 }finally{await browser.close();}
});
