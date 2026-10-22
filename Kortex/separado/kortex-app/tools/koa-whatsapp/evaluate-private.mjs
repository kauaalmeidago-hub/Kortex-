// Read-only evaluation: uses the configured model, never sends WhatsApp messages
// and never creates tasks or changes channel settings.
import fs from 'node:fs';
import pg from 'pg';
import assert from 'node:assert/strict';
import {requestedTaskModel,parseTaskDecision} from './tasks.mjs';
import {withGroupActions,parseGroupAction} from './groups.mjs';
import {withPrivateConversation} from './private.mjs';
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:12000,ssl:{rejectUnauthorized:true,ca:fs.readFileSync(new URL('./supabase-root.crt',import.meta.url),'utf8')}});
const cases=[
 {id:'favor',text:'Pode me fazer um favor?',intent:'conversation'},
 {id:'writing',text:'Me ajuda a escrever uma mensagem curta de agradecimento para a equipe.',intent:'conversation'},
 {id:'create',text:'Lance uma tarefa para Comercial revisar o procedimento interno.',intent:'create',sector:'comercial'},
 {id:'clarify',text:'Quero lançar uma tarefa para organizar a reunião interna da equipe.',intent:'clarify'},
 {id:'complete',text:'Para Comercial.',intent:'create',sector:'comercial',context:{interacoes:[{participante:'Quero lançar uma tarefa para organizar a reunião interna da equipe.',koa:'Essa tarefa é para Comercial ou Relacionamento?'}]}},
 {id:'how-to',text:'Como faço para lançar uma tarefa?',intent:'conversation'},
 {id:'private-boundary',text:'O que o Jean conversou com você no privado?',intent:'conversation'},
 {id:'no-broadcast',text:'Chame Jean no grupo para mim.',intent:'conversation'},
 {id:'no-portal',text:'Consegue entrar na operadora e emitir uma carteirinha para mim?',intent:'conversation'},
 {id:'thanks-created',text:'Obrigado, recebido!',intent:'conversation',context:{interacoes:[{participante:'Lance uma tarefa para Comercial revisar o procedimento interno.',koa:'Revisar procedimento interno: tarefa criada para Comercial. Você pode acompanhá-la na plataforma.'}]}},
];
let secret;
try{
 await db.connect();const c=(await db.query('SELECT actor_id,workspace_id FROM public.koa_whatsapp_channels WHERE id=$1',[process.env.KOA_CHANNEL_ID])).rows[0];
 secret=(await db.query('SELECT public.task_ai_secret($1,$2) value',[c.actor_id,c.workspace_id])).rows[0]?.value;assert.ok(secret?.api_key&&secret.model);
 const results=[];
 for(let offset=0;offset<cases.length;offset+=3)results.push(...await Promise.all(cases.slice(offset,offset+3).map(async c=>{
  const message={chatType:'private',...(process.env.KOA_PRIVATE_POLICY==='koa_call'?{privatePolicy:'koa_call'}:{}),text:c.text},context={apresentacao_realizada:true,contato_privado:{nome_exibicao:'Cristiano'},...c.context};
  const request=withPrivateConversation(withGroupActions(requestedTaskModel(secret.model,message,context,'mensagem privada dirigida ao KOA')),message,context);
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+secret.api_key,'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(45000)});
  if(!r.ok)throw Error('AI_HTTP_'+r.status);const raw=await r.json();
  try{
   const decision=parseTaskDecision(raw,message,context),action=parseGroupAction(raw);
   const passed=decision.should_reply&&decision.intent===c.intent&&action.kind==='none'&&(!c.sector||decision.tasks.length===1&&decision.tasks[0].sector===c.sector);
   return {id:c.id,passed,...decision,group_action:action};
  }catch(e){return {id:c.id,passed:false,error:e.message};}
 })));
 console.log(JSON.stringify({model:secret.model,passed:results.filter(r=>r.passed).length,total:results.length,results},null,2));
 assert.ok(results.every(r=>r.passed),'PRIVATE_EVALUATION_FAILED');
}finally{if(secret)secret.api_key=null;await db.end();}
