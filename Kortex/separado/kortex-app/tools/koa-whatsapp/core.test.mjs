import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Inbox,normalizeMessage,directCall,referencesKoa,validSecret,modelRequest,parseReply,localGreeting,greetingReplies} from './core.mjs';
const now=Date.now(),config={instance:'koa-test',group_jid:'test@g.us',activated_at:new Date(now-2000).toISOString()};
const message=(id='one',extra={})=>({key:{id,remoteJid:'test@g.us',participant:'person@s.whatsapp.net'},message:{conversation:'KOA, bom dia!'},messageTimestamp:Math.floor(now/1000),...extra});
const event=data=>({event:'messages.upsert',instance:'koa-test',data});
test('authenticated header comparison rejects absent, truncated and different secrets',()=>{
 const s='a'.repeat(64);assert.equal(validSecret(s,s),true);for(const bad of [undefined,'','a'.repeat(63),'b'.repeat(64)])assert.equal(validSecret(bad,s),false);
});
test('all batch items are persisted once; private, unknown group, spoofed instance and history are discarded',()=>{
 const q=new Inbox(':memory:');try{
 assert.equal(q.ingest(event([message('a'),message('b')]),config,now),2);assert.equal(q.ingest(event(message('a')),config,now),0);
 assert.equal(q.ingest({...event(message('c')),instance:'other'},config,now),0);
 for(const jid of ['private@s.whatsapp.net','other@g.us'])assert.equal(q.ingest(event(message('x',{key:{id:'x',remoteJid:jid,participant:'p'}})),config,now),0);
 assert.equal(q.ingest(event(message('old',{messageTimestamp:Math.floor((now-90000)/1000)})),config,now),0);
 assert.equal(q.ingest({...event(message('history')),event:'messages.set'},config,now),0);assert.equal(q.stats().received_count,2);
 }finally{q.close();}
});
test('human messages from paired number are accepted; correlated bot outputs are not',()=>{
 const q=new Inbox(':memory:');try{
 assert.equal(q.ingest(event(message('human',{key:{id:'human',remoteJid:'test@g.us',fromMe:true}})),config,now),1);
 q.db.prepare("UPDATE inbox SET state='sending',answer='Bom dia!' WHERE id='human'").run();
 assert.equal(q.ingest(event(message('bot',{key:{id:'bot',remoteJid:'test@g.us',fromMe:true},message:{conversation:'Bom dia!'}})),config,now),0);
 q.db.prepare("UPDATE inbox SET state='sent',outgoing_id='out' WHERE id='human'").run();
 assert.equal(q.ingest(event(message('out',{key:{id:'out',remoteJid:'test@g.us',fromMe:true}})),config,now),0);
 }finally{q.close();}
});
test('direct addressing differs from third-party mention; participants have separate continuation context',()=>{
 assert.equal(directCall('KOA, pode explicar o fluxo?'),true);assert.equal(directCall('Bom dia, koa'),true);assert.equal(directCall('O KOA explicou isso ontem.'),false);assert.equal(directCall('KOA fez isso ontem'),false);
 const q=new Inbox(':memory:');try{q.ingest(event(message()),config,now);q.db.prepare("UPDATE inbox SET state='sent',answer='Olá',outgoing_id='out',sent_at=? WHERE id='one'").run(now);
 const m=normalizeMessage(message('next'));assert.equal(q.reason(m,'bot'), 'chamada direta ao KOA');
 m.text='Pode detalhar?';assert.equal(q.reason(m,'bot',now),'continuação candidata da conversa');m.participant='another';assert.equal(q.reason(m,'bot',now),null);assert.equal(q.context(m).interacoes.length,0);
 m.quoted='out';assert.equal(q.reason(m,'bot',now),'resposta à mensagem do KOA');assert.equal(q.context(m).resposta_citada,'Olá');
 }finally{q.close();}
});
test('conversational request exposes no task tools and validates structured responses',()=>{
 const body=modelRequest('existing-model',normalizeMessage(message()),{},'direct');assert.equal(body.model,'existing-model');assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.match(body.instructions,/SOMENTE em modo de conversa/);
 const response=value=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
 const part=(text,topic='Conversa')=>({topic,text});
 assert.deepEqual(parseReply(response({should_reply:true,replies:[part(' Bom dia! ')]})),{should_reply:true,replies:['Bom dia!']});
 assert.deepEqual(parseReply(response({should_reply:true,replies:[part('Primeira frase.',' Mesma demanda '),part('Complemento.','mesma demanda')]})),{should_reply:true,replies:['Primeira frase. Complemento.']});
 assert.deepEqual(parseReply(response({should_reply:false,replies:[]})),{should_reply:false,replies:[]});
 for(const value of [{should_reply:true,replies:[]},{should_reply:true,replies:[part('')]},{should_reply:true,replies:[part('Texto','')]},{should_reply:false,replies:[part('Resposta indevida')]},{should_reply:true,replies:['a','b','c','d','e'].map(x=>part(x,x))},{should_reply:true,replies:[part('x'.repeat(1601))]},{should_reply:true,reply:'old contract'}])assert.throws(()=>parseReply(response(value)));
 assert.throws(()=>parseReply({status:'incomplete'}));
});

