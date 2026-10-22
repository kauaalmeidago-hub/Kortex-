import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Inbox} from './core.mjs';
import {WhatsAppRuntime} from './runtime.mjs';

const initial=Date.now(),bot='551100000099@s.whatsapp.net',peer='551100000001@s.whatsapp.net';
const channel={id:'authorized',instance:'koa-test',group_jid:'123@g.us',actor_id:'actor',workspace_id:'workspace',
 activated_at:new Date(initial-60000).toISOString(),conversations_enabled:true,tasks_enabled:true,tasks_activated_at:new Date(initial-60000).toISOString()};
const raw=(id,text,remoteJid=peer,at=initial)=>({key:{id,remoteJid},message:{conversation:text},messageTimestamp:Math.floor(at/1000)});
const event=data=>({instance:channel.instance,event:'messages.upsert',data});
const response=(create=false)=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({
 should_reply:true,replies:create?[]:[{topic:'Pedido',text:'Como posso ajudar com esse pedido?'}],intent:create?'create':'conversation',
 tasks:create?[{sector:'comercial',title:'Revisar procedimento interno',description:'Revisar procedimento interno.',operational_code:'',due_date:'',priority:'medium',route_source:'explicit',route_evidence:'para Comercial'}]:[],
 group_action:{kind:'none',names:[],everyone:false},
})}]}]})});
async function until(predicate){const deadline=Date.now()+4000;while(!predicate()){if(Date.now()>deadline)assert.fail('condition did not complete');await new Promise(r=>setImmediate(r));}}
async function fixture(overrides={}){
 const inbox=new Inbox(':memory:'),sent=[],queries=[],inputs=[],network=[];let clock=initial,current=[channel];
 const runtime=new WhatsAppRuntime({inbox,now:()=>clock,privateMessages:true,privateActivatedAt:new Date(initial-10000).toISOString(),privatePolicy:'koa_call',groupMessages:false,
  loadChannels:async()=>current,
  query:async(sql,params)=>{queries.push({sql,params});return sql.includes('koa_whatsapp_create_tasks')?{rows:[{results:[{status:'created',task_id:'actual-task'}]}]}:{rows:[{value:{api_key:'fixture',model:'configured-model'}}]};},
  evolution:async(route,options)=>{
   network.push(route);
   if(route.startsWith('/instance/connectionState'))return {instance:{state:'open'}};
   if(route.startsWith('/instance/fetchInstances'))return [{name:channel.instance,ownerJid:bot}];
   if(route.startsWith('/message/sendText')){sent.push(JSON.parse(options.body));return {key:{id:'sent-'+sent.length}};}
   throw Error('NO_GROUP_OR_CONTACT_ACCESS');
  },
  fetchAI:async(url,options)=>{inputs.push(JSON.parse(options.body));return response();},...overrides});
 await runtime.heartbeat();
 return {runtime,inbox,sent,queries,inputs,network,setClock:value=>{clock=value;},setChannels:value=>{current=value;},close:async()=>{await runtime.stop();inbox.close();}};
}

test('any new private peer must call KOA first; public mode never queries group members or contacts',async()=>{
 const f=await fixture();try{
  assert.equal(await f.runtime.accept(event(raw('silent','Bom dia'))),0);
  assert.equal(await f.runtime.accept(event(raw('substring','Gosto de koalas'))),0);
  assert.equal(await f.runtime.accept(event(raw('call','Oi KOA!'))),1);await until(()=>f.sent.length===1);
  assert.equal(f.sent[0].number,peer);assert.equal(f.runtime.health().privateReady,true);assert.equal(f.runtime.health().privatePolicy,'koa_call');
  assert.equal(f.runtime.health().groupConversations,false);assert.equal(f.network.some(p=>p.startsWith('/group/')||p.includes('findContacts')),false);
  assert.equal(await f.runtime.accept(event(raw('group','KOA, oi!','123@g.us'))),0);
 }finally{await f.close();}
});

test('a called private session accepts clarification and records exactly one task before its confirmation',async()=>{
 const f=await fixture({fetchAI:async()=>response(true)});try{
  await f.runtime.accept(event(raw('hello','Oi KOA')));await until(()=>f.sent.length===1);
  const task=raw('task','Lance uma tarefa para Comercial revisar o procedimento interno.');
  assert.equal(await f.runtime.accept(event(task)),1);await until(()=>f.sent.length===2);
  assert.match(f.sent[1].text,/tarefa criada para Comercial/);assert.equal(f.sent[1].number,peer);
  assert.equal(f.queries.filter(q=>q.sql.includes('koa_whatsapp_create_tasks')).length,1);
  assert.equal(await f.runtime.accept(event(task)),0);assert.equal(f.sent.length,2);
  assert.equal(f.inbox.stats(null,channel.id).received_count,2);assert.equal(f.inbox.stats(null,channel.id).reply_count,2);
 }finally{await f.close();}
});

