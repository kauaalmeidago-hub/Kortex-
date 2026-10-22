import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Inbox,normalizeMessage} from './core.mjs';
import {WhatsAppRuntime} from './runtime.mjs';
import {CardIntake} from './card-intake.mjs';
import {generateKeyPairSync} from 'node:crypto';
import {openCardEnvelope} from '../koa-cards/core.mjs';
const now=Date.now(),peer='551100000001@s.whatsapp.net';
const channel={id:'channel',instance:'koa-fixture',group_jid:'123@g.us',actor_id:'actor',workspace_id:'workspace',activated_at:new Date(now-60000).toISOString(),conversations_enabled:true,tasks_enabled:true};
const raw=(id,text)=>({key:{id,remoteJid:peer},message:{conversation:text},messageTimestamp:Math.floor(now/1000)});
function fixture(saved=false){
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});
 let pending;const inserted=[],sent=[],inbox=new Inbox(':memory:');
 const query=async(sql,params)=>{
  if(sql.startsWith('SELECT id,state,source_event'))return {rows:pending?[pending]:[]};
  if(sql.includes('koa_whatsapp_card_workers'))return {rows:[{id:'worker',key_id:'a'.repeat(64),public_key:keys.publicKey.export({format:'jwk'})}]};
  if(sql.includes('count(*)'))return {rows:[{n:0}]};
  if(sql.startsWith('INSERT INTO public.koa_whatsapp_card_requests')){inserted.push(params);pending={id:'request',state:saved?'queued':'awaiting_access',source_event:params[1],key_id:'a'.repeat(64),worker_id:'worker',sealed_payload:params[7]?JSON.parse(params[7]):null};return {rows:[]};}
  if(sql.startsWith('UPDATE public.koa_whatsapp_card_requests SET sealed_payload=')){pending.state='queued';pending.sealed_payload=JSON.parse(params[1]);return {rows:[{id:'request'}]};}
  if(sql.includes("state='cancelled'")){pending=null;return {rows:[]};}throw Error('UNEXPECTED_QUERY');
 };
 const intake=new CardIntake({query,secret:'s'.repeat(40),origin:'https://portal.example',accessMode:saved?'saved':'form'});
 const runtime=new WhatsAppRuntime({inbox,cardIntake:intake,privateMessages:true,privatePolicy:'koa_call',privateActivatedAt:new Date(now-30000).toISOString(),groupMessages:false,
  loadChannels:async()=>[channel],query,
  evolution:async(route,options)=>{
   if(route.startsWith('/instance/connectionState'))return {instance:{state:'open'}};
   if(route.startsWith('/instance/fetchInstances'))return [{name:channel.instance,ownerJid:'551100000099@s.whatsapp.net'}];
   if(route.startsWith('/message/sendText')){sent.push(JSON.parse(options.body));return {key:{id:'sent-'+sent.length}};}throw Error('UNEXPECTED_NETWORK');
  },fetchAI:async()=>{throw Error('CARD_DATA_MUST_NEVER_REACH_AI');}});
 return {runtime,intake,inbox,sent,inserted,keys,pending:()=>pending,close:async()=>{await runtime.stop();inbox.close();}};
}
async function until(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)assert.fail('Reply timed out');await new Promise(r=>setTimeout(r,10));}}
test('private card request and pasted access stay outside model and durable inbox; link is stable and cancellable',async()=>{
 const f=fixture();try{
  await f.runtime.heartbeat();const request=raw('request','KOA, emita minha carteirinha, CPF 52998224725 senha SECRET_FIXTURE');
  assert.equal(await f.runtime.accept({instance:channel.instance,event:'messages.upsert',data:request}),1);await until(()=>f.sent.length===1);
  assert.match(f.sent[0].text,/https:\/\/portal.example\/koa\/carteirinha#[\w-]{43}/);assert.equal(f.sent[0].number,peer);
  const saved=f.inbox.db.prepare('SELECT payload,text,integration FROM inbox WHERE id=?').get('request');assert.doesNotMatch(JSON.stringify(saved),/SECRET_FIXTURE|52998224725/);assert.equal(saved.integration,'card');
  assert.equal(f.inserted.length,1);assert.equal(f.inserted[0][2],peer);
  await f.runtime.accept({instance:channel.instance,event:'messages.upsert',data:raw('secret','senha OUTRA_SENHA')});await until(()=>f.sent.length===2);
  assert.doesNotMatch(JSON.stringify(f.inbox.db.prepare('SELECT * FROM inbox').all()),/OUTRA_SENHA/);
  assert.ok(f.sent[1].text.includes(f.sent[0].text.match(/https:\/\/\S+/)[0]));
  const context=f.inbox.context(normalizeMessage(raw('future','KOA, outra pergunta'),{allowPrivate:true}));assert.deepEqual(context.interacoes,[]);
  await f.runtime.accept({instance:channel.instance,event:'messages.upsert',data:raw('cancel','cancelar')});await until(()=>f.sent.length===3);assert.match(f.sent[2].text,/cancelado/);
  assert.equal(await f.runtime.accept({instance:channel.instance,event:'messages.upsert',data:{...raw('group','KOA carteirinha'),key:{id:'group',remoteJid:'123@g.us',participant:peer}}}),0);
 }finally{await f.close();}
});
test('saved-company mode sends no form and seals all private identity before SQLite or model processing',async()=>{
 const f=fixture(true);try{
  await f.runtime.heartbeat();await f.runtime.accept({instance:channel.instance,event:'messages.upsert',data:raw('saved','KOA carteirinha da ERC LOGISTICA E TRANSPORTE LTDA')});await until(()=>f.sent.length===1);
  assert.doesNotMatch(f.sent[0].text,/https:|formulário/i);assert.equal(f.pending().state,'queued');
  const packet=f.pending().sealed_payload;assert.equal(openCardEnvelope(packet.incoming,f.keys.privateKey,packet.incomingId).text,'KOA carteirinha da ERC LOGISTICA E TRANSPORTE LTDA');
  f.pending().state='awaiting_access';
  const identity='Nome completo: Pessoa Exemplo\nCPF: 52998224725\nNascimento: 12/04/1990';
  await f.runtime.accept({instance:channel.instance,event:'messages.upsert',data:raw('identity',identity)});await until(()=>f.sent.length===2);
  const messages=JSON.stringify(f.inbox.db.prepare('SELECT text,payload FROM inbox').all());assert.doesNotMatch(messages,/52998224725|Pessoa Exemplo|12\/04\/1990/);
  const current=f.pending().sealed_payload;assert.equal(openCardEnvelope(current.incoming,f.keys.privateKey,current.incomingId).text,identity);
  assert.doesNotMatch(f.sent[1].text,/https:|formulário/i);
  await f.runtime.accept({instance:channel.instance,event:'messages.upsert',data:raw('stop','cancelar')});await until(()=>f.sent.length===3);assert.match(f.sent[2].text,/cancelado/);
 }finally{await f.close();}
});
test('ordinary task messages retain existing flow; nested card credentials are redacted',async()=>{
 const f=fixture();try{
  const original=raw('task','KOA, lance tarefa para Comercial revisar CPF do contrato.');assert.equal(await f.intake.sanitize(original,channel.id,peer),original);
  const nested={...raw('nested',''),message:{ephemeralMessage:{message:{conversation:'KOA carteirinha senha HIDDEN_SECRET'}}}};
  assert.doesNotMatch(JSON.stringify(await f.intake.sanitize(nested,channel.id,peer)),/HIDDEN_SECRET/);
 }finally{await f.close();}
});
