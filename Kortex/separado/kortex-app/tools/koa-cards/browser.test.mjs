import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {emitSelfServiceCard} from '../../automation-server/tmp/whatsapp-card-runtime/dist/workflows/SelfServiceCard.js';
const {chromium}=createRequire(new URL('../../automation-server/package.json',import.meta.url))('playwright');
const origin='https://operator.fixture.test',name='PESSOA EXEMPLO',cpf='52998224725';
const wrap=html=>'<!doctype html><html><head><meta charset="utf-8"><title>Carteira Provisoria</title></head><body>'+html+'</body></html>';
test('existing local tool logs in, validates one beneficiary and renders real PDF without company storage',{timeout:180000},async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const context=await browser.newContext();context.setDefaultTimeout(10000);context.setDefaultNavigationTimeout(12000);let printed=false,saved,loginBody;
  await context.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());console.log('fixture_navigation:'+url.pathname);let html;
   if(url.pathname==='/login')html='<form action="/period" method="post"><label>Empresa<input name="p_cd_empresa" id="p_cd_empresa"></label><label>Senha<input name="p_cd_senha" id="p_cd_senha" type="password"></label><button id="btn_entrar">Entrar</button></form>';
   else if(url.pathname==='/period'){loginBody=route.request().postData();html='<h1>Datas de adesão</h1><form action="/list"><label>Data inicial<input name="start"></label><label>Data final<input name="end"></label><button>Consultar</button></form>';}
   else if(url.pathname==='/list')html='<form action="/print"><table><tr><th>Selecionar</th><th>Nome</th><th>CPF</th><th>Nascimento</th><th>Carteira</th></tr><tr><td><input type="checkbox" name="own" value="1"></td><td>'+name+'</td><td>'+cpf+'</td><td>12/04/1990</td><td>123456789101</td></tr><tr><td><input type="checkbox" name="other" value="1"></td><td>OUTRA PESSOA</td><td>11144477735</td><td>01/01/1980</td><td>987654321001</td></tr></table><button>Imprimir selecionados</button></form>';
   else if(url.pathname==='/print'){assert.equal(url.searchParams.get('own'),'1');assert.equal(url.searchParams.has('other'),false);printed=true;html='<section class="card" style="width:500px;min-height:180px;border:1px solid black;padding:20px"><h2>Carteira Provisoria</h2><p>Nome: '+name+'</p><p>CPF: '+cpf+'</p><p>Carteira: 123456789101</p><p>Plano: TESTE · Validade: 31/12/2026</p></section>';}
   else throw Error('Unexpected fixture navigation');
   await route.fulfill({status:200,contentType:'text/html',body:wrap(html)});
  });
  const page=await context.newPage(),op={id:'fixture-card',companyId:'memory-only',type:'CARD_ISSUE',portal:'ndi',credentialRef:'self:fixture',status:'starting',input:{beneficiaryName:name,cpf,birthDate:'1990-04-12',contractCode:'12345',periodStart:'2026-01-01',periodEnd:'2026-10-22',beneficiaryScope:'single'},artifacts:[]};
  const signal=AbortSignal.timeout(120000);signal.addEventListener('abort',()=>void context.close(),{once:true});
  await emitSelfServiceCard(op,signal,{
   config:{ndiCardPortalUrl:origin+'/login',authTimeoutMs:10000,actionTimeoutMs:10000},
   browserManager:{withContext:async(_op,_signal,callback)=>callback(context,page),validateAllowedUrl:url=>assert.equal(new URL(url).origin,origin)},
   secretProvider:{get:async ref=>{assert.equal(ref,op.credentialRef);return {username:'12345',password:'fixture-password'};}},
   repository:{update:async(_id,patch)=>Object.assign(op,patch)},updateStatus:async status=>{op.status=status;console.log('fixture_status:'+status);},
   artifactStorage:{save:async input=>{saved=input;return {storagePath:'memory.pdf',fileName:'carteirinha.pdf'};}}
  });
  assert.equal(printed,true);assert.match(loginBody,/fixture-password/);assert.equal(op.status,'success');assert.equal(op.artifacts.length,1);
  assert.equal(op.result.selfServiceIdentity.verified,true);assert.equal(saved.metadata.beneficiaryCount,1);assert.equal(saved.bytes.subarray(0,5).toString(),'%PDF-');assert.ok(saved.bytes.length>1000);
 }finally{await browser.close();}
});
