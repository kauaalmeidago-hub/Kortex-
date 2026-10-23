import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {sealCardPayload} from '../koa-whatsapp/card-seal.mjs';
import {prepareSavedDialog,identityFromText} from './saved-dialog.mjs';
const keys=generateKeyPairSync('rsa',{modulusLength:2048}),pub=keys.publicKey.export({format:'jwk'}),keyId='d'.repeat(64);
const company='ERC LOGISTICA E TRANSPORTE LTDA',row={company_id:'erc',workspace_id:'support',name:company,credential_id:'access',operator:'ndi',credential_ref:'ndi:erc:login:EKKRY',portal_login_code:'EKKRY'};
const query=async()=>({rows:[row]}),job=(text,state)=>({id:'request',channel_id:'channel',peer_jid:'10001@lid',sealed_payload:{mode:'saved_company',incomingId:'event',incoming:sealCardPayload({text},pub,keyId,'event'),continuation:state?sealCardPayload(state,pub,keyId,'request'):null}});
const identity={beneficiaryName:'Pessoa Exemplo',cpf:'52998224725',birthDate:'1990-04-12'};
test('saved company is recognized in a private card request; missing identity is requested in WhatsApp',async()=>{
 const result=await prepareSavedDialog({query,job:job('KOA, emita minha carteirinha da '+company),privateKey:keys.privateKey});
 assert.equal(result.state.companyName,company);assert.match(result.prompt,/Nome completo:/);assert.match(result.prompt,/Não precisa informar login ou senha/);assert.doesNotMatch(result.prompt,/https:|formulário/i);
});
test('encrypted continuation collects identity and never requires a portal password from the caller',async()=>{
 const result=await prepareSavedDialog({query,job:job('Nome completo: Pessoa Exemplo\nCPF: 529.982.247-25\nNascimento: 12/04/1990',{companyName:company}),privateKey:keys.privateKey});
 assert.equal(result.company.companyId,'erc');assert.deepEqual(result.identity,identity);assert.equal('password' in result,false);
 assert.deepEqual(identityFromText('Nome: Pessoa Exemplo\nCPF: 52998224725\nNascimento: 1990-04-12'),identity);
});
test('CPF is optional only while the saved-company registry remains the identity authority',async()=>{
 const result=await prepareSavedDialog({query,job:job('Nome completo: Pessoa Exemplo\nNascimento: 12/04/1990',{companyName:company}),privateKey:keys.privateKey});
 assert.deepEqual(result.identity,{beneficiaryName:'Pessoa Exemplo',birthDate:'1990-04-12'});assert.match((await prepareSavedDialog({query,job:job('KOA carteirinha da '+company),privateKey:keys.privateKey})).prompt,/CPF:.*opcional/);
});
test('verified profile is reused only through the worker caller binding; company revocation blocks reuse',async()=>{
 const source=job('KOA carteirinha da '+company),result=await prepareSavedDialog({query,job:source,privateKey:keys.privateKey,readProfile:async()=>identity});
 assert.deepEqual(result.identity,identity);
 let opened=false;const denied=await prepareSavedDialog({query:async()=>({rows:[]}),job:source,privateKey:keys.privateKey,readProfile:async()=>{opened=true;return identity;}});
 assert.equal(opened,false);assert.ok(denied.prompt);assert.equal(denied.company,undefined);
});
test('wrong request continuation or tampered incoming ciphertext cannot open personal data',async()=>{
 const source=job('KOA carteirinha',{companyName:company});source.id='other';
 await assert.rejects(prepareSavedDialog({query,job:source,privateKey:keys.privateKey}));
 const bad=job('KOA carteirinha');bad.sealed_payload.incoming.data='AAAA';await assert.rejects(prepareSavedDialog({query,job:bad,privateKey:keys.privateKey}));
});
