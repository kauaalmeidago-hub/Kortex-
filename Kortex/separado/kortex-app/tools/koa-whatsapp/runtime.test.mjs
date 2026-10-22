import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Inbox} from './core.mjs';
import {WhatsAppRuntime} from './runtime.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate) {
 const deadline=Date.now()+4000;
 while(!predicate()){if(Date.now()>deadline)assert.fail('condition did not complete');await tick();}
}
const now=Date.now();
const channel=(id='a')=>({id,instance:'instance-'+id,group_jid:id+'@g.us',actor_id:'actor-'+id,workspace_id:'workspace-'+id,
 activated_at:new Date(now-10000).toISOString(),conversations_enabled:true,tasks_enabled:false});
const message=(id,group='a',participant=id,text='KOA, pode explicar esta dúvida?')=>({
 key:{id,remoteJid:group+'@g.us',participant:participant+'@lid'},message:{conversation:text},messageTimestamp:Math.floor(now/1000),
});
const event=(data,group='a')=>({instance:'instance-'+group,event:'messages.upsert',data});
const aiResponse=(text='Orientação pronta.')=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',
 text:JSON.stringify({should_reply:true,replies:[{topic:'Orientação',text}],group_action:{kind:'none',names:[],everyone:false}})}]}]})});
async function fixture(overrides={}) {
 const inbox=new Inbox(':memory:'),sent=[],queries=[];
 const runtime=new WhatsAppRuntime({inbox,loadChannels:async()=>[channel()],query:async(sql,params)=>{
  queries.push({sql,params});return {rows:[{value:{api_key:'test-only-key',model:'configured-model'}}]};
 },evolution:async(path,options)=>{
  if(path.startsWith('/instance/connectionState/'))return {instance:{state:'open'}};
  if(path.startsWith('/instance/fetchInstances'))return [channel('a'),channel('b')].map(c=>({name:c.instance,ownerJid:'bot@s.whatsapp.net'}));
  if(path.startsWith('/message/sendText/')){sent.push({path,...JSON.parse(options.body)});return {key:{id:'out-'+sent.length}};}
  throw Error('UNEXPECTED_TRANSPORT');
 },fetchAI:async()=>aiResponse(),...overrides});
 await runtime.heartbeat();
 return {inbox,runtime,sent,queries,close:async()=>{await runtime.stop();inbox.close();}};
}

test('an actual slow model response does not delay other participants, their greetings or another group',async()=>{
 const slow=Promise.withResolvers(),started=[],contexts=[];
 const f=await fixture({loadChannels:async()=>[channel(),channel('b')],fetchAI:async(url,options)=>{
  const request=JSON.parse(options.body),input=JSON.parse(request.input[0].content);
  started.push(input.mensagem);contexts.push(input.contexto);
  if(input.mensagem.includes('lenta'))await slow.promise;
  return aiResponse(input.mensagem);
 }});
 try {
  assert.equal(await f.runtime.accept(event(message('slow','a','person','KOA, explique a solicitação lenta.'))),1);
  await until(()=>started.length===1);
  assert.equal(await f.runtime.accept(event([
   message('same-person','a','person','Pode detalhar a resposta anterior?'),
   message('fast','a','other','KOA, explique a solicitação rápida.'),
   message('greeting','a','greeting','Oi Koa!'),
  ])),3);
  assert.equal(await f.runtime.accept(event(message('another-group','b','person'),'b')),1);
  await until(()=>f.sent.length===5); // 3 opening parts + 2 independent answers
  assert.equal(started.length,3);assert.equal(f.sent.some(s=>s.text.includes('lenta')),false);
  assert.equal(f.sent.filter(s=>s.number==='b@g.us').length,1);
  assert.equal(f.inbox.db.prepare("SELECT state FROM inbox WHERE id='same-person'").get().state,'pending');
  slow.resolve();await until(()=>f.sent.length===7);
  assert.equal(started.at(-1),'Pode detalhar a resposta anterior?');
  assert.match(contexts.at(-1).interacoes[0].koa,/lenta/);
  assert.equal(contexts[1].interacoes.length,0);
  assert.equal(f.inbox.stats('b@g.us').reply_count,1);
  assert.equal(f.runtime.health().concurrency,8);
 }finally{slow.resolve();await f.close();}
});