test('welcomes and natural calls from every participant reach classification without a verified profile',()=>{
 const q=new Inbox(':memory:');try{
 const calls=['Bem vindo KOA','Bem-vindo Koa!','Seja bem vindo KOA','Tudo bem Koa?','Obrigado Koa','Consegue me ajudar Koa?','Koa envie uma orientação','Olá pessoal, bem vindo Koa!','👏 KOA 👏'];
 for(const [index,text] of calls.entries()){
  const raw=message('caller-'+index,{key:{id:'caller-'+index,remoteJid:'test@g.us',participant:'new-person-'+index+'@lid'},message:{conversation:text}});
  assert.equal(q.ingest(event(raw),config,now),1);
  const m=JSON.parse(q.claim(now).payload);
  assert.ok(q.reason(m,'bot@s.whatsapp.net',now),text);
  assert.equal(q.context(m).participante_verificado,null);
  q.finish(m.id,'ignored');
 }
 for(const text of calls.slice(0,3))assert.equal(directCall(text),true,text);
 assert.equal(q.stats().received_count,calls.length);
 }finally{q.close();}
});

test('third-person KOA references are classified while unrelated group messages stay out',()=>{
 const q=new Inbox(':memory:');try{
 const m=normalizeMessage(message());
 for(const text of ['O KOA explicou isso ontem.','Fernando, pergunte ao KOA depois.','KOA fez isso ontem']){
  m.text=text;assert.equal(directCall(text),false,text);
  assert.equal(q.reason(m,'bot@s.whatsapp.net',now),'referência ao KOA: verificar destinatário');
 }
 for(const text of ['Bem vindo Fernando','Bom dia pessoal!','koala','koalaive','meu_koa','koa2','ákoa']){
  m.text=text;assert.equal(referencesKoa(text),false,text);assert.equal(q.reason(m,'bot@s.whatsapp.net',now),null,text);
 }
 const instructions=modelRequest('existing-model',m,{},'candidate').instructions;
 assert.match(instructions,/Responda a TODA pessoa/);assert.match(instructions,/Bem vindo KOA/);assert.match(instructions,/entre terceiros/);
 }finally{q.close();}
});
test('topic replies survive restart in order without resending a confirmed part or replacing the saved plan',()=>{
 const dir=mkdtempSync(join(tmpdir(),'koa-outbox-')),file=join(dir,'inbox.sqlite');let q=new Inbox(file);
 try{
  q.ingest(event(message()),config,now);q.claim(now);q.plan('one',['Empresa A: orientação de inclusão.','Empresa B: orientação de cotação.']);
  const first=q.nextPart('one');assert.equal(first.part_index,0);q.sending(first);q.sent(first,'out-A',now);
  assert.equal(q.stats().reply_count,1);assert.equal(q.sendCounts('test@g.us','person@s.whatsapp.net',now).personal,1);
  q.close();q=new Inbox(file);assert.equal(q.claim(now).id,'one');q.plan('one',['Do not replace']);
  const second=q.nextPart('one');assert.equal(second.part_index,1);assert.match(second.text,/Empresa B/);
  const m=normalizeMessage(message('followup',{message:{conversation:'Pode detalhar?'}}));m.quoted='out-A';m.participant='another';
  assert.equal(q.reason(m,'bot',now),'resposta à mensagem do KOA');assert.equal(q.context(m).resposta_citada,first.text);
  assert.equal(q.ingest(event(message('bot-copy',{key:{id:'bot-copy',remoteJid:'test@g.us',fromMe:true},message:{conversation:first.text}})),config,now),0);
  q.sending(second);q.sent(second,'out-B',now+1000);assert.equal(q.nextPart('one'),undefined);assert.equal(q.claim(now+1000),undefined);
  assert.equal(q.stats().reply_count,2);assert.equal(q.sendCounts('test@g.us','person@s.whatsapp.net',now+1000).total,2);
  assert.equal(q.context(normalizeMessage(message('next'))).interacoes[0].koa,[first.text,second.text].join('\n\n'));
 }finally{q.close();rmSync(dir,{recursive:true,force:true});}
});
test('an ambiguous part is never retried automatically, including after restart; retention removes its parts',()=>{
 const dir=mkdtempSync(join(tmpdir(),'koa-uncertain-')),file=join(dir,'inbox.sqlite');let q=new Inbox(file);
 try{
  q.ingest(event(message()),config,now);q.claim(now);q.plan('one',['Primeiro assunto','Segundo assunto']);
  const first=q.nextPart('one');q.sending(first);q.sent(first,'out-A',now);q.claim(now);
  const second=q.nextPart('one');q.sending(second);q.close();q=new Inbox(file);
  assert.equal(q.claim(now),undefined);assert.equal(q.db.prepare('SELECT state FROM inbox').get().state,'uncertain');
  assert.deepEqual(q.db.prepare('SELECT state FROM outbox_parts ORDER BY part_index').all().map(x=>x.state),['sent','uncertain']);
  assert.equal(q.stats().reply_count,1);q.db.prepare('DELETE FROM inbox').run();assert.equal(q.db.prepare('SELECT count(*) n FROM outbox_parts').get().n,0);
 }finally{q.close();rmSync(dir,{recursive:true,force:true});}
});
test('saved legacy replies and rate deferrals keep one immutable send plan',()=>{
 const q=new Inbox(':memory:');try{
  q.ingest(event(message()),config,now);q.claim(now);q.db.prepare('UPDATE inbox SET answer=? WHERE id=?').run('Resposta já preparada','one');
  q.plan('one',['Resposta já preparada']);q.defer('one','RATE_LIMIT',now);assert.equal(q.claim(now),undefined);
  assert.equal(q.claim(now+16000).answer,'Resposta já preparada');assert.equal(q.nextPart('one').text,'Resposta já preparada');
  const p=q.nextPart('one');q.sending(p);q.uncertain(p);assert.equal(q.claim(now+16000),undefined);
 }finally{q.close();}
});
test('rate deferrals do not spend the three allowed model retries',()=>{
 const q=new Inbox(':memory:');try{
  q.ingest(event(message()),config,now);
  for(let i=0;i<5;i++){const row=q.claim(now+i*16000);assert.equal(row.attempts,0);q.defer(row.id,'RATE_LIMIT',now+i*16000);}
  for(let i=0;i<3;i++){const row=q.claim(now+120000+i*120000);assert.equal(row.attempts,i);q.retry(row,'AI_UNAVAILABLE');}
  assert.equal(q.db.prepare('SELECT state FROM inbox').get().state,'failed');
 }finally{q.close();}
});
test('first greeting has three short separate messages, verified name and current Sao Paulo greeting',()=>{
 const morning=new Date('2026-10-19T13:00:00Z'),afternoon=new Date('2026-10-19T19:00:00Z'),night=new Date('2026-10-20T02:00:00Z');
 assert.equal(localGreeting(morning),'Bom dia');assert.equal(localGreeting(afternoon),'Boa tarde');assert.equal(localGreeting(night),'Boa noite');
 const m={text:'KOA, bom dia! Tudo bem?'},context={participante_verificado:{nome:'Kauã'},apresentacao_realizada:false};
 const replies=greetingReplies(m,context,afternoon);assert.equal(replies.length,3);assert.match(replies[0],/^Boa tarde, Kauã!/);assert.match(replies[0],/Sou o KOA/);assert.match(replies[2],/como posso te ajudar/);
 const returning=greetingReplies(m,{...context,apresentacao_realizada:true},afternoon);
 assert.equal(returning.length,1);assert.doesNotMatch(returning.join(' '),/bom dia|boa tarde|boa noite|olá|tudo bem|sou o KOA/i);
 assert.deepEqual(greetingReplies({text:'Tudo bem Koa?'},{...context,apresentacao_realizada:true}),returning);
 assert.equal(greetingReplies({text:'KOA, quem é você?'},{...context,apresentacao_realizada:true}),null);
 assert.equal(greetingReplies({text:'KOA, boa tarde! Preciso incluir um dependente.'},context,afternoon),null);
 assert.equal(greetingReplies({text:'O KOA falou com o Kauã.'},context,afternoon),null);
 assert.doesNotMatch(greetingReplies(m,{},afternoon)[0],/Kauã/);
 assert.equal(JSON.parse(modelRequest('existing',m,context,'direct',night).input[0].content).saudacao_local,'Boa noite');
});
test('verified aliases are scoped to the approved group; the first delivered reply prevents another opening',()=>{
 const q=new Inbox(':memory:');try{
  for(const alias of ['known@lid','551100008020@s.whatsapp.net'])q.db.prepare('INSERT INTO participant_names VALUES(?,?,?,?,?,?)').run('test@g.us',alias,'known@lid','Kauã',now,'test-fixture');
  const raw=message('hello',{key:{id:'hello',remoteJid:'test@g.us',participant:'551100008020@s.whatsapp.net'}});
  q.ingest(event(raw),config,now);const row=q.claim(now),m=JSON.parse(row.payload);assert.equal(m.participant,'known@lid');
  assert.deepEqual(q.context(m).participante_verificado,{nome:'Kauã'});assert.equal(q.context(m).apresentacao_realizada,false);
  assert.equal(q.profile({...m,group:'other@g.us'}),undefined);assert.equal(q.profile({...m,participant:'impostor@lid'}),undefined);
  q.plan(row.id,greetingReplies(m,q.context(m),new Date('2026-10-19T19:00:00Z')),true);
  for(let i=0;i<3;i++){const p=q.nextPart(row.id);q.sending(p);q.sent(p,'intro-'+i,now+i);assert.equal(q.context(m).apresentacao_realizada,true);}
  const next=normalizeMessage(message('second',{key:{id:'second',remoteJid:'test@g.us',participant:'known@lid'}}));
  assert.equal(greetingReplies(next,q.context(next)).length,1);assert.equal(q.stats().reply_count,3);
 }finally{q.close();}
});

