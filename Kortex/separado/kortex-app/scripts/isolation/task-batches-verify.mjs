// Hosted persistence acceptance with a controlled interpretation result; no real provider key.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
import {remoteQuery} from './staging-remote.mjs';
const {createClient}=createRequire(new URL('../../package.json',import.meta.url))('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});
const f=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));assert.equal(f.project,stagingReference);
assert.equal((await remoteQuery('SELECT name FROM app_private.deployment_environment WHERE singleton'))[0].name,'staging');
const ok=r=>{if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data;};
const rpc=async(c,n,p={})=>ok(await c.rpc(n,p));
const clients={},tokens={};
for(const name of ['A','A2','B','C','D']){const c=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});tokens[name]=ok(await c.auth.signInWithPassword({email:f.users[name].email,password:f.password})).session.access_token;clients[name]=c;}
const server=createClient(env.VITE_SUPABASE_URL,env.STAGING_SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const report={project:stagingReference,realGoTrue:true,realHostedDatabase:true,interpretationSource:'Controlled structured result; no OpenAI generation',productionMutated:false,checks:[]};
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS',name);};
let phase=false,configured=false;let conv,all;
try{
 assert.equal((await rpc(clients.A,'task_ai_status',{p_workspace:f.workspace})).configured,false,'Never replace a real QA key');
 const destinations=[];
 for(const code of ['relacionamento','financeiro','comercial']){
  const sector=await rpc(clients.A,'task_admin_create_sector',{p_workspace:f.workspace,p_code:code});
  let contexts=await rpc(clients.A,'business_contexts');
  let b=contexts.find(c=>c.kind==='tasks'&&c.sector_id===sector&&c.can_dispatch&&c.can_manage&&c.visibility==='sector');
  if(!b){const id=await rpc(clients.A,'business_create_board',{p_sector:sector,p_kind:'tasks',p_name:'Homologação de lotes',p_visibility:'sector',p_access:'members'});contexts=await rpc(clients.A,'business_contexts');b=contexts.find(c=>c.board_id===id);}
  assert.ok(b);destinations.push(b);
 }
 await rpc(clients.A,'business_set_sector_member',{p_sector:destinations[0].sector_id,p_user:f.users.A2.id,p_active:true});
 await rpc(clients.A,'business_set_board_member',{p_board:destinations[0].board_id,p_user:f.users.A2.id,p_active:true,p_write:true});
 await rpc(server,'task_ai_configure',{p_user:f.users.A.id,p_workspace:f.workspace,p_key:'sk-QA-invalid-not-a-real-key-'+randomUUID(),p_model:'gpt-4.1-mini'});configured=true;
 await remoteQuery("UPDATE app_private.deployment_environment SET name='production' WHERE singleton");phase=true;
 conv=await rpc(clients.A,'business_start_conversation',{p_board:destinations[0].board_id,p_id:randomUUID()});
 const message=await rpc(clients.A,'task_post_message',{p_conversation:conv.id,p_request:randomUUID(),p_content:'Homologação: preparar seis pedidos independentes nos três setores autorizados, dois por setor.'});
 const claim=await rpc(server,'task_ai_batch_claim',{p_user:f.users.A.id,p_message:message.id});
 const changes=[];
 for(let i=0;i<6;i++){
  const b=destinations[Math.floor(i/2)];const stage=ok(await clients.A.from('task_stages').select('id').eq('board_id',b.board_id).eq('archived',false).order('position').limit(1))[0].id;
  changes.push({draft_id:'',version:0,payload:{title:'Homologação · pedido '+(i+1),description:'Pedido de teste para revisão e confirmação explícita.',company_id:'',operator:'',project:'',operational_code:'',board_id:b.board_id,sector_id:b.sector_id,assigned_to:i===1?f.users.A2.id:f.users.A.id,stage_id:stage,due_date:'2026-11-20',priority:'medium',unresolved:[]}});
 }
 const read=()=>rpc(clients.A,'task_batch_context',{p_conversation:conv.id});
 const taskCount=async()=>ok(await server.from('tasks').select('id').in('board_id',destinations.map(b=>b.board_id))).length;
 const initialCount=await taskCount();
 await check('Six interpreted requests persist as six stable drafts in three real sectors; preparing creates no task',async()=>{
  const applied=await rpc(clients.A,'task_apply_interpretation',{p_message:message.id,p_lease:claim.lease_id,p_changes:changes,p_reply:'Confira o resumo das seis tarefas antes de aprovar.'});
  assert.equal(applied.draft_ids.length,6);all=(await read()).drafts;assert.equal(all.length,6);assert.equal(new Set(all.map(d=>d.payload.sector_id)).size,3);assert.equal(new Set(all.map(d=>d.batch_id)).size,1);assert.equal(await taskCount(),initialCount);
  assert.equal(all[0].payload.assigned_to,f.users.A.id);assert.equal(all[1].payload.assigned_to,f.users.A2.id);
 });
 await check('Retry after a lost interpretation response reuses the exact six draft IDs',async()=>{
  const again=await rpc(server,'task_ai_batch_claim',{p_user:f.users.A.id,p_message:message.id});assert.equal(again.state,'complete');assert.deepEqual(again.draft_ids,all.map(d=>d.id));
  const repeated=await rpc(clients.A,'task_apply_interpretation',{p_message:message.id,p_lease:claim.lease_id,p_changes:changes,p_reply:'Não duplicar.'});assert.deepEqual(repeated.draft_ids,again.draft_ids);assert.equal((await read()).drafts.length,6);
 });
 await check('Editing the second task preserves its ID, number, recipient and the other five; stale approval is rejected atomically',async()=>{
  const d=all[1];const updated=await rpc(clients.A,'task_save_draft',{p_conversation:conv.id,p_id:d.id,p_version:d.version,p_payload:{...d.payload,due_date:'2026-11-24'},p_target:null});
  assert.equal(updated.id,d.id);assert.equal(updated.position,2);assert.equal(updated.payload.assigned_to,d.payload.assigned_to);
  const denied=await clients.A.rpc('task_confirm_batch',{p_conversation:conv.id,p_items:[{id:all[0].id,version:all[0].version},{id:d.id,version:d.version}]});assert.equal(denied.error?.code,'PT409');assert.equal(await taskCount(),initialCount);
  const next=(await read()).drafts;assert.deepEqual(next.filter(x=>x.id!==d.id).map(x=>x.id),all.filter(x=>x.id!==d.id).map(x=>x.id));all=next;
 });
 await check('Explicitly selecting two creates exactly two tasks; four drafts remain and concurrent retry creates no duplicates',async()=>{
  const items=[all[0],all[1]].map(d=>({id:d.id,version:d.version}));
  const [one,two]=await Promise.all([rpc(clients.A,'task_confirm_batch',{p_conversation:conv.id,p_items:items}),rpc(clients.A,'task_confirm_batch',{p_conversation:conv.id,p_items:items})]);
  assert.equal(one.length,2);assert.deepEqual(one,two);assert.equal(await taskCount(),initialCount+2);assert.equal((await read()).drafts.length,4);
  const own=ok(await clients.A.from('tasks').select('id,due_date,assigned_to').in('id',one.map(x=>x.task_id)));assert.equal(own.length,1);
  const recipient=ok(await clients.A2.from('tasks').select('id,due_date,assigned_to').in('id',one.map(x=>x.task_id)));assert.equal(recipient.length,1);assert.ok(recipient[0].due_date.startsWith('2026-11-24'));
  assert.notEqual(own[0].id,recipient[0].id);
  report.confirmedTasks=one;
 });
 await check('A new request appends once to the existing pending batch, with stable old IDs',async()=>{
  const m=await rpc(clients.A,'task_post_message',{p_conversation:conv.id,p_request:randomUUID(),p_content:'Acrescente mais um pedido de teste.'});
  const c=await rpc(server,'task_ai_batch_claim',{p_user:f.users.A.id,p_message:m.id});
  const before=(await read()).drafts;await rpc(clients.A,'task_apply_interpretation',{p_message:m.id,p_lease:c.lease_id,p_changes:[{...changes[2],payload:{...changes[2].payload,title:'Homologação · pedido adicional'}}],p_reply:'Acrescentei um rascunho ao resumo.'});
  const after=(await read()).drafts;assert.equal(after.length,5);assert.ok(before.every(d=>after.some(x=>x.id===d.id)));assert.equal(new Set(after.map(d=>d.batch_id)).size,1);
 });
 await check('Greeting adds only a chat response, and conversations remain separate',async()=>{
  const other=await rpc(clients.A,'business_start_conversation',{p_board:destinations[0].board_id,p_id:randomUUID()});
  const m=await rpc(clients.A,'task_post_message',{p_conversation:other.id,p_request:randomUUID(),p_content:'Olá'});const c=await rpc(server,'task_ai_batch_claim',{p_user:f.users.A.id,p_message:m.id});
  await rpc(clients.A,'task_apply_interpretation',{p_message:m.id,p_lease:c.lease_id,p_changes:[],p_reply:'Olá! Qual tarefa deseja preparar?'});
  assert.equal((await rpc(clients.A,'task_batch_context',{p_conversation:other.id})).drafts.length,0);assert.equal((await read()).drafts.length,5);assert.equal(await taskCount(),initialCount+2);
 });
 await check('An ordinary account and another organization cannot read or approve the administrative batch',async()=>{
  for(const name of ['B','D']){assert.ok((await clients[name].rpc('task_batch_context',{p_conversation:conv.id})).error);assert.ok((await clients[name].rpc('task_confirm_batch',{p_conversation:conv.id,p_items:[]})).error);assert.equal(ok(await clients[name].from('task_drafts').select('id').eq('conversation_id',conv.id)).length,0);}
 });
 await check('A concurrent manual edit invalidates an in-flight AI interpretation without overwriting it',async()=>{
  const m=await rpc(clients.A,'task_post_message',{p_conversation:conv.id,p_request:randomUUID(),p_content:'Atualize o primeiro pedido pendente.'});const c=await rpc(server,'task_ai_batch_claim',{p_user:f.users.A.id,p_message:m.id});
  const d=(await read()).drafts[0];await rpc(clients.A,'task_save_draft',{p_conversation:conv.id,p_id:d.id,p_version:d.version,p_payload:{...d.payload,title:'Revisado manualmente'},p_target:null});
  const r=await clients.A.rpc('task_apply_interpretation',{p_message:m.id,p_lease:c.lease_id,p_changes:[{draft_id:d.id,version:d.version,payload:d.payload}],p_reply:'Ajustei.'});assert.equal(r.error?.code,'PT409');
  assert.equal((await read()).drafts.find(x=>x.id===d.id).payload.title,'Revisado manualmente');await rpc(server,'task_ai_batch_fail',{p_user:f.users.A.id,p_message:m.id,p_lease:c.lease_id});
 });
 report.conversation=conv.id;report.board=destinations[0].board_id;report.completedAt=new Date().toISOString();
}finally{
 if(phase)await remoteQuery("UPDATE app_private.deployment_environment SET name='staging' WHERE singleton");
 if(configured)await rpc(server,'task_ai_disconnect',{p_user:f.users.A.id,p_workspace:f.workspace});
 await fs.writeFile('outputs/isolation/task-batches-staging-checks.json',JSON.stringify(report,null,2));
}