test('calls and context stay with each private peer, including LID peers; one call cannot admit another number',async()=>{
 const f=await fixture();try{
  await f.runtime.accept(event(raw('a','KOA, me ajude com um texto.')));await until(()=>f.sent.length===1);
  assert.equal(await f.runtime.accept(event(raw('b-silent','Pode me ajudar?','10002@lid'))),0);
  await f.runtime.accept(event(raw('b','KOA, escreva uma mensagem.','10002@lid')));await until(()=>f.sent.length===2);
  assert.equal(f.sent[1].number,'10002@lid');
  const input=JSON.parse(f.inputs[1].input[0].content);assert.deepEqual(input.contexto.interacoes,[]);
  assert.match(f.inputs[1].instructions,/qualquer número/);assert.doesNotMatch(f.inputs[1].instructions,/Esta conversa é individual com um integrante autorizado/);
 }finally{await f.close();}
});

test('sessions expire after 30 minutes and a new KOA call opens another session',async()=>{
 const f=await fixture();try{
  await f.runtime.accept(event(raw('first','Oi KOA')));await until(()=>f.sent.length===1);
  f.setClock(initial+31*60000);
  assert.equal(await f.runtime.accept(event(raw('expired','Me ajuda com um texto.',peer,initial+31*60000))),0);
  assert.equal(await f.runtime.accept(event(raw('again','Oi KOA',peer,initial+31*60000))),1);await until(()=>f.sent.length===2);
 }finally{await f.close();}
});

test('session storage survives reopening, is scoped by channel/instance/peer, and a new activation invalidates old calls',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'koa-call-')),file=path.join(dir,'inbox.sqlite');let inbox=new Inbox(file);
 try{
  inbox.activatePrivateCall('channel','instance',peer,initial);inbox.close();inbox=new Inbox(file);
  assert.equal(inbox.privateCallAllowed('channel','instance',peer,initial,initial-1,initial),true);
  for(const args of [['other','instance',peer],['channel','other',peer],['channel','instance','10002@lid']])assert.equal(inbox.privateCallAllowed(...args,initial,initial-1,initial),false);
  assert.equal(inbox.privateCallAllowed('channel','instance',peer,initial+2000,initial+1000,initial+2000),false);
  inbox.activatePrivateCall('channel','instance',peer,initial+2000,initial+1000);
  assert.equal(inbox.privateCallAllowed('channel','instance',peer,initial+2000,initial+1000,initial+2000),true);
 }finally{
  inbox.close();const target=fs.realpathSync(dir);
  assert.equal(path.dirname(target),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(target).startsWith('koa-call-'));
  fs.rmSync(target,{recursive:true,force:true});
 }
});

test('two consecutive calls do not revoke the first queued request; history and outbound echoes never initiate a session',async()=>{
 const f=await fixture();try{
  assert.equal(await f.runtime.accept(event([raw('call1','KOA, preciso de ajuda.'),raw('call2','KOA, pode explicar?',peer,initial+1000)])),2);
  await until(()=>f.sent.length===2);
  assert.equal(await f.runtime.accept(event(raw('old','Oi KOA','10003@lid',initial-60000))),0);
  const out=raw('echo','Oi KOA','10003@lid');out.key.fromMe=true;
  assert.equal(await f.runtime.accept(event(out)),0);
  assert.equal(await f.runtime.accept({...event(raw('wrong','Oi KOA','10003@lid')),instance:'another'}),0);
 }finally{await f.close();}
});

test('pause during inference revokes a public private request before task creation or sending',async()=>{
 const blocked=Promise.withResolvers();let started=false;
 const f=await fixture({fetchAI:async()=>{started=true;await blocked.promise;return response(true);}});try{
  await f.runtime.accept(event(raw('pending','KOA, lance uma tarefa para Comercial revisar o procedimento.')));await until(()=>started);
  f.setChannels([{...channel,conversations_enabled:false}]);blocked.resolve();
  await until(()=>f.inbox.db.prepare('SELECT state FROM inbox WHERE id=?').get('pending')?.state==='ignored');
  assert.equal(f.sent.length,0);assert.equal(f.queries.some(q=>q.sql.includes('koa_whatsapp_create_tasks')),false);
 }finally{blocked.resolve();await f.close();}
});

test('public requests cannot silently move to another workspace or retain authorization after reverting to group-members policy',async()=>{
 const f=await fixture({loadChannels:async()=>[channel,{...channel,id:'other',group_jid:'456@g.us'}]});try{
  assert.equal(await f.runtime.accept(event(raw('ambiguous','KOA, lance uma tarefa.'))),0);assert.equal(f.runtime.health().privateReady,false);
 }finally{await f.close();}
 const g=await fixture();try{
  await g.runtime.accept(event(raw('called','Oi KOA')));await until(()=>g.sent.length===1);
  const m=JSON.parse(g.inbox.db.prepare('SELECT payload FROM inbox WHERE id=?').get('called').payload);
  g.runtime.privatePolicy='group_members';assert.equal(await g.runtime.privateAllowed(m,channel,bot),false);
 }finally{await g.close();}
});
