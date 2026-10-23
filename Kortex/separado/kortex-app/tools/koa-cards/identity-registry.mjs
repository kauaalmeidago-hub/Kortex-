import fs from 'node:fs/promises';
import path from 'node:path';
const nameKey=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
export class CardIdentityRegistry {
 constructor({directory,unprotect}){Object.assign(this,{directory,unprotect});}
 async verify(company,identity){
  if(!/^[a-f0-9-]{36}$/.test(company.credentialId))return {verified:false};
  let data;try{data=JSON.parse(await this.unprotect(await fs.readFile(path.join(this.directory,company.credentialId+'.dpapi'),'utf8')));}catch{return {verified:false};}
  if(data.credentialId!==company.credentialId||nameKey(data.companyName)!==nameKey(company.companyName)||!Array.isArray(data.records)||!/^[a-f0-9]{64}$/.test(data.sourceSha256))return {verified:false};
  // CPF can be omitted only for this protected source registry. Name and date
  // still have to resolve to one, and only one, listed beneficiary.
  const records=data.records.filter(row=>nameKey(row.beneficiaryName)===nameKey(identity.beneficiaryName)&&row.birthDate===identity.birthDate&&(!identity.cpf||row.cpf===identity.cpf));
  return records.length===1?{verified:true,sourceSha256:data.sourceSha256}:{verified:false};
 }
}