test('connection heartbeat IO never blocks a cached webhook or reply processing',async()=>{
 const f=await fixture(),blocked=Promise.withResolvers(),original=f.runtime.evolution;
 try {
  f.runtime.evolution=async(path,options)=>path.startsWith('/instance/connectionState/')?blocked.promise:original(path,options);
  const heartbeat=f.runtime.heartbeat();await tick();
  assert.equal(await f.runtime.accept(event(message('fast'))),1);
  await until(()=>f.sent.length===1);
  blocked.resolve({instance:{state:'open'}});await heartbeat;
 }finally{blocked.resolve({instance:{state:'open'}});await f.close();}
});

test('durable webhook reception does not wait for a remote configuration refresh',async()=>{
 let clock=now;
 const f=await fixture({now:()=>clock}),blocked=Promise.withResolvers();
 try {
  clock+=2000; // Expire the processing cache, like a message after a quiet period.
  f.runtime.loadChannels=async()=>blocked.promise;
  const refreshing=f.runtime.refresh(true);
  const result=await Promise.race([f.runtime.accept(event(message('received'))),tick().then(()=> 'blocked')]);
  assert.equal(result,1);
  assert.equal(f.inbox.db.prepare("SELECT state FROM inbox WHERE id='received'").get().state,'pending');
  blocked.resolve([channel()]);await refreshing;
  await until(()=>f.sent.length===1);
 }finally{blocked.resolve([channel()]);await f.close();}
});

test('a previously paused channel refreshes on reception so its first message after activation is accepted',async()=>{
 const f=await fixture({loadChannels:async()=>[{...channel(),conversations_enabled:false}]});
 try {
  f.runtime.loadChannels=async()=>[channel()];
  assert.equal(await f.runtime.accept(event(message('first-after-activation'))),1);
  await until(()=>f.sent.length===1);
 }finally{await f.close();}
});

test('pause or revocation while the model is running suppresses the external reply',async()=>{
 const slow=Promise.withResolvers();let current=channel(),started=false;
 const f=await fixture({loadChannels:async()=>current?[current]:[],fetchAI:async()=>{started=true;await slow.promise;return aiResponse();}});
 try {
  await f.runtime.accept(event(message('revoked')));await until(()=>started);
  current=null;slow.resolve();await until(()=>f.runtime.scheduler.active.size===0);
  assert.equal(f.sent.length,0);assert.equal(f.inbox.db.prepare("SELECT state FROM inbox WHERE id='revoked'").get().state,'ignored');
 }finally{slow.resolve();await f.close();}
});

test('parallel replies reserve the last group rate slot once and a different group still sends',async()=>{
 const blocked=Promise.withResolvers(),f=await fixture({loadChannels:async()=>[channel(),channel('b')]});
 try {
  for(let i=0;i<24;i++){
   f.inbox.db.prepare('INSERT INTO inbox(id,group_jid,participant,text,ts,payload,received_at) VALUES(?,?,?,?,?,?,?)')
    .run('seed-'+i,'a@g.us','seed-'+i,'seed',Math.floor(now/1000),'{}',now);
   f.inbox.plan('seed-'+i,['already sent']);const part=f.inbox.nextPart('seed-'+i);f.inbox.sending(part);f.inbox.sent(part,'seed-out-'+i);
  }
  const original=f.runtime.evolution;
  f.runtime.evolution=async(path,options)=>{
   if(path.startsWith('/message/sendText/')&&JSON.parse(options.body).number==='a@g.us'){
    f.sent.push({path,...JSON.parse(options.body)});await blocked.promise;return {key:{id:'last-group-slot'}};
   }
   return original(path,options);
  };
  await f.runtime.accept(event([message('one'),message('two')]));
  await f.runtime.accept(event(message('other','b'),'b'));
  await until(()=>f.sent.some(s=>s.number==='b@g.us')&&f.inbox.db.prepare("SELECT count(*) n FROM inbox WHERE error_code='RATE_LIMIT'").get().n===1);
  assert.equal(f.sent.filter(s=>s.number==='a@g.us').length,1);
  blocked.resolve();await until(()=>f.runtime.scheduler.active.size===0);
 }finally{blocked.resolve();await f.close();}
});

