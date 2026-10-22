import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveSavedCompany,loadSavedCompanyAccess} from './saved-access.mjs';
const row={company_id:'company',workspace_id:'workspace',name:'Empresa de Teste',credential_id:'access',operator:'ndi',credential_ref:'ndi:company:login:12345',portal_login_code:'12345'};
const input={channelId:'koa-channel',companyName:'  EMPRESA de Téste  '};
test('saved company lookup uses exact normalized name and existing channel/worker permissions',async()=>{
 const query=async(sql,params)=>{assert.match(sql,/c.workspace_id=k.workspace_id/);assert.match(sql,/business_worker_scope/);assert.match(sql,/NOT b.archived/);assert.match(sql,/a.status='active'/);assert.match(sql,/a.last_verified_at IS NOT NULL/);assert.deepEqual(params,[input.channelId]);return {rows:[row]};};
 const company=await resolveSavedCompany(query,input);assert.equal(company.companyId,'company');assert.equal(company.companyCode,'12345');assert.equal('password' in company,false);
 await assert.rejects(resolveSavedCompany(query,{...input,companyName:'Empresa'}),e=>e.code==='SAVED_COMPANY_NOT_AVAILABLE');
});
test('missing, cross-scope, duplicate companies and multiple accesses cannot select a credential',async()=>{
 for(const [rows,code] of [[[],'SAVED_COMPANY_NOT_AVAILABLE'],[[row,{...row,company_id:'other'}],'SAVED_COMPANY_AMBIGUOUS'],[[row,{...row,credential_id:'other'}],'SAVED_COMPANY_ACCESS_AMBIGUOUS'],[[{...row,credential_ref:'ndi:other:login:12345'}],'SAVED_COMPANY_ACCESS_INVALID']]){
  await assert.rejects(loadSavedCompanyAccess(async()=>({rows}),{get:()=>assert.fail('Vault must not be opened')},input),e=>e.code===code);
 }
});
test('saved access is loaded locally after revalidation and must match the registered login',async()=>{
 let reads=0;const query=async()=>{reads++;return {rows:[row]};};
 const loaded=await loadSavedCompanyAccess(query,{get:async ref=>{assert.equal(reads,1);assert.equal(ref,row.credential_ref);return {username:'12345',password:'fixture-only'};}},input);
 assert.equal(loaded.credential.password,'fixture-only');
 await assert.rejects(loadSavedCompanyAccess(query,{get:async()=>({username:'99999',password:'fixture-only'})},input),e=>e.code==='SAVED_COMPANY_ACCESS_INVALID');
});
