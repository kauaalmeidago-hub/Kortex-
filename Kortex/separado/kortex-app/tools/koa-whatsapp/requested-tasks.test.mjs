import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Inbox} from './core.mjs';
import {requestedTaskModel,parseTaskDecision,taskResultReplies,supportedRoute,databaseTaskItems} from './tasks.mjs';
const task={title:'Revisar o procedimento interno de cotações',description:'Revisar o procedimento da equipe Comercial.',sector:'comercial',operational_code:'',priority:'medium',due_date:'',route_source:'explicit',route_evidence:'para Comercial'};
const response=data=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}]});
test('request mode preserves model, excludes arbitrary tools and requires an explicit creation intent',()=>{
 const r=requestedTaskModel('configured-model',{text:'KOA, organize uma tarefa.'},{},'direct');
 assert.equal(r.model,'configured-model');assert.equal(r.store,false);assert.equal(r.tools,undefined);
 assert.doesNotMatch(r.instructions,/SOMENTE em modo de conversa/);assert.match(r.instructions,/CRIAÇÃO SOMENTE QUANDO SOLICITADA/);
 assert.deepEqual(r.text.format.schema.properties.tasks.items.properties.sector.enum,['comercial','relacionamento']);
 const decision=parseTaskDecision(response({should_reply:true,replies:[],intent:'create',tasks:[task]}));
 assert.equal(decision.tasks[0].due_date,'');assert.equal(decision.tasks[0].operational_code,'');
 assert.deepEqual(parseTaskDecision(response({should_reply:true,replies:[{topic:'false receipt',text:'Criei!'}],intent:'create',tasks:[task]})).replies,[]);
 for(const bad of [
  {should_reply:false,replies:[],intent:'create',tasks:[task]},
  {should_reply:true,replies:[{topic:'conversa',text:'Olá!'}],intent:'conversation',tasks:[task]},
  {should_reply:true,replies:[],intent:'create',tasks:[{...task,sector:'financeiro'}]},
  {should_reply:true,replies:[],intent:'create',tasks:[{...task,recipient_id:'arbitrary-user'}]},
  {should_reply:true,replies:[],intent:'create',tasks:[{...task,due_date:'2026-02-30'}]},
 ])assert.throws(()=>parseTaskDecision(response(bad)));
});
test('confirmation is assembled from real result status, never from the model reply',()=>{
 const decision={tasks:[task],replies:['Confirmação inventada']};
 assert.match(taskResultReplies([{status:'created',task_id:'real'}],decision)[0],/tarefa criada para Comercial/);
 assert.match(taskResultReplies([{status:'duplicate',task_id:'real'}],decision)[0],/já está cadastrada/);
 assert.match(taskResultReplies([{status:'review',task_id:'real'}],decision)[0],/semelhante/);
 assert.equal(taskResultReplies([{status:'created',task_id:'real'}],decision).length,1);
 assert.throws(()=>taskResultReplies([{status:'created'}],decision));assert.throws(()=>taskResultReplies([],decision));
});
test('routing needs a traceable user indication or operational responsibility, and evidence never reaches task fields',()=>{
 const message={text:'KOA, crie uma tarefa para organizar uma reunião interna.'};
 assert.equal(supportedRoute({...task,route_evidence:'Comercial'},message,{}),false);
 assert.equal(supportedRoute(task,{text:'KOA, crie essa tarefa para Comercial.'},{}),true);
 assert.equal(supportedRoute({...task,route_source:'responsibility',route_evidence:'reunião interna'},message,{}),false);
 assert.equal(supportedRoute({...task,sector:'relacionamento',route_source:'responsibility',route_evidence:'incluir o dependente João'},{text:'KOA, precisamos incluir o dependente João no contrato ativo.'},{}),true);
 assert.equal(parseTaskDecision(response({should_reply:true,replies:[],intent:'create',tasks:[task]}),message).intent,'clarify');
 assert.equal(databaseTaskItems({tasks:[task]})[0].route_evidence,undefined);
});
test('the action plan is durably fixed before a database call and cannot be reinterpreted on retry',()=>{
 const inbox=new Inbox(':memory:');try{
  inbox.db.prepare('INSERT INTO inbox(id,group_jid,participant,text,ts,payload,received_at) VALUES(?,?,?,?,?,?,?)').run('event','g@g.us','p','request',1,'{}',1);
  const decision={intent:'create',should_reply:true,replies:[],tasks:[task]};assert.deepEqual(inbox.saveTaskDecision('event',decision),decision);
  assert.deepEqual(inbox.saveTaskDecision('event',{...decision,tasks:[]}),decision);
  inbox.db.prepare('DELETE FROM inbox WHERE id=?').run('event');assert.equal(inbox.taskDecision('event'),null);
 }finally{inbox.close();}
});