test('a question as first contact also suppresses greetings on subsequent calls, independently for each user',()=>{
 const q=new Inbox(':memory:');try{
  q.ingest(event(message('question',{message:{conversation:'KOA, como preparo uma tarefa?'}})),config,now);q.claim(now);
  q.plan('question',['Prepare o rascunho na Gestão de tarefas.']);
  const next=normalizeMessage(message('second'));
  assert.equal(q.context(next).apresentacao_realizada,false);
  const p=q.nextPart('question');q.sending(p);q.sent(p,'answer',now);
  assert.equal(q.context(next).apresentacao_realizada,true);
  assert.deepEqual(greetingReplies(next,q.context(next)),['Estou por aqui. Como posso te ajudar?']);
  const other={...next,participant:'another@lid'};
  assert.equal(q.context(other).apresentacao_realizada,false);assert.equal(greetingReplies(other,q.context(other)).length,3);
  assert.equal(q.context({...next,group:'other@g.us'}).apresentacao_realizada,false);
 }finally{q.close();}
});

test('first-contact memory survives history retention, restart and later verification of participant aliases',()=>{
 const dir=mkdtempSync(join(tmpdir(),'koa-contacts-')),file=join(dir,'inbox.sqlite');let q=new Inbox(file);
 try{
  q.ingest(event(message()),config,now);q.claim(now);q.plan('one',['Resposta à primeira chamada.']);
  const p=q.nextPart('one');q.sending(p);q.sent(p,'first',now);
  q.db.prepare('DELETE FROM inbox WHERE received_at<?').run(now+7*86400000);
  q.close();q=new Inbox(file);
  for(const alias of ['person@lid','person@s.whatsapp.net'])q.db.prepare('INSERT INTO participant_names VALUES(?,?,?,?,?,?)').run('test@g.us',alias,'person@lid','Pessoa',now,'test-fixture');
  const m=normalizeMessage(message('return',{key:{id:'return',remoteJid:'test@g.us',participant:'person@lid'}}));
  assert.equal(q.context(m).interacoes.length,0);assert.equal(q.context(m).apresentacao_realizada,true);
  assert.equal(greetingReplies(m,q.context(m)).length,1);
  assert.equal(q.db.prepare('SELECT count(*) n FROM participant_contacts').get().n,1);
 }finally{q.close();rmSync(dir,{recursive:true,force:true});}
});