test('uncertain sends do not resend, duplicated webhooks do not regenerate, and the next person continues',async()=>{
 const f=await fixture();try {
  const original=f.runtime.evolution;
  f.runtime.evolution=async(path,options)=>{
   if(path.startsWith('/message/sendText/')&&JSON.parse(options.body).quoted.key.id==='uncertain')throw Error('TIMEOUT');
   return original(path,options);
  };
  await f.runtime.accept(event([message('uncertain'),message('working')]));
  await until(()=>f.runtime.scheduler.active.size===0&&f.sent.length===1);
  assert.equal(f.inbox.db.prepare("SELECT state FROM inbox WHERE id='uncertain'").get().state,'uncertain');
  assert.equal(await f.runtime.accept(event(message('working'))),0);
  f.runtime.scheduler.wake();await tick();assert.equal(f.sent.length,1);
 }finally{await f.close();}
});

test('conflicting chat routes fail closed and channels outside the allowlist never enter the inbox',async()=>{
 const f=await fixture();try {
  assert.equal(await f.runtime.accept(event(message('unknown','b'),'b')),0);
  f.runtime.loadChannels=async()=>[channel(),{...channel('b'),group_jid:'a@g.us'}];
  await assert.rejects(f.runtime.refresh(true),/CHANNEL_ROUTE_CONFLICT/);
  assert.equal(f.inbox.stats().received_count,0);
 }finally{await f.close();}
});

test('an attachment is read before creating a task and only the database result confirms it',async()=>{
 const bytes=Buffer.from('Preparar nova cotação da Empresa A'),task={sector:'comercial',title:'Preparar cotação da Empresa A',description:'Preparar nova cotação.',operational_code:'',due_date:'',priority:'medium',route_source:'responsibility',route_evidence:'Preparar nova cotação'};
 let input;
 const f=await fixture({loadChannels:async()=>[{...channel(),tasks_enabled:true,tasks_activated_at:new Date(now-10000).toISOString()}],fetchAI:async(url,options)=>{
  const request=JSON.parse(options.body);input=request.input[0].content;
  return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({
   should_reply:true,replies:[],intent:'create',tasks:[task],group_action:{kind:'none',names:[],everyone:false},
   file_reviews:[{id:'attachment',readable:true,summary:'Cotação da Empresa A.',evidence:'Preparar nova cotação',issues:[]}],
  })}]}]})};
 }});
 try{
  const original=f.runtime.evolution;
  f.runtime.evolution=async(path,options)=>path.startsWith('/chat/getBase64FromMediaMessage/')?{base64:bytes.toString('base64')}:original(path,options);
  const query=f.runtime.query;
  f.runtime.query=async(sql,params)=>sql.includes('koa_whatsapp_create_tasks')?{rows:[{results:[{status:'created',task_id:'real-task'}]}]}:query(sql,params);
  const upload=message('attachment');upload.message={documentMessage:{fileName:'pedido.txt',mimetype:'text/plain',fileLength:bytes.length,caption:'KOA, crie a tarefa descrita no anexo'}};
  await f.runtime.accept(event(upload));await until(()=>f.sent.length===1);
  assert.equal(input[1].type,'input_file');assert.match(f.sent[0].text,/tarefa criada para Comercial/);
  assert.equal(f.inbox.taskDecision('attachment').tasks[0].sector,'comercial');
  assert.equal(f.inbox.context({...JSON.parse(f.inbox.db.prepare("SELECT payload FROM inbox WHERE id='attachment'").get().payload),id:'next'}).arquivos_lidos.length,1);
 }finally{await f.close();}
});

test('unreadable attachment reviews suppress database actions and send one correction request',async()=>{
 const f=await fixture({loadChannels:async()=>[{...channel(),tasks_enabled:true,tasks_activated_at:new Date(now-10000).toISOString()}],fetchAI:async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({
  file_reviews:[{id:'unreadable',readable:false,summary:'Documento ilegível.',evidence:'',issues:['O conteúdo não pode ser lido.']}],
 })}]}]})})});
 try{
  const original=f.runtime.evolution;
  f.runtime.evolution=async(path,options)=>path.startsWith('/chat/getBase64FromMediaMessage/')?{base64:Buffer.from('unknown').toString('base64')}:original(path,options);
  const upload=message('unreadable');upload.message={documentMessage:{fileName:'pedido.txt',mimetype:'text/plain',fileLength:7,caption:'KOA, crie a tarefa descrita no anexo'}};
  await f.runtime.accept(event(upload));await until(()=>f.sent.length===1);
  assert.match(f.sent[0].text,/ilegível/);assert.equal(f.queries.some(q=>q.sql.includes('koa_whatsapp_create_tasks')),false);
  assert.equal(f.inbox.taskDecision('unreadable'),null);
 }finally{await f.close();}
});
