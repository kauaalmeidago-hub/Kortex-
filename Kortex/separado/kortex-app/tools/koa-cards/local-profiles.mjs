import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export class LocalCardProfiles {
 constructor({directory,protect,unprotect}){Object.assign(this,{directory,protect,unprotect});}
 binding(job,company){return [job.channel_id,job.peer_jid,company.companyId,company.credentialId].join(':');}
 file(binding){return path.join(this.directory,createHash('sha256').update(binding).digest('hex')+'.dpapi');}
 async get(job,company){
  const binding=this.binding(job,company);let record;
  try{record=JSON.parse(await this.unprotect(await fs.readFile(this.file(binding),'utf8')));}catch{return null;}
  const at=Date.parse(record.verifiedAt);
  if(record.binding!==binding||!['portal_name_cpf_birth_date','source_registry_and_portal_card'].includes(record.method)||!Number.isFinite(at)||at>Date.now()+60000||Date.now()-at>90*86400000)return null;
  return record.identity;
 }
 async put(job,company,identity,proof){
  if(proof?.verified!==true||!['portal_name_cpf_birth_date','source_registry_and_portal_card'].includes(proof.method))throw Error('PROFILE_IDENTITY_UNVERIFIED');
  const binding=this.binding(job,company);await fs.mkdir(this.directory,{recursive:true});
  const bytes=await this.protect(JSON.stringify({binding,identity,verifiedAt:new Date().toISOString(),method:proof.method}));
  await fs.writeFile(this.file(binding),bytes,{mode:0o600});
 }
}
