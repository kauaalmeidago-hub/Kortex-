// Mutating acceptance checks are hard-bound to the existing hosted QA environment.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
import {remoteQuery} from './staging-remote.mjs';
const {createClient}=createRequire(new URL('../../package.json',import.meta.url))('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});
const f=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));assert.equal(f.project,stagingReference);
const sql=await remoteQuery("SELECT (SELECT name FROM app_private.deployment_environment WHERE singleton) environment, EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261016180000') migrated");
assert.equal(sql[0].environment,'staging');assert.equal(sql[0].migrated,true);
const clients={},report={project:stagingReference,migration:'20261016180000',realGoTrue:true,productionMutated:false,checks:[]};
const ok=r=>{if(r.error)throw Error(`${r.error.code}: ${r.error.message}`);return r.data;};
const rpc=async(c,n,args)=>ok(await c.rpc(n,args));
const denied=async(p)=>{const r=await p;assert.ok(r.error||Array.isArray(r.data)&&!r.data.length);};
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS',name);};
for(const name of ['A','A2','B']){const c=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});ok(await c.auth.signInWithPassword({email:f.users[name].email,password:f.password}));clients[name]=c;}
const a=clients.A;
const contexts=()=>rpc(a,'business_contexts',{});
let scope=(await contexts()).find(c=>c.kind==='tasks'&&c.visibility==='personal'&&c.workspace_id===f.workspace);
assert.ok(scope?.can_manage,'personal owner can manage own configuration');
const stageRows=()=>a.from('task_stages').select('*').eq('board_id',scope.board_id).order('position').then(ok);
const initial=await stageRows(),columnId=randomUUID();
const column=()=>({p_board:scope.board_id,p_version:scope.version,p_id:columnId,p_name:'Homologação · Nova etapa',p_create:true});
await check('Add column is authorized, appended and idempotent even with original version',async()=>{
 const first=await rpc(a,'business_task_column',column());const again=await rpc(a,'business_task_column',column());assert.equal(first.id,columnId);assert.equal(again.id,columnId);
 const after=await stageRows();assert.equal(after.length,initial.length+1);assert.equal(after.at(-1).id,columnId);for(const old of initial)assert.deepEqual(after.find(c=>c.id===old.id),old);
});
await check('Rename preserves ID, position, status, and does not permit empty names or another scope',async()=>{
 scope=(await contexts()).find(c=>c.board_id===scope.board_id);const before=(await stageRows()).find(c=>c.id===columnId);
 const renamed=await rpc(a,'business_task_column',{...column(),p_name:'Homologação · Conferência',p_create:false});assert.equal(renamed.id,before.id);assert.equal(renamed.position,before.position);assert.equal(renamed.base_status,before.base_status);
 await denied(a.rpc('business_task_column',{...column(),p_name:'  ',p_create:false}));
 for(const c of [clients.A2,clients.B])await denied(c.rpc('business_task_column',{...column(),p_name:'Outro setor',p_create:false}));
});
const save=async(title)=>rpc(a,'business_save_task',{p_board:scope.board_id,p_request:randomUUID(),p_id:null,p_updated:null,p_payload:{title,stage_id:columnId,priority:'high'}});
await save('Homologação Kanban · anterior');
let task=await save('Homologação Kanban · recuperação');
// Administrative fixture setup only; all retention/access assertions below use normal sessions.
const fixtureDraft=randomUUID(),fixtureConversation=randomUUID(),fixtureFile=randomUUID();
const fixturePath=`${scope.workspace_id}/${fixtureDraft}/${fixtureFile}-retencao.txt`;
const fixtureBody='Anexo exclusivo de homologação para remoção recuperável.';
const fixtureAdmin=createClient(env.VITE_SUPABASE_URL,env.STAGING_SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
ok(await fixtureAdmin.storage.from('task-attachments').upload(fixturePath,Buffer.from(fixtureBody),{contentType:'text/plain'}));
await remoteQuery(`INSERT INTO public.task_conversations(id,workspace_id,board_id,created_by) VALUES('${fixtureConversation}','${scope.workspace_id}','${scope.board_id}','${f.users.A.id}');
 INSERT INTO public.task_drafts(id,workspace_id,conversation_id,created_by,payload,confirmed_task_id,confirmed_version) VALUES('${fixtureDraft}','${scope.workspace_id}','${fixtureConversation}','${f.users.A.id}','{}','${task.id}',1);
 INSERT INTO public.task_attachments(id,workspace_id,draft_id,task_id,storage_path,name,mime_type,size_bytes,created_by) VALUES('${fixtureFile}','${scope.workspace_id}','${fixtureDraft}','${task.id}','${fixturePath}','retencao.txt','text/plain',${Buffer.byteLength(fixtureBody)},'${f.users.A.id}');`);
await save('Homologação Kanban · posterior');
const list=async()=>ok(await a.from('tasks').select('*').eq('board_id',scope.board_id).order('created_at',{ascending:false}).order('id'));
const before=(await list()).map(t=>t.id),key=randomUUID();
const removal=()=>({p_board:scope.board_id,p_id:task.id,p_updated:task.updated_at,p_request:key});
await check('Recoverable delete hides list, HEAD, direct IDs and permissions, retaining the underlying row',async()=>{
 const removed=await rpc(a,'business_remove_task',removal());assert.equal(removed.id,task.id);assert.ok(removed.deleted_at);assert.equal(removed.stage_id,task.stage_id);assert.equal(removed.created_at,task.created_at);
 assert.equal((await list()).length,before.length-1);assert.equal(ok(await a.from('tasks').select('*').eq('id',task.id)).length,0);
 const head=await a.from('tasks').select('id',{head:true,count:'exact'}).eq('board_id',scope.board_id);ok(head);assert.equal(head.count,before.length-1);
 assert.ok(!(await rpc(a,'business_task_permissions',{p_board:scope.board_id})).some(t=>t.id===task.id));
 const retained=await remoteQuery(`SELECT count(*)::int n FROM public.tasks WHERE id='${task.id}' AND deleted_at IS NOT NULL`);assert.equal(retained[0].n,1);
});
await check('Delete retry is idempotent, late moves/saves cannot resurrect, direct restoration and hard deletion are denied',async()=>{
 assert.equal((await rpc(a,'business_remove_task',removal())).id,task.id);
 const late=await a.rpc('business_move_task',{p_board:scope.board_id,p_id:task.id,p_updated:task.updated_at,p_stage:initial[0].id});assert.equal(late.error?.code,'PT409');
 const edit=await a.rpc('business_save_task',{p_board:scope.board_id,p_id:task.id,p_request:randomUUID(),p_updated:task.updated_at,p_payload:{title:'Late'}});assert.equal(edit.error?.code,'PT409');
 await denied(a.from('tasks').update({deleted_at:null}).eq('id',task.id).select());await denied(a.from('tasks').delete().eq('id',task.id).select());
});
await check('Other users and sectors cannot restore known IDs, even with the deletion operation key',async()=>{
 for(const c of [clients.A2,clients.B]){await denied(c.rpc('business_restore_task',{p_board:scope.board_id,p_id:task.id,p_request:key}));await denied(c.rpc('business_remove_task',removal()));}
});
await check('Undo restores same ID, column, original order and relationships; repeated undo does not duplicate',async()=>{
 const undo={p_board:scope.board_id,p_id:task.id,p_request:key};const restored=await rpc(a,'business_restore_task',undo);await rpc(a,'business_restore_task',undo);
 for(const field of ['id','stage_id','created_at','created_by','request_key','company_id','contact_id','lead_id','owner_id','assigned_to','visibility'])assert.equal(restored[field],task[field],field);
 assert.equal(restored.deleted_at,null);assert.deepEqual((await list()).map(t=>t.id),before);
 const events=await rpc(a,'business_task_history',{p_task:task.id});assert.equal(events.filter(e=>e.kind==='removed').length,1);assert.equal(events.filter(e=>e.kind==='restored').length,1);
 task=restored;
});
await check('Stale removal conflicts and stale undo cannot overwrite a later deletion',async()=>{
 const moved=await rpc(a,'business_move_task',{p_board:scope.board_id,p_id:task.id,p_updated:task.updated_at,p_stage:initial[0].id});
 const old=await a.rpc('business_remove_task',removal());assert.equal(old.error?.code,'PT409');
 const key2=randomUUID();await rpc(a,'business_remove_task',{p_board:scope.board_id,p_id:task.id,p_updated:moved.updated_at,p_request:key2});
 await denied(a.rpc('business_restore_task',{p_board:scope.board_id,p_id:task.id,p_request:key}));await rpc(a,'business_restore_task',{p_board:scope.board_id,p_id:task.id,p_request:key2});
});
let testedAttachment=false;
await check('Concurrent move/remove commits one version and rejects the other without resurrection',async()=>{
 const race=await save('Homologação Kanban · concorrência'),request=randomUUID();
 const results=await Promise.all([a.rpc('business_move_task',{p_board:scope.board_id,p_id:race.id,p_updated:race.updated_at,p_stage:initial[0].id}),a.rpc('business_remove_task',{p_board:scope.board_id,p_id:race.id,p_updated:race.updated_at,p_request:request})]);
 assert.equal(results.filter(r=>!r.error).length,1);assert.equal(results.filter(r=>r.error?.code==='PT409').length,1);
 if(results[1].error){const current=results[0].data;await rpc(a,'business_remove_task',{p_board:scope.board_id,p_id:race.id,p_updated:current.updated_at,p_request:request});}
 assert.equal(ok(await a.from('tasks').select('id').eq('id',race.id)).length,0);
 await rpc(a,'business_restore_task',{p_board:scope.board_id,p_id:race.id,p_request:request});
});
for(const c of Object.values(clients)){
 const attachments=ok(await c.from('task_attachments').select('*').not('task_id','is',null).limit(30));
 for(const attachment of attachments){const rows=ok(await c.from('tasks').select('*').eq('id',attachment.task_id));const t=rows[0];if(!t)continue;
  const permissions=await rpc(c,'business_task_permissions',{p_board:t.board_id});if(!permissions.find(p=>p.id===t.id)?.can_edit)continue;
  await check('Real Storage attachment bytes and links survive removal/undo without permanent deletion',async()=>{
   const bytes=ok(await c.storage.from('task-attachments').download(attachment.storage_path));const request=randomUUID();
   await rpc(c,'business_remove_task',{p_board:t.board_id,p_id:t.id,p_updated:t.updated_at,p_request:request});
   try{const retained=ok(await c.storage.from('task-attachments').download(attachment.storage_path));assert.equal(retained.size,bytes.size);assert.equal(ok(await c.from('task_attachments').select('id').eq('id',attachment.id)).length,1);}
   finally{await rpc(c,'business_restore_task',{p_board:t.board_id,p_id:t.id,p_request:request});}
   assert.equal(ok(await c.storage.from('task-attachments').download(attachment.storage_path)).size,bytes.size);
  });testedAttachment=true;break;
 }if(testedAttachment)break;
}
assert.ok(testedAttachment,'A real QA attachment must be available for the retention assertion');
report.completedAt=new Date().toISOString();report.column=columnId;report.task=task.id;
await fs.writeFile('outputs/isolation/kanban-staging-checks.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.checks.length,project:stagingReference}));
