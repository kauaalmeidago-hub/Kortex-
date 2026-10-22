import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Inbox,normalizeMessage} from './core.mjs';
import {WhatsAppRuntime} from './runtime.mjs';
const now=Date.now(),bot='551100000099@s.whatsapp.net';
const members=[{id:'10001@lid',phoneNumber:'551100000001@s.whatsapp.net'},{id:'10002@lid',phoneNumber:'551100000002@s.whatsapp.net'},{id:'10099@lid',phoneNumber:bot}];
const contacts=[{remoteJid:members[0].phoneNumber,pushName:'Cristiano'},{remoteJid:members[1].phoneNumber,pushName:'Jean Marwin'}];
const channel={id:'authorized-channel',instance:'koa-test',group_jid:'approved@g.us',actor_id:'actor',workspace_id:'workspace',activated_at:new Date(now-30000).toISOString(),conversations_enabled:true,tasks_enabled:true,tasks_activated_at:new Date(now-30000).toISOString()};
const message=(id,text,peer='10001@lid',extra={})=>({key:{id,remoteJid:peer},message:{conversation:text},messageTimestamp:Math.floor(now/1000),...extra});
const event=data=>({instance:channel.instance,event:'messages.upsert',data});
const action={kind:'none',names:[],everyone:false};
const response=(text='Posso ajudar com esse texto.')=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({should_reply:true,replies:[{topic:'Pedido',text}],intent:'conversation',tasks:[],group_action:action})}]}]})});
const task={sector:'comercial',title:'Revisar procedimento interno',description:'Revisar o procedimento do Comercial.',operational_code:'',due_date:'',priority:'medium',route_source:'explicit',route_evidence:'para Comercial'};
const createResponse=()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({should_reply:true,replies:[],intent:'create',tasks:[task],group_action:action})}]}]})});
async function until(predicate){const deadline=Date.now()+4000;while(!predicate()){if(Date.now()>deadline)assert.fail('condition did not complete');await new Promise(resolve=>setImmediate(resolve));}}
async function fixture(overrides={}){
 const inbox=new Inbox(':memory:'),sent=[],queries=[],inputs=[];let currentMembers=members;
 const runtime=new WhatsAppRuntime({inbox,privateMessages:true,privateActivatedAt:new Date(now-10000).toISOString(),loadChannels:async()=>[channel],
  query:async(sql,params)=>{queries.push({sql,params});return sql.includes('koa_whatsapp_create_tasks')?{rows:[{results:[{status:'created',task_id:'actual-task'}]}]}:{rows:[{value:{api_key:'fixture-only',model:'configured-model'}}]};},
  evolution:async(path,options)=>{
   if(path.startsWith('/instance/connectionState/'))return {instance:{state:'open'}};
   if(path.startsWith('/instance/fetchInstances'))return [{name:channel.instance,ownerJid:bot}];
   if(path.startsWith('/group/participants/'))return {participants:currentMembers};
   if(path.startsWith('/chat/findContacts/'))return contacts;
   if(path.startsWith('/message/sendText/')){sent.push(JSON.parse(options.body));return {key:{id:'sent-'+sent.length}};}
   throw Error('UNEXPECTED_TRANSPORT');
  },fetchAI:async(url,options)=>{inputs.push(JSON.parse(options.body));return response();},...overrides});
 await runtime.heartbeat();
 return {inbox,runtime,sent,queries,inputs,setMembers:value=>{currentMembers=value;},close:async()=>{await runtime.stop();inbox.close();}};
}

