import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {isolatedDatabase} from './bootstrap.mjs';
process.on('uncaughtException',e=>{console.error('ISOLATION TEST FAILED',e.code??'',e.message,e.where??'');process.exit(1);});
const db=await isolatedDatabase();const evidence=[];
await db.exec("UPDATE app_private.deployment_environment SET name='development'");
const q=(s,p=[])=>db.query(s,p);const one=async(s,p=[])=> (await q(s,p)).rows[0];
async function as(user,fn){await db.exec('BEGIN;SET LOCAL ROLE authenticated;');await q(`SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)`,[user]);try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}}
async function check(name,fn){await fn();evidence.push({name,passed:true});console.log('PASS',name);}
async function denied(user,sql,params=[]){let error;try{await as(user,()=>q(sql,params));}catch(e){error=e;}assert.ok(error,'expected database refusal');assert.ok(['42501','22023','23503','23514','40001','PT409'].includes(error.code),`${error.code}: ${error.message}`);}
const users={};for(const [name,sector] of Object.entries({A:'relacionamento',A2:'relacionamento',B:'financeiro',C:'comercial',D:'relacionamento',G:'relacionamento'})){
 users[name]=randomUUID();await q(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)`,[users[name],`${name}@isolation.invalid`,JSON.stringify({full_name:name,sector})]);}
const ws=(await one('SELECT id FROM public.workspaces WHERE owner_id=$1',[users.A])).id;
for(const name of ['A2','B','C','G'])await q(`INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')`,[ws,users[name]]);
const rel=(await one(`SELECT id FROM public.task_sectors WHERE workspace_id=$1 AND code='relacionamento'`,[ws])).id;
const fin=await as(users.A,async()=> (await one(`SELECT public.business_create_sector($1,'financeiro') id`,[ws])).id);
const com=await as(users.A,async()=> (await one(`SELECT public.business_create_sector($1,'comercial') id`,[ws])).id);
for(const [name,s] of [['A2',rel],['B',fin],['C',com],['G',rel]])await as(users.A,()=>q(`SELECT public.business_set_sector_member($1,$2,true,$3,$3,false,false)`,[s,users[name],name==='G']));
const board=async(user,sector,kind='tasks',visibility='personal')=>as(user,async()=> (await one(`SELECT public.business_create_board($1,$2,$3,$4,$5) id`,[sector,kind,`QA ${kind}`,visibility,visibility==='personal'?'members':'sector'])).id);
const privateA=(await one(`SELECT id FROM public.business_boards WHERE workspace_id=$1 AND owner_id=$2 AND kind='tasks'`,[ws,users.A])).id;
const privateA2=(await one(`SELECT id FROM public.business_boards WHERE workspace_id=$1 AND owner_id=$2 AND kind='tasks'`,[ws,users.A2])).id;
const queue=await board(users.G,rel,'tasks','sector');
for(const name of ['A','A2'])await as(users.G,()=>q(`SELECT public.business_set_board_member($1,$2,true,true)`,[queue,users[name]]));
const first=async b=>(await one('SELECT id FROM public.task_stages WHERE board_id=$1 ORDER BY position LIMIT 1',[b])).id;
const save=async(user,b,title)=>as(user,async()=> (await one('SELECT (public.business_save_task($1,$2,NULL,NULL,$3)).*',[b,randomUUID(),JSON.stringify({title,stage_id:await first(b)})])));
const personal=await save(users.A,privateA,'private-A');const personal2=await save(users.A2,privateA2,'private-A2');
const shared=await as(users.G,async()=>one(`INSERT INTO public.tasks(workspace_id,sector_id,board_id,owner_id,visibility,title,stage_id,created_by) VALUES($1,$2,$3,$4,'sector','rel-queue',$5,$4) RETURNING *`,[ws,rel,queue,users.G,await first(queue)]));
await check('Personal: A reads; A2/B/C/D/G cannot read even generic workspace admin or historical authorship',async()=>{
 assert.equal((await as(users.A,()=>q('SELECT id FROM public.tasks WHERE id=$1',[personal.id]))).rows.length,1);
 for(const n of ['A2','B','C','D','G'])assert.equal((await as(users[n],()=>q('SELECT id FROM public.tasks WHERE id=$1',[personal.id]))).rows.length,0,n);
 assert.equal((await as(users.A,()=>q('SELECT id FROM public.tasks WHERE id=$1',[personal2.id]))).rows.length,0,'organization owner/generic admin has no automatic personal access');
});
await check('Sector queue and exact RLS count: A/A2 only, no Finance/Commercial/other organization',async()=>{
 for(const n of ['A','A2'])assert.equal((await as(users[n],()=>one('SELECT count(*)::int n FROM public.tasks WHERE board_id=$1',[queue]))).n,1);
 for(const n of ['B','C','D'])assert.equal((await as(users[n],()=>one('SELECT count(*)::int n FROM public.tasks WHERE board_id=$1',[queue]))).n,0,n);
});
await check('Direct IDs: SELECT empty; UPDATE/DELETE affect zero unauthorized rows',async()=>{
 for(const n of ['A2','B','C','D','G']){
  assert.equal((await as(users[n],()=>q(`UPDATE public.tasks SET title='forged' WHERE id=$1 RETURNING id`,[personal.id]))).rows.length,0);
  assert.equal((await as(users[n],()=>q(`DELETE FROM public.tasks WHERE id=$1 RETURNING id`,[personal.id]))).rows.length,0);
 }
});
await check('Forged task author, owner, sector, board and assignee are refused',async()=>{
 for(const part of [{created_by:users.B},{owner_id:users.A2},{sector_id:fin},{board_id:privateA2},{assigned_to:users.A2},{visibility:'sector'}])await denied(users.A,'SELECT public.business_save_task($1,$2,NULL,NULL,$3)',[privateA,randomUUID(),JSON.stringify({title:'forged',...part})]);
 await denied(users.A,`UPDATE public.tasks SET board_id=$1,sector_id=$2 WHERE id=$3`,[queue,rel,personal.id]);
 await denied(users.G,`SELECT public.business_create_board($1,'tasks','forged','sector','sector')`,[fin]);
});
await check('Profile declaration and metadata cannot grant another sector or organization',async()=>{
 await as(users.A2,()=>q(`UPDATE public.profiles SET sector='financeiro' WHERE id=$1`,[users.A2]));
 assert.equal((await as(users.A2,()=>one(`SELECT public.business_can_sector($1) allowed`,[fin]))).allowed,false);
 await denied(users.A2,'SELECT public.business_set_sector_member($1,$2,true,true,true,true,true)',[fin,users.A2]);
 await denied(users.A2,`INSERT INTO public.task_sector_members(workspace_id,sector_id,user_id) VALUES($1,$2,$3)`,[ws,fin,users.A2]);
 assert.equal((await as(users.A2,()=>q('SELECT id FROM public.profiles WHERE id=$1',[users.B]))).rows.length,0);
});
const pPrivate=await board(users.A,rel,'pipeline');const pShared=await board(users.G,rel,'pipeline','sector');
const pipelineId=async b=>(await one('SELECT id FROM public.pipelines WHERE board_id=$1',[b])).id;
const pPrivId=await pipelineId(pPrivate);const pSharedId=await pipelineId(pShared);
const leadStage=async p=>(await one('SELECT id FROM public.stages WHERE pipeline_id=$1 ORDER BY position LIMIT 1',[p])).id;
for(const n of ['A','A2'])await as(users.G,()=>q(`SELECT public.business_set_board_member($1,$2,true,true)`,[pShared,users[n]]));
const createLead=async(u,b,visibility)=>{const p=await pipelineId(b);return as(u,async()=>one(`INSERT INTO public.leads(workspace_id,sector_id,pipeline_id,stage_id,title,visibility) VALUES($1,$2,$3,$4,'QA lead',$5) RETURNING *`,[ws,rel,p,await leadStage(p),visibility]));};
const privateLead=await createLead(users.A,pPrivate,'personal');const sharedLead=await createLead(users.G,pShared,'sector');
await check('Pipelines, columns, leads and aggregate sums honor personal and sector access',async()=>{
 for(const n of ['A2','B','C','D','G'])assert.equal((await as(users[n],()=>q('SELECT id FROM public.leads WHERE id=$1',[privateLead.id]))).rows.length,0);
 assert.equal((await as(users.A2,()=>q('SELECT id FROM public.leads WHERE id=$1',[sharedLead.id]))).rows.length,1);
 for(const n of ['B','C','D']){
 assert.equal((await as(users[n],()=>q('SELECT id FROM public.pipelines WHERE id=$1',[pSharedId]))).rows.length,0);
 assert.equal((await as(users[n],()=>q('SELECT id FROM public.stages WHERE pipeline_id=$1',[pSharedId]))).rows.length,0);
 assert.equal((await as(users[n],()=>one('SELECT count(*)::int n,coalesce(sum(value),0)::int total FROM public.leads WHERE pipeline_id=$1',[pSharedId]))).n,0);}
 await denied(users.A,`UPDATE public.leads SET stage_id=$1 WHERE id=$2`,[await leadStage(pSharedId),privateLead.id]);
 await denied(users.A,`UPDATE public.leads SET visibility='sector' WHERE id=$1`,[privateLead.id]);
});
await check('Finance pipeline structure, records and totals are isolated inside the same organization',async()=>{
 const boardId=await board(users.B,fin,'pipeline');const pipeline=await pipelineId(boardId);const stage=await leadStage(pipeline);
 const lead=await as(users.B,()=>one(`INSERT INTO public.leads(workspace_id,sector_id,pipeline_id,stage_id,title,value,visibility) VALUES($1,$2,$3,$4,'Finance QA',125,'personal') RETURNING id`,[ws,fin,pipeline,stage]));
 for(const n of ['A','A2','C','D','G']){assert.equal((await as(users[n],()=>q('SELECT id FROM public.pipelines WHERE id=$1',[pipeline]))).rows.length,0);assert.equal((await as(users[n],()=>q('SELECT id FROM public.stages WHERE pipeline_id=$1',[pipeline]))).rows.length,0);assert.equal((await as(users[n],()=>one('SELECT count(*)::int n,coalesce(sum(value),0)::int total FROM public.leads WHERE pipeline_id=$1',[pipeline]))).n,0);}
 assert.equal((await as(users.B,()=>one('SELECT sum(value)::int total FROM public.leads WHERE id=$1',[lead.id]))).total,125);
});
await check('Same-sector cross-board column IDs cannot be injected into tasks',async()=>{await denied(users.A,'UPDATE public.tasks SET stage_id=$1 WHERE id=$2',[await first(queue),personal.id]);});
await check('Deleting an authorized lead cannot cascade-delete another userâ€™s personal task',async()=>{
 await as(users.A,()=>q('UPDATE public.tasks SET lead_id=$1 WHERE id=$2',[sharedLead.id,personal.id]));
 await denied(users.G,'DELETE FROM public.leads WHERE id=$1',[sharedLead.id]);
 assert.equal((await as(users.A,()=>q('SELECT id FROM public.tasks WHERE id=$1',[personal.id]))).rows.length,1);
 await as(users.A,()=>q('UPDATE public.tasks SET lead_id=NULL WHERE id=$1',[personal.id]));
});
await check('Pipeline column removal is atomic when a private lead is inaccessible to the board manager',async()=>{
 const privateInShared=await createLead(users.A,pShared,'personal');
 const stages=(await q('SELECT * FROM public.stages WHERE pipeline_id=$1 ORDER BY position',[pSharedId])).rows;
 const version=(await one('SELECT updated_at FROM public.business_boards WHERE id=$1',[pShared])).updated_at;
 await denied(users.G,'SELECT public.business_save_columns($1,$2,$3,$4)',[pShared,version,JSON.stringify(stages.slice(1)),JSON.stringify({[stages[0].id]:stages[1].id})]);
 assert.equal((await one('SELECT stage_id FROM public.leads WHERE id=$1',[privateInShared.id])).stage_id,stages[0].id);
});
await check('A private pipeline can be shared deliberately with an authorized sector participant and revoked',async()=>{
 await as(users.A,()=>q('SELECT public.business_set_board_member($1,$2,true,true)',[pPrivate,users.A2]));
 assert.equal((await as(users.A2,()=>q('SELECT id FROM public.leads WHERE id=$1',[privateLead.id]))).rows.length,1);
 await as(users.A2,()=>q(`UPDATE public.leads SET description='Authorized participant edit' WHERE id=$1`,[privateLead.id]));
 await as(users.A,()=>q('SELECT public.business_set_board_member($1,$2,false)',[pPrivate,users.A2]));
 assert.equal((await as(users.A2,()=>q('SELECT id FROM public.leads WHERE id=$1',[privateLead.id]))).rows.length,0);
 await denied(users.A,'SELECT public.business_set_board_member($1,$2,true,true)',[pPrivate,users.B]);
});
await check('Private storage paths cannot be listed, inserted, replaced or deleted out of scope',async()=>{
 const name=`${ws}/${privateLead.id}/qa.txt`;
 await as(users.A,()=>q(`INSERT INTO storage.objects(bucket_id,name) VALUES('lead-files',$1)`,[name]));
 for(const n of ['A2','B','C','D','G']){
 assert.equal((await as(users[n],()=>q(`SELECT name FROM storage.objects WHERE name=$1`,[name]))).rows.length,0);
 assert.equal((await as(users[n],()=>q(`UPDATE storage.objects SET metadata='{"forged":true}' WHERE name=$1 RETURNING name`,[name]))).rows.length,0);
 assert.equal((await as(users[n],()=>q(`DELETE FROM storage.objects WHERE name=$1 RETURNING name`,[name]))).rows.length,0);
 await denied(users[n],`INSERT INTO storage.objects(bucket_id,name) VALUES('lead-files',$1)`,[`${ws}/${privateLead.id}/forged.txt`]);}
});
await check('Columns: adding/renaming is board-local; deletion moves records atomically',async()=>{
 const stages=(await q('SELECT * FROM public.task_stages WHERE board_id=$1 ORDER BY position',[privateA])).rows;
 const version=(await one('SELECT updated_at FROM public.business_boards WHERE id=$1',[privateA])).updated_at;
 const next=stages.slice(1).map((s,i)=>({...s,name:i===0?'Renamed':s.name}));
 await as(users.A,()=>q('SELECT public.business_save_columns($1,$2,$3,$4)',[privateA,version,JSON.stringify(next),JSON.stringify({[stages[0].id]:next[0].id})]));
 assert.equal((await one('SELECT stage_id FROM public.tasks WHERE id=$1',[personal.id])).stage_id,next[0].id);
 assert.equal((await one('SELECT count(*)::int n FROM public.task_stages WHERE board_id=$1',[privateA2])).n,4);
 await denied(users.A,'SELECT public.business_save_columns($1,$2,$3,$4)',[privateA,version,JSON.stringify(next),'{}']);
});
await check('Column removal refuses to move inaccessible personal rows without count/content leakage',async()=>{
 const ownInQueue=await save(users.A,queue,'private-inside-shared-board');
 const stages=(await q('SELECT * FROM public.task_stages WHERE board_id=$1 ORDER BY position',[queue])).rows;
 const version=(await one('SELECT updated_at FROM public.business_boards WHERE id=$1',[queue])).updated_at;
 await denied(users.G,'SELECT public.business_save_columns($1,$2,$3,$4)',[queue,version,JSON.stringify(stages.slice(1)),JSON.stringify({[stages[0].id]:stages[1].id})]);
 assert.equal((await one('SELECT stage_id FROM public.tasks WHERE id=$1',[ownInQueue.id])).stage_id,stages[0].id);
 assert.equal((await one('SELECT name FROM public.task_stages WHERE board_id=$1 AND id=$2',[queue,stages[0].id])).name,stages[0].name);
});
await check('Scoped directory and company/contact lookups exclude other sectors',async()=>{
 const company=await as(users.A,()=>one(`INSERT INTO public.companies(workspace_id,sector_id,name,visibility) VALUES($1,$2,'Personal QA company','personal') RETURNING id`,[ws,rel]));
 const contact=await as(users.A,()=>one(`INSERT INTO public.contacts(workspace_id,sector_id,company_id,full_name,visibility) VALUES($1,$2,$3,'Personal QA contact','personal') RETURNING id`,[ws,rel,company.id]));
 for(const n of ['A2','B','C','D','G']){
  assert.equal((await as(users[n],()=>q('SELECT id FROM public.companies WHERE id=$1',[company.id]))).rows.length,0);
  assert.equal((await as(users[n],()=>q('SELECT id FROM public.contacts WHERE id=$1',[contact.id]))).rows.length,0);
 }
 await denied(users.B,`INSERT INTO public.tasks(workspace_id,sector_id,board_id,owner_id,visibility,title,company_id,stage_id) VALUES($1,$2,$3,$4,'personal','bad link',$5,$6)`,[ws,rel,queue,users.B,company.id,await first(queue)]);
 const people=await as(users.G,()=>q('SELECT * FROM public.business_people($1)',[queue]));
 assert.deepEqual(new Set(people.rows.map(p=>p.user_id)),new Set([users.A,users.A2,users.G]));
 await denied(users.A,'SELECT * FROM public.task_people($1)',[ws]);
});
await check('Review/confirmation, idempotency, transfer history and attachment follow the destination',async()=>{
 const conversation=await as(users.G,()=>one('SELECT * FROM public.business_start_conversation($1,$2)',[queue,randomUUID()]));
 const payload={title:'Confirmed QA task',board_id:queue,sector_id:rel,stage_id:await first(queue),unresolved:[]};
 let draft=await as(users.G,()=>one('SELECT * FROM public.task_save_draft($1,$2,0,$3)',[conversation.id,randomUUID(),JSON.stringify(payload)]));
 const fileId=randomUUID(),path=`${ws}/${draft.id}/${fileId}-qa.txt`;
 await as(users.G,()=>q(`INSERT INTO storage.objects(bucket_id,name) VALUES('task-attachments',$1)`,[path]));
 await as(users.G,()=>q(`SELECT public.task_register_attachment($1,$2,'qa.txt','text/plain',5,$3)`,[draft.id,fileId,path]));
 draft=await one('SELECT * FROM public.task_drafts WHERE id=$1',[draft.id]);
 const original=await as(users.G,()=>one('SELECT * FROM public.task_confirm_draft($1,$2)',[draft.id,draft.version]));
 const retry=await as(users.G,()=>one('SELECT * FROM public.task_confirm_draft($1,$2)',[draft.id,draft.version]));assert.equal(original.id,retry.id);
 const transfer=await as(users.G,()=>one('SELECT * FROM public.task_save_draft($1,$2,0,$3,$4)',[conversation.id,randomUUID(),JSON.stringify({...payload,assigned_to:users.A}),original.id]));
 const destination=await as(users.G,()=>one('SELECT * FROM public.task_confirm_draft($1,$2)',[transfer.id,transfer.version]));
 assert.equal(destination.id,original.id);assert.equal(destination.created_by,users.G);assert.equal(destination.assigned_to,users.A);
 assert.equal((await as(users.G,()=>q('SELECT id FROM public.tasks WHERE id=$1',[original.id]))).rows.length,0,'historical creator and board owner lose access');
 assert.equal((await as(users.G,()=>q('SELECT name FROM storage.objects WHERE name=$1',[path]))).rows.length,0,'old draft ownership cannot read file');
 assert.equal((await as(users.A,()=>q('SELECT name FROM storage.objects WHERE name=$1',[path]))).rows.length,1,'destination assignee reads file');
 assert.equal((await as(users.A2,()=>q('SELECT id FROM public.task_attachments WHERE id=$1',[fileId]))).rows.length,0);
 await denied(users.G,'SELECT * FROM public.task_confirm_draft($1,$2)',[transfer.id,transfer.version]);
 const financeBoard=(await one(`SELECT id FROM public.business_boards WHERE workspace_id=$1 AND sector_id=$2 AND owner_id=$3 AND kind='tasks'`,[ws,fin,users.B])).id;
 const c2=await as(users.G,()=>one('SELECT * FROM public.business_start_conversation($1,$2)',[queue,randomUUID()]));
 await denied(users.G,'SELECT * FROM public.task_save_draft($1,$2,0,$3)',[c2.id,randomUUID(),JSON.stringify({...payload,board_id:financeBoard,sector_id:fin})]);
 assert.equal((await one('SELECT count(*)::int n FROM public.tasks WHERE id=$1',[original.id])).n,1);
});
await check('Explicit two-sector manager transfers a single task and its file; source members lose access',async()=>{
 users.H=randomUUID();await q(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'H@isolation.invalid','{"full_name":"H","sector":"relacionamento"}')`,[users.H]);
 await q(`INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')`,[ws,users.H]);
 for(const s of [rel,fin])await as(users.A,()=>q('SELECT public.business_set_sector_member($1,$2,true,true,true)',[s,users.H]));
 const source=await board(users.H,rel,'tasks','sector'),destination=await board(users.H,fin,'tasks','sector');const destinationStage=await first(destination);
 const conversation=await as(users.H,()=>one('SELECT * FROM public.business_start_conversation($1,$2)',[source,randomUUID()]));
 const payload={title:'Cross-sector retained ID',board_id:source,sector_id:rel,stage_id:await first(source),unresolved:[]};
 let draft=await as(users.H,()=>one('SELECT * FROM public.task_save_draft($1,$2,0,$3)',[conversation.id,randomUUID(),JSON.stringify(payload)]));
 const file=randomUUID(),path=`${ws}/${draft.id}/${file}-transfer.txt`;await as(users.H,()=>q(`INSERT INTO storage.objects(bucket_id,name) VALUES('task-attachments',$1)`,[path]));
 await as(users.H,()=>q(`SELECT public.task_register_attachment($1,$2,'transfer.txt','text/plain',5,$3)`,[draft.id,file,path]));draft=await one('SELECT * FROM public.task_drafts WHERE id=$1',[draft.id]);
 const task=await as(users.H,()=>one('SELECT * FROM public.task_confirm_draft($1,$2)',[draft.id,draft.version]));
 assert.equal((await as(users.A,()=>q('SELECT name FROM storage.objects WHERE name=$1',[path]))).rows.length,1);
 const transfer=await as(users.H,()=>one('SELECT * FROM public.task_save_draft($1,$2,0,$3,$4)',[conversation.id,randomUUID(),JSON.stringify({...payload,board_id:destination,sector_id:fin,stage_id:destinationStage}),task.id]));
 const moved=await as(users.H,()=>one('SELECT * FROM public.task_confirm_draft($1,$2)',[transfer.id,transfer.version]));assert.equal(moved.id,task.id);assert.equal(moved.created_by,users.H);assert.equal(moved.sector_id,fin);
 for(const n of ['A','A2','C','D','G']){assert.equal((await as(users[n],()=>q('SELECT id FROM public.tasks WHERE id=$1',[task.id]))).rows.length,0);assert.equal((await as(users[n],()=>q('SELECT name FROM storage.objects WHERE name=$1',[path]))).rows.length,0);}
 assert.equal((await as(users.B,()=>q('SELECT id FROM public.tasks WHERE id=$1',[task.id]))).rows.length,1);assert.equal((await as(users.B,()=>q('SELECT name FROM storage.objects WHERE name=$1',[path]))).rows.length,1);
 assert.ok((await as(users.B,()=>q('SELECT * FROM public.business_task_history($1)',[task.id]))).rows.length>=3);
 assert.equal((await one('SELECT count(*)::int n FROM public.tasks WHERE id=$1',[task.id])).n,1);
});
await check('Lead notes and files inherit the parent; production disables additional module RPCs',async()=>{
 await as(users.A,()=>q(`INSERT INTO public.notes(workspace_id,lead_id,user_id,content) VALUES($1,$2,$3,'Private note')`,[ws,privateLead.id,users.A]));
 for(const n of ['A2','B','C','D','G'])assert.equal((await as(users[n],()=>q('SELECT content FROM public.notes WHERE lead_id=$1',[privateLead.id]))).rows.length,0);
 await denied(users.A2,`INSERT INTO public.notes(workspace_id,lead_id,user_id,content) VALUES($1,$2,$3,'forged')`,[ws,privateLead.id,users.A2]);
 await db.exec("UPDATE app_private.deployment_environment SET name='production'");
 await denied(users.G,'SELECT public.business_start_conversation($1,$2)',[queue,randomUUID()]);
 await denied(users.A,'SELECT public.create_koa_card_issue_operation($1,$2)',[ws,randomUUID()]);
 assert.equal((await as(users.A,()=>q('SELECT id FROM public.tasks WHERE id=$1',[personal.id]))).rows.length,1);
 await db.exec("UPDATE app_private.deployment_environment SET name='development'");
});
await check('Membership revocation blocks new reads and writes without waiting for JWT refresh',async()=>{
 await as(users.A,()=>q('SELECT public.business_set_sector_member($1,$2,false)',[rel,users.A2]));
 assert.equal((await as(users.A2,()=>q('SELECT id FROM public.tasks WHERE id=$1',[personal2.id]))).rows.length,0);
 assert.equal((await as(users.A2,()=>q('SELECT id FROM public.leads WHERE id=$1',[sharedLead.id]))).rows.length,0);
 await denied(users.A2,'SELECT public.business_save_task($1,$2,NULL,NULL,$3)',[privateA2,randomUUID(),JSON.stringify({title:'after revocation'})]);
});
await check('Anonymous role has no protected business read or RPC execution',async()=>{await db.exec('SET ROLE anon');try{await assert.rejects(()=>q('SELECT * FROM public.tasks'));await assert.rejects(()=>q('SELECT public.business_contexts()'));}finally{await db.exec('RESET ROLE');}});
await mkdir('outputs/isolation',{recursive:true});await writeFile('outputs/isolation/database-checks.json',JSON.stringify({engine:db.engine,remoteDatabaseUsed:false,tests:evidence},null,2));if(process.env.ISOLATION_KEEP_OPEN!=='1')await db.close();
export {db,users,ws,rel,fin,com,privateA,privateA2,queue,personal,personal2,shared,privateLead,sharedLead,pPrivate,pShared,pPrivId,pSharedId};
