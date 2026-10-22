import {test} from 'node:test';import assert from 'node:assert/strict';
import {Inbox} from './core.mjs';import {WhatsAppRuntime} from './runtime.mjs';
import {parseGroupRoutes,expandGroupRoutes} from './routes.mjs';
const now=Date.now(),bot='551199999999@s.whatsapp.net';
const parent={id:'same-authorized-channel',instance:'koa-test',workspace_id:'same-workspace',actor_id:'actor',board_id:'same-board',group_jid:'123@g.us',group_name:'Comercial',conversations_enabled:true,tasks_enabled:false,activated_at:new Date(now-100000).toISOString()};
const extra={channel_id:parent.id,group_jid:'456@g.us',group_name:'Movimentação Alaive',activated_at:new Date(now-50000).toISOString()};
const channels=expandGroupRoutes([parent],parseGroupRoutes(JSON.stringify([extra])));
const raw=(id,chat,text)=>({key:{id,remoteJid:chat,...(chat.endsWith('@g.us')?{participant:'10001@lid'}:{})},message:{conversation:text},messageTimestamp:Math.floor(now/1000)});
const event=data=>({instance:parent.instance,event:'messages.upsert',data});
const response=text=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({should_reply:true,replies:[{topic:'Conversa',text}],group_action:{kind:'none',names:[],everyone:false}})}]}]})});
async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)assert.fail('condition did not complete');await new Promise(r=>setImmediate(r));}}
async function fixture(fetchAI){
 const inbox=new Inbox(':memory:'),sent=[],updates=[];
 const runtime=new WhatsAppRuntime({inbox,privateMessages:true,privateActivatedAt:new Date(now-60000).toISOString(),loadChannels:async()=>channels,fetchAI,
  query:async(sql,params)=>{if(sql.startsWith('UPDATE'))updates.push(params);return {rows:[{value:{api_key:'fixture',model:'configured'}}]};},
  evolution:async(path,options)=>{
   if(path.startsWith('/instance/connectionState'))return {instance:{state:'open'}};
   if(path.startsWith('/instance/fetchInstances'))return [{name:parent.instance,ownerJid:bot}];
   if(path.startsWith('/group/participants'))return {participants:[{id:'10001@lid',phoneNumber:'551100000001@s.whatsapp.net'},...(path.includes('456')?[{id:'10002@lid',phoneNumber:'551100000002@s.whatsapp.net'}]:[])]};
   if(path.startsWith('/chat/findContacts'))return [{remoteJid:'551100000001@s.whatsapp.net',pushName:'Cristiano'},{remoteJid:'551100000002@s.whatsapp.net',pushName:'Jean'}];
   if(path.startsWith('/message/sendText')){sent.push(JSON.parse(options.body));return {key:{id:'out-'+sent.length}};}
   throw Error('UNEXPECTED_TRANSPORT');
  }});
 await runtime.heartbeat();return {inbox,runtime,sent,updates,close:async()=>{await runtime.stop();inbox.close();}};
}
test('an extra group inherits the same authorized destinations and pause state; invalid or conflicting routes fail closed',()=>{
 assert.equal(channels.length,2);assert.equal(channels[1].id,parent.id);assert.equal(channels[1].board_id,parent.board_id);assert.equal(channels[1].group_name,'Movimentação Alaive');
 assert.equal(expandGroupRoutes([{...parent,conversations_enabled:false}],[extra])[1].conversations_enabled,false);
 assert.equal(expandGroupRoutes([],[extra]).length,0);
 assert.throws(()=>parseGroupRoutes(JSON.stringify([{...extra,group_jid:'person@s.whatsapp.net'}])));
 assert.throws(()=>expandGroupRoutes([parent],[{...extra,group_jid:parent.group_jid}]));
});
test('one slow conversation does not block the same participant in the other group or a private user',async()=>{
 const blocked=Promise.withResolvers(),started=[];
 const f=await fixture(async(url,options)=>{const input=JSON.parse(JSON.parse(options.body).input[0].content);started.push(input.mensagem);if(input.mensagem.includes('lenta'))await blocked.promise;return response(input.mensagem);});
 try{
  await f.runtime.accept(event(raw('slow','123@g.us','Koa, explique a solicitação lenta.')));await until(()=>started.length===1);
  await f.runtime.accept(event([raw('movement','456@g.us','Koa, explique a movimentação.'),raw('private','10002@lid','Me ajude com um texto.')]));
  await until(()=>f.sent.length===2);
  assert.ok(f.sent.some(m=>m.number==='456@g.us'));assert.ok(f.sent.some(m=>m.number==='551100000002@s.whatsapp.net'));
  assert.equal(f.sent.some(m=>m.text.includes('lenta')),false);
  blocked.resolve();await until(()=>f.sent.length===3);assert.equal(f.runtime.health().channels,2);
 }finally{blocked.resolve();await f.close();}
});
test('members common to both groups retain private access and membership caches stay distinct',async()=>{
 const f=await fixture(async()=>response('Resposta privada.'));
 try{
  assert.equal(f.runtime.privateDirectories.size,2);
  assert.equal((await f.runtime.privateMembers(channels[0],bot)).length,1);
  assert.equal((await f.runtime.privateMembers(channels[1],bot)).length,2);
  assert.equal(await f.runtime.accept(event(raw('shared','10001@lid','Pode me ajudar?'))),1);await until(()=>f.sent.length===1);
  assert.equal(f.sent[0].number,'551100000001@s.whatsapp.net');
  assert.equal(f.updates.length,1); // One status row for the shared real channel.
 }finally{await f.close();}
});
test('source messages remain in their group and never leak into another group context',async()=>{
 const contexts=[];const f=await fixture(async(url,options)=>{contexts.push(JSON.parse(JSON.parse(options.body).input[0].content).contexto);return response('Recebido.');});
 try{
  await f.runtime.accept(event(raw('commercial','123@g.us','Koa, analise a Empresa A.')));await until(()=>f.sent.length===1);
  await f.runtime.accept(event(raw('movement','456@g.us','Koa, analise a Empresa B.')));await until(()=>f.sent.length===2);
  assert.equal(contexts[1].interacoes.length,0);assert.equal(f.sent[1].number,'456@g.us');
 }finally{await f.close();}
});