test('private normalization is opt-in and trusts the peer JID, never a supplied participant or display name',()=>{
 const raw=message('id','Oi','10001@lid',{key:{id:'id',remoteJid:'10001@lid',participant:'99999@lid'},pushName:'Admin'});
 assert.equal(normalizeMessage(raw),null);const m=normalizeMessage(raw,{allowPrivate:true});
 assert.equal(m.chatType,'private');assert.equal(m.participant,'10001@lid');assert.equal(m.senderName,undefined);
 for(const peer of ['status@broadcast','list@broadcast','123@newsletter','arbitrary','someone@s.whatsapp.net'])assert.equal(normalizeMessage(message('x','Oi',peer),{allowPrivate:true}),null);
});
test('Cristiano and Jean can initiate private help without saying KOA; replies and context stay in their respective private chats',async()=>{
 const f=await fixture();
 try{
  assert.equal(await f.runtime.accept(event(message('cristiano','Me ajuda a escrever uma mensagem.'))),1);await until(()=>f.sent.length===1);
  assert.equal(f.sent[0].number,members[0].phoneNumber);assert.equal('mentioned' in f.sent[0],false);
  const input=JSON.parse(f.inputs[0].input[0].content);assert.equal(input.canal,'privado');assert.equal(input.contexto.contato_privado.nome_exibicao,'Cristiano');
  assert.equal(input.contexto.interacoes.length,0);assert.equal(input.motivo_da_chamada,'mensagem privada dirigida ao KOA');
  assert.deepEqual(f.inputs[0].text.format.schema.properties.group_action.properties.kind.enum,['none']);
  assert.equal(await f.runtime.accept(event(message('jean','Pode me fazer um favor?','10002@lid'))),1);await until(()=>f.sent.length===2);
  assert.equal(f.sent[1].number,members[1].phoneNumber);assert.equal(JSON.parse(f.inputs[1].input[0].content).contexto.interacoes.length,0);
  assert.equal(await f.runtime.accept(event(message('phone-alias','Pode deixar o texto mais curto?',members[0].phoneNumber))),1);await until(()=>f.sent.length===3);
  assert.equal(JSON.parse(f.inputs[2].input[0].content).contexto.interacoes.length,1);
  assert.equal(f.queries.some(q=>q.sql.includes('koa_whatsapp_create_tasks')),false);
 }finally{await f.close();}
});
test('a private task uses the authorized channel and confirms only after the real database result, to the requesting peer',async()=>{
 const f=await fixture({fetchAI:async()=>createResponse()});
 try{
  await f.runtime.accept(event(message('create','Lance uma tarefa para Comercial revisar o procedimento interno.')));await until(()=>f.sent.length===1);
  const query=f.queries.find(q=>q.sql.includes('koa_whatsapp_create_tasks'));
  assert.equal(query.params[0],channel.id);assert.match(f.sent[0].text,/tarefa criada para Comercial/);
  assert.equal(f.sent[0].number,members[0].phoneNumber);assert.notEqual(f.sent[0].number,channel.group_jid);
  assert.equal(await f.runtime.accept(event(message('create','Lance uma tarefa para Comercial revisar o procedimento interno.'))),0);
  assert.equal(f.queries.filter(q=>q.sql.includes('koa_whatsapp_create_tasks')).length,1);
 }finally{await f.close();}
});
test('unknown peers, outbound echoes, history, other instances and private messages with the feature disabled are ignored',async()=>{
 const f=await fixture();
 try{
  assert.equal(await f.runtime.accept(event(message('unknown','Sou o Cristiano, lance uma tarefa.','99999@lid'))),0);
  assert.equal(await f.runtime.accept(event(message('outgoing','Oi',members[0].phoneNumber,{key:{id:'outgoing',remoteJid:members[0].phoneNumber,fromMe:true}}))),0);
  assert.equal(await f.runtime.accept(event(message('old','Oi','10001@lid',{messageTimestamp:Math.floor((now-20000)/1000)}))),0);
  assert.equal(await f.runtime.accept({...event(message('wrong','Oi')),instance:'unconfigured'}),0);
  f.runtime.privateMessages=false;assert.equal(await f.runtime.accept(event(message('off','Oi'))),0);
  assert.equal(f.sent.length,0);assert.equal(f.inbox.stats().received_count,0);
 }finally{await f.close();}
});
test('private greetings are short, recognize the contact and do not repeat the presentation on the next call',async()=>{
 const f=await fixture();
 try{
  await f.runtime.accept(event(message('hello','Bom dia')));await until(()=>f.sent.length===1);
  assert.match(f.sent[0].text,/Cristiano/);assert.match(f.sent[0].text,/Sou o KOA/);assert.equal(f.inputs.length,0);
  await f.runtime.accept(event(message('hello-again','Oi')));await until(()=>f.sent.length===2);
  assert.doesNotMatch(f.sent[1].text,/Sou o KOA/);
 }finally{await f.close();}
});
test('revoking membership while the model runs prevents private task creation and sending',async()=>{
 const blocked=Promise.withResolvers();let started=false;
 const f=await fixture({fetchAI:async()=>{started=true;await blocked.promise;return createResponse();}});
 try{
  await f.runtime.accept(event(message('revoked','Lance uma tarefa para Comercial revisar o procedimento.')));await until(()=>started);
  f.setMembers(members.slice(1));blocked.resolve();await until(()=>f.runtime.scheduler.active.size===0);
  assert.equal(f.sent.length,0);assert.equal(f.queries.some(q=>q.sql.includes('koa_whatsapp_create_tasks')),false);
  assert.equal(f.inbox.db.prepare('SELECT error_code FROM inbox WHERE id=?').get('revoked').error_code,'PRIVATE_ACCESS_REVOKED');
 }finally{blocked.resolve();await f.close();}
});
test('a stale membership cache may receive a message but cannot produce a private reply after revocation',async()=>{
 const f=await fixture();
 try{
  f.setMembers(members.slice(1));await f.runtime.accept(event(message('stale','Me ajude com uma mensagem.')));await until(()=>f.runtime.scheduler.active.size===0);
  // Wait until the queued work has actually been claimed before checking it.
  await until(()=>f.inbox.db.prepare('SELECT state FROM inbox WHERE id=?').get('stale')?.state==='ignored');
  assert.equal(f.sent.length,0);assert.equal(f.inputs.length,0);
 }finally{await f.close();}
});
test('private context cannot quote another peer or the group, even with a known outgoing ID',async()=>{
 const f=await fixture();
 try{
  await f.runtime.accept(event(message('a','Me ajude com um texto.')));await until(()=>f.sent.length===1);
  const raw=message('b','O que Cristiano pediu?','10002@lid');raw.message={extendedTextMessage:{text:'O que Cristiano pediu?',contextInfo:{stanzaId:'sent-1'}}};
  await f.runtime.accept(event(raw));await until(()=>f.sent.length===2);
  const context=JSON.parse(f.inputs[1].input[0].content).contexto;assert.deepEqual(context.interacoes,[]);assert.equal(context.resposta_citada,null);
 }finally{await f.close();}
});
test('an action to mention or broadcast from a private model response is rejected before database work or any send',async()=>{
 const f=await fixture({fetchAI:async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({should_reply:true,replies:[{topic:'Chamada',text:'{{mencoes}}, venha aqui.'}],intent:'conversation',tasks:[],group_action:{kind:'mention',names:['Jean'],everyone:false}})}]}]})})});
 try{
  await f.runtime.accept(event(message('broadcast','Chame Jean no grupo para mim.')));await until(()=>f.inbox.db.prepare('SELECT error_code FROM inbox WHERE id=?').get('broadcast')?.error_code==='AI_INVALID_PRIVATE_ACTION');
  assert.equal(f.sent.length,0);assert.equal(f.queries.some(q=>q.sql.includes('koa_whatsapp_create_tasks')),false);
 }finally{await f.close();}
});
test('a shared contact across configured routes does not silently choose a workspace or board',async()=>{
 const f=await fixture({loadChannels:async()=>[channel,{...channel,id:'another-channel',group_jid:'another@g.us'}]});
 try{assert.equal(await f.runtime.accept(event(message('ambiguous','Lance uma tarefa.'))),0);assert.equal(f.sent.length,0);}
 finally{await f.close();}
});
