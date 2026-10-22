import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LocalCardProfiles} from './local-profiles.mjs';
test('verified local identity stays bound to caller, channel, company and credential',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'koa-card-profiles-'));
 const store=new LocalCardProfiles({directory,protect:async text=>Buffer.from(text).toString('base64'),unprotect:async text=>Buffer.from(text,'base64').toString()});
 const job={channel_id:'channel',peer_jid:'10001@lid'},company={companyId:'company',credentialId:'access'},identity={beneficiaryName:'Pessoa Exemplo',cpf:'52998224725',birthDate:'1990-04-12'};
 try{
  assert.equal(await store.get(job,company),null);await assert.rejects(store.put(job,company,identity,{verified:false}));
  await store.put(job,company,identity,{verified:true,method:'portal_name_cpf_birth_date'});assert.deepEqual(await store.get(job,company),identity);
  assert.equal(await store.get({...job,peer_jid:'10002@lid'},company),null);assert.equal(await store.get({...job,channel_id:'other'},company),null);
  assert.equal(await store.get(job,{...company,credentialId:'other'}),null);assert.equal(await store.get(job,{...company,companyId:'other'}),null);
  const files=await fs.readdir(directory),text=await fs.readFile(path.join(directory,files[0]),'utf8');assert.doesNotMatch(text,/Pessoa Exemplo|52998224725/);
  const stale=JSON.parse(Buffer.from(text,'base64').toString());stale.verifiedAt='2000-01-01';await fs.writeFile(path.join(directory,files[0]),Buffer.from(JSON.stringify(stale)).toString('base64'));assert.equal(await store.get(job,company),null);
 }finally{
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('koa-card-profiles-'));await fs.rm(directory,{recursive:true,force:true});
 }
});
