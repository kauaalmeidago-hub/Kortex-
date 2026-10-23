import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CardIdentityRegistry} from './identity-registry.mjs';

test('registry accepts one exact beneficiary identity and rejects altered company or personal fields',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'koa-card-registry-'));
 const credentialId='11111111-1111-4111-8111-111111111111';
 const record={credentialId,companyName:'ERC LOGISTICA E TRANSPORTE LTDA',sourceSha256:'a'.repeat(64),records:[{beneficiaryName:'Pessoa Exemplo',cpf:'52998224725',birthDate:'1990-04-12'}]};
 const registry=new CardIdentityRegistry({directory,unprotect:async text=>Buffer.from(text,'base64').toString()});
 try{
  await fs.writeFile(path.join(directory,credentialId+'.dpapi'),Buffer.from(JSON.stringify(record)).toString('base64'));
  const company={credentialId,companyName:record.companyName};
  assert.deepEqual(await registry.verify(company,record.records[0]),{verified:true,sourceSha256:record.sourceSha256});
  assert.deepEqual(await registry.verify(company,{beneficiaryName:'Pessoa Exemplo',cpf:'',birthDate:'1990-04-12'}),{verified:true,sourceSha256:record.sourceSha256});
  assert.deepEqual(await registry.verify(company,{...record.records[0],cpf:'00000000000'}),{verified:false});
  assert.deepEqual(await registry.verify({...company,companyName:'Outra empresa'},record.records[0]),{verified:false});
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('registry rejects a CPF-free request when name and birth date are not unique',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'koa-card-registry-'));
 const credentialId='22222222-2222-4222-8222-222222222222';
 const record={credentialId,companyName:'Empresa de teste',sourceSha256:'b'.repeat(64),records:[
  {beneficiaryName:'Pessoa Exemplo',cpf:'52998224725',birthDate:'1990-04-12'},
  {beneficiaryName:'Pessoa Exemplo',cpf:'11144477735',birthDate:'1990-04-12'},
 ]};
 const registry=new CardIdentityRegistry({directory,unprotect:async text=>Buffer.from(text,'base64').toString()});
 try{await fs.writeFile(path.join(directory,credentialId+'.dpapi'),Buffer.from(JSON.stringify(record)).toString('base64'));assert.deepEqual(await registry.verify({credentialId,companyName:record.companyName},{beneficiaryName:'Pessoa Exemplo',cpf:'',birthDate:'1990-04-12'}),{verified:false});}
 finally{await fs.rm(directory,{recursive:true,force:true});}
});
