import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {sealCardData} from '../../src/features/whatsapp/cardCrypto.ts';
import {cardInput,validCpf,openCardEnvelope,cardMedia} from './core.mjs';
import {cardAccess,validEnvelope} from '../../server/whatsapp/card-access.mjs';
import {verifiedSelfCardRow,verifySelfCardCompany} from '../../automation-server/tmp/whatsapp-card-runtime/dist/workflows/SelfServiceCard.js';

const now=Date.now(),token='T'.repeat(43),keyId='a'.repeat(64);
const input={beneficiaryName:'Pessoa Exemplo',cpf:'52998224725',birthDate:'1990-04-12',companyCode:'12345',operator:'ndi',password:' fixture secret '};
const keys=generateKeyPairSync('rsa',{modulusLength:2048}),publicKey={...keys.publicKey.export({format:'jwk'}),alg:'RSA-OAEP-256',ext:true,key_ops:['encrypt']};
const seal=()=>sealCardData('request-id',keyId,publicKey,input);
function database(overrides={}){
 const rows={koa_whatsapp_card_requests:{id:'request-id',state:'awaiting_access',expires_at:new Date(now+60000).toISOString(),worker_id:'worker',key_id:keyId,channel_id:'channel'},
  koa_whatsapp_channels:{conversations_enabled:true},koa_whatsapp_card_workers:{ready:true,last_seen_at:new Date(now).toISOString(),public_key:publicKey,key_id:keyId},...overrides};
 const admin={from(table){let patch,filters=[];const query={select(){return query;},eq(k,v){filters.push([k,v]);return query;},update(value){patch=value;return query;},maybeSingle(){return query;},then(resolve,reject){try{
  const row=rows[table];let result=row;
  if(patch){const matches=filters.every(([k,v])=>row[k]===v);if(matches)Object.assign(row,patch);result=matches?[{id:row.id}]:[];}
  return Promise.resolve({data:result,error:null}).then(resolve,reject);
 }catch(e){return Promise.reject(e).then(resolve,reject);}}};return query;}};
 return {rows,admin};
}
test('browser WebCrypto seals access; only local private key and original request can decrypt',async()=>{
 const envelope=await seal();assert.ok(validEnvelope(envelope));assert.doesNotMatch(JSON.stringify(envelope),/fixture secret|52998224725|Pessoa Exemplo/);
 assert.deepEqual(openCardEnvelope(envelope,keys.privateKey,'request-id'),input);
 assert.throws(()=>openCardEnvelope(envelope,keys.privateKey,'other-request'));
 const changed=Buffer.from(envelope.data,'base64');changed[0]^=1;
 assert.throws(()=>openCardEnvelope({...envelope,data:changed.toString('base64')},keys.privateKey,'request-id'));
 assert.throws(()=>openCardEnvelope(envelope,generateKeyPairSync('rsa',{modulusLength:2048}).privateKey,'request-id'));
});
test('identity input rejects invalid CPF, impossible dates, extra destinations and third-party scope',()=>{
 assert.equal(validCpf(input.cpf),true);assert.equal(validCpf('11111111111'),false);
 const parsed=cardInput(input);assert.equal(parsed.credential.password,input.password);assert.equal(parsed.input.beneficiaryScope,'single');assert.equal('password' in parsed.input,false);
 for(const patch of [{cpf:'52998224726'},{birthDate:'2026-02-30'},{birthDate:'2090-01-01'},{recipient:'other'},{beneficiaryScope:'all'},{periodStart:'2026-04-01',periodEnd:'2026-01-01'}])assert.throws(()=>cardInput({...input,...patch}));
 assert.equal(cardInput({...input,cpf:''},new Date(),{allowMissingCpf:true}).input.cpf,'');
 assert.throws(()=>cardInput({...input,cpf:''}));
});
test('public endpoint accepts encrypted data only and makes exact retries idempotent',async()=>{
 const {rows,admin}=database();const envelope=await seal();
 assert.equal((await cardAccess(admin,{action:'open',token},now)).id,'request-id');
 await assert.rejects(cardAccess(admin,{action:'submit',token,password:'plain'},now),e=>e.status===400);
 await assert.rejects(cardAccess(admin,{action:'submit',token,envelope:{...envelope,password:'plain'}},now),e=>e.status===400);
 assert.deepEqual(await cardAccess(admin,{action:'submit',token,envelope},now),{state:'queued'});
 assert.deepEqual(rows.koa_whatsapp_card_requests.sealed_payload,envelope);
 assert.equal(rows.koa_whatsapp_card_requests.sealed_hash,createHash('sha256').update(JSON.stringify(envelope)).digest('hex'));
 assert.deepEqual(await cardAccess(admin,{action:'submit',token,envelope},now),{state:'queued'});
 await assert.rejects(cardAccess(admin,{action:'submit',token,envelope:await seal()},now),e=>e.status===409);
});
test('expired links, paused channels, changed keys and offline local worker fail closed',async()=>{
 for(const [overrides,status] of [
  [{koa_whatsapp_card_requests:null},410],
  [{koa_whatsapp_card_channels:null,koa_whatsapp_channels:{conversations_enabled:false}},403],
  [{koa_whatsapp_card_workers:{ready:false}},503],
  [{koa_whatsapp_card_workers:{ready:true,last_seen_at:new Date(now-60000).toISOString(),key_id:keyId}},503],
  [{koa_whatsapp_card_workers:{ready:true,last_seen_at:new Date(now).toISOString(),key_id:'changed'}},503],
 ]){await assert.rejects(cardAccess(database(overrides).admin,{action:'open',token},now),e=>e.status===status);}
 await assert.rejects(cardAccess(database().admin,{action:'open',token},now+120000),e=>e.status===410);
});
test('operator match requires unique exact full name, CPF and birth date before rendering',()=>{
 const row={beneficiaryName:input.beneficiaryName,cpf:input.cpf,text:'Pessoa Exemplo 12/04/1990',kind:'beneficiary',visible:true,selectable:true};
 assert.equal(verifiedSelfCardRow([row],input),row);
 for(const rows of [[],[row,row],[{...row,cpf:'12345678900'}],[{...row,text:'Pessoa Exemplo'}],[{...row,beneficiaryName:'Outra Pessoa'}],[{...row,visible:false}]])assert.throws(()=>verifiedSelfCardRow(rows,input),e=>e.code==='SELF_IDENTITY_NOT_VERIFIED');
});
test('saved registry path may omit CPF only after its independent identity proof',()=>{
 const row={beneficiaryName:input.beneficiaryName,cpf:input.cpf,cardIdentifiers:['card-1'],text:'Pessoa Exemplo',kind:'beneficiary',visible:true,selectable:true};
 assert.equal(verifiedSelfCardRow([row],{...input,cpf:''},true),row);
 assert.throws(()=>verifiedSelfCardRow([row],{...input,cpf:''}),e=>e.code==='SELF_IDENTITY_NOT_VERIFIED');
});
test('document delivery is private, bounded PDF bytes with no public download URL',()=>{
 const pdf=Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(150)]),payload=cardMedia('551100000001@s.whatsapp.net',pdf);
 assert.equal(payload.media,pdf.toString('base64'));assert.equal(payload.fileName,'carteirinha.pdf');assert.equal(payload.number,'551100000001@s.whatsapp.net');
 for(const [peer,bytes] of [['123@g.us',pdf],['https://other.test',pdf],['10001@lid',Buffer.from('not a pdf')]])assert.throws(()=>cardMedia(peer,bytes));
});
test('saved-company document must contain the requested legal company name',()=>{
 verifySelfCardCompany('Empresa: ERC LOGISTICA E TRANSPORTE LTDA\nPlano ativo','ERC LOGISTICA E TRANSPORTE LTDA');
 assert.throws(()=>verifySelfCardCompany('Empresa: OUTRA EMPRESA LTDA','ERC LOGISTICA E TRANSPORTE LTDA'),e=>e.code==='SELF_COMPANY_NOT_VERIFIED');
});
