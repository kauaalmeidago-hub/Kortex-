import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Inbox,modelRequest,normalizeMessage} from './core.mjs';
import {requestedTaskModel,parseTaskDecision} from './tasks.mjs';
import {groupCommand,groupDirectory,resolveNames,withGroupActions,parseGroupAction,normalizeGroupAction,addressedToOtherMember,composeGroupReplies,textPayload,everyoneRequested,introductionText} from './groups.mjs';
const response=data=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}]});
const participants=[{id:'1@lid',phoneNumber:'551100001@s.whatsapp.net'},{id:'2@lid',phoneNumber:'551100002@s.whatsapp.net'},{id:'3@lid',phoneNumber:'551100003@s.whatsapp.net'}];
const contacts=[{remoteJid:'551100001@s.whatsapp.net',pushName:'Fernando Martins'},{remoteJid:'2@lid',pushName:'Jean Marwin'},{remoteJid:'9@lid',pushName:'Pessoa de outro grupo'}];
const directory=groupDirectory(participants,contacts,[],'551100003@s.whatsapp.net');
const message={text:'Koa, chame Fernando para informar o prazo da cotação.'};
const action={kind:'mention',names:['Fernando'],everyone:false};

test('names and phone/LID aliases come only from current group members; the bot is excluded',()=>{
 assert.equal(directory.length,2);assert.deepEqual(directory[0].aliases,['1@lid','551100001@s.whatsapp.net']);
 assert.equal(resolveNames(['Fernando'],directory).members[0].jid,'551100001@s.whatsapp.net');
 assert.equal(resolveNames(['Férnando Mártiñs'],directory).members.length,1);
 assert.equal(resolveNames(['Fern'],directory).missing.length,1);
 assert.equal(resolveNames(['Pessoa de outro grupo'],directory).missing.length,1);
 assert.equal(resolveNames(['@551100001'],directory).members.length,1);
 assert.equal(resolveNames(['1@lid'],directory).members.length,1);
 const same=[...directory,{jid:'4@lid',aliases:['4@lid'],names:['Fernando Lopes']}];
 assert.deepEqual(resolveNames(['Fernando'],same).ambiguous,['Fernando']);
 assert.equal(resolveNames(['Fernando Martins'],same).members.length,1);
});
test('a call contains real mention metadata and the requested question, never invented JIDs',()=>{
 const parts=composeGroupReplies(['{{mencoes}}, qual é o prazo da cotação?'],action,message,{},directory);
 assert.equal(parts[0].text,'@551100001, qual é o prazo da cotação?');
 assert.deepEqual(parts[0].mentioned,['551100001@s.whatsapp.net']);
 const payload=textPayload('approved@g.us',{...parts[0],mentioned:JSON.stringify(parts[0].mentioned)},directory);
 assert.deepEqual(payload.mentioned,['551100001@s.whatsapp.net']);
 assert.equal('mentionsEveryOne' in payload,false);assert.equal(payload.number,'approved@g.us');
 assert.throws(()=>textPayload('approved@g.us',{...parts[0],mentioned:JSON.stringify(parts[0].mentioned)},[]));
 assert.equal('mentioned' in textPayload('approved@g.us',{text:'Uma resposta comum.'}),false);
});
test('ambiguity, missing people and names without source evidence produce clarification without any ping',()=>{
 const cases=[
  [{...action,names:['Luisa']},{text:'Koa, chame Luisa.'},directory,/Não consegui identificar Luisa/],
  [action,message,[...directory,{jid:'4@lid',aliases:['4@lid'],names:['Fernando Lopes']}],/mais de uma pessoa/],
  [{...action,names:['Jean']},message,directory,/Quem você quer chamar/],
 ];
 for(const [a,m,d,pattern] of cases){const replies=composeGroupReplies(['Chamei!'],a,m,{},d);assert.equal(typeof replies[0],'string');assert.match(replies[0],pattern);}
});
test('a collective introduction has one complete text and all actual mentions at its end, only when requested',()=>{
 const m={text:'Koa, se apresente para o grupo e no final mencione todos.'};
 const intro={kind:'introduction',names:[],everyone:true};
 const [part]=composeGroupReplies([],intro,m,{},directory,false);
 assert.equal(part.mentioned.length,2);assert.deepEqual(part.recipients,[]);
 assert.ok(part.text.endsWith('@551100001 @551100002'));assert.match(part.text,/Sou o KOA/);
 assert.doesNotMatch(part.text,/posso registrá-la/);assert.match(introductionText(true),/posso registrá-la/);
 assert.equal(typeof composeGroupReplies([],intro,{text:'Koa, se apresente.'},{},directory)[0],'string');
 assert.equal(composeGroupReplies([],{...intro,everyone:false},{text:'Koa, se apresente para o grupo.'},{},directory)[0].mentioned.length,0);
 assert.equal(everyoneRequested('Koa, não mencione todos.'),false);
});
test('group schema works with conversation and task mode without treating calls as task creation',()=>{
 for(const fn of [modelRequest,requestedTaskModel]){
  const body=withGroupActions(fn('configured',message,{},'direct'));
  assert.ok(body.text.format.schema.required.includes('group_action'));
  assert.match(body.instructions,/Uma chamada é conversa e NÃO cria tarefa/);
 }
 const raw=response({should_reply:true,replies:[{topic:'Chamada',text:'{{mencoes}}, pode ajudar?'}],intent:'conversation',tasks:[],group_action:action});
 assert.deepEqual(parseGroupAction(raw),action);assert.equal(parseTaskDecision(raw,message).tasks.length,0);
 for(const bad of [{kind:'none',names:['Fernando'],everyone:false},{kind:'mention',names:[],everyone:false},{kind:'all',names:[],everyone:true}])assert.throws(()=>parseGroupAction(response({should_reply:true,group_action:bad})));
 for(const text of ['Chame Fernando','Marque Jean','Mencione todos','Por favor, chame o Fernando','Se apresente para o grupo'])assert.equal(groupCommand(text),true,text);
 for(const text of ['Fernando, chame o Jean','O Koa chamou Fernando ontem','Como mencionar todos?','Não chame ninguém'])assert.equal(groupCommand(text),false,text);
});
test('mention plans survive restart; only delivered calls open scoped follow-up context, which closes on a reply',()=>{
 const dir=mkdtempSync(join(tmpdir(),'koa-mentions-')),file=join(dir,'inbox.sqlite');let q=new Inbox(file);const now=Date.now();
 const raw=(id,person,text)=>({key:{id,remoteJid:'approved@g.us',participant:person},message:{conversation:text},messageTimestamp:Math.floor(now/1000)});
 const config={instance:'test',group_jid:'approved@g.us',activated_at:new Date(now-5000).toISOString()};
 const m=normalizeMessage(raw('reply','1@lid','O prazo é amanhã.'));
 try{
  q.ingest({instance:'test',event:'messages.upsert',data:raw('call','caller@lid',message.text)},config,now);q.claim(now);
  q.plan('call',composeGroupReplies(['{{mencoes}}, qual o prazo?'],action,message,{},directory));
  assert.equal(q.invitation(m,now),undefined);q.close();q=new Inbox(file);
  const part=q.nextPart('call');assert.deepEqual(JSON.parse(part.mentioned),['551100001@s.whatsapp.net']);
  q.sending(part);q.sent(part,'actual-call',now);
  assert.equal(q.reason(m,'bot',now),'resposta de participante chamado pelo KOA');assert.match(q.context(m).chamada_recebida,/qual o prazo/);
  assert.equal(q.invitation({...m,group:'other@g.us'},now),undefined);assert.equal(q.invitation({...m,participant:'9@lid'},now),undefined);
  assert.equal(q.invitation(m,now+600001),undefined);
  q.ingest({instance:'test',event:'messages.upsert',data:raw('reply','1@lid',m.text)},config,now);q.claim(now);q.plan('reply',['Obrigado pelo retorno.']);
  const answer=q.nextPart('reply');q.sending(answer);q.sent(answer,'ack',now+100);
  assert.equal(q.invitation(m,now+100),undefined);assert.equal(q.invitation({...m,participant:'551100001@s.whatsapp.net'},now+100),undefined);
 }finally{q.close();rmSync(dir,{recursive:true,force:true});}
});
test('an operator opening the inbox does not reset an active worker send',()=>{
 const dir=mkdtempSync(join(tmpdir(),'koa-observe-')),file=join(dir,'inbox.sqlite');const q=new Inbox(file);
 try{
  q.db.prepare('INSERT INTO inbox(id,group_jid,participant,text,ts,payload,received_at,state) VALUES(?,?,?,?,?,?,?,?)').run('active','g@g.us','p','text',1,'{}',1,'sending');
  const observer=new Inbox(file,{recover:false});observer.close();assert.equal(q.db.prepare('SELECT state FROM inbox').get().state,'sending');
 }finally{q.close();rmSync(dir,{recursive:true,force:true});}
});
test('capability questions and negated commands cannot send pings; collective introductions override a mistaken model label',()=>{
 for(const text of ['Koa, se eu pedir para chamar Fernando, você consegue?','Koa, quando eu falar chame Fernando, você vai mencionar?','Koa, não chame Fernando.','Koa, não se apresente para todos.'])assert.equal(normalizeGroupAction(action,{text}).kind,'none',text);
 assert.equal(normalizeGroupAction(action,{text:'Koa, se apresente para o grupo e mencione todos.'}).kind,'introduction');
 assert.equal(normalizeGroupAction(action,message).kind,'mention');
 assert.equal(addressedToOtherMember({text:'Jean, obrigado pela ajuda com o carro.'},directory),true);
 assert.equal(addressedToOtherMember({text:'O prazo da cotação é amanhã.'},directory),false);
 const [part]=composeGroupReplies(['@Fernando, pode informar o prazo?'],action,message,{},directory);
 assert.equal(part.text,'@551100001, pode informar o prazo?');
});