test('upgrade remembers legacy answers and partially delivered openings without counting unsent plans',()=>{
 const dir=mkdtempSync(join(tmpdir(),'koa-contacts-upgrade-')),file=join(dir,'inbox.sqlite');let q=new Inbox(file);
 try{
  const partial=message('partial',{key:{id:'partial',remoteJid:'test@g.us',participant:'partial@lid'}});
  const unsent=message('unsent',{key:{id:'unsent',remoteJid:'test@g.us',participant:'unsent@lid'}});
  q.ingest(event([message('legacy'),partial,unsent]),config,now);
  q.db.prepare("UPDATE inbox SET state='sent',answer='Uma resposta antiga.',sent_at=? WHERE id='legacy'").run(now);
  q.plan('partial',['Primeiro cumprimento.','Orientação.','Pergunta.'],true);
  const p=q.nextPart('partial');q.sending(p);q.sent(p,'intro-first',now);
  q.plan('unsent',['Ainda não entregue.'],true);
  q.db.exec('DROP TABLE participant_contacts');q.close();q=new Inbox(file);
  for(const raw of [message('return'),partial])assert.equal(q.context(normalizeMessage(raw)).apresentacao_realizada,true);
  assert.equal(q.context(normalizeMessage(unsent)).apresentacao_realizada,false);
  assert.equal(q.db.prepare('SELECT count(*) n FROM participant_contacts').get().n,2);
 }finally{q.close();rmSync(dir,{recursive:true,force:true});}
});
