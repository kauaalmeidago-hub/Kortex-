// Acceptance tests: hosted staging only, using ordinary authenticated sessions.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
import {remoteQuery} from './staging-remote.mjs';
const {createClient}=createRequire(new URL('../../package.json',import.meta.url))('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});
const fixture=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));
assert.equal(fixture.project,stagingReference);
assert.equal((await remoteQuery("SELECT name FROM app_private.deployment_environment WHERE singleton"))[0].name,'staging');
const version='20261019210000';
if(!(await remoteQuery(`SELECT version FROM supabase_migrations.schema_migrations WHERE version='${version}'`)).length){
 const sql=await fs.readFile(`supabase/migrations/${version}_pipeline_stage_controls.sql`,'utf8');
 await remoteQuery(`BEGIN;SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='60s';${sql}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','pipeline_stage_controls',ARRAY[$migration$${sql}$migration$]);COMMIT;`);
 console.log('APPLIED_STAGING',version);
}
const ok=r=>{if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data;};
const rpc=async(c,n,p={})=>ok(await c.rpc(n,p));
const denied=async p=>assert.ok((await p).error,'forbidden or conflicting operation must fail');
const client=()=>createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const clients={};for(const name of ['A','A2','B','C','G']){clients[name]=client();ok(await clients[name].auth.signInWithPassword({email:fixture.users[name].email,password:fixture.password}));}
const a=clients.A;
const contexts=()=>rpc(a,'business_contexts');
const rel=(await contexts()).find(c=>c.kind==='pipeline'&&c.workspace_id===fixture.workspace&&c.sector_name==='Relacionamento');assert.ok(rel);
const board=await rpc(a,'business_create_board',{p_sector:rel.sector_id,p_kind:'pipeline',p_name:'Homologação · refatoração 19/10',p_visibility:'personal',p_access:'members'});
const scope=async()=>{const c=(await contexts()).find(c=>c.board_id===board);assert.ok(c);return c;};
let current=await scope();const pipeline=current.pipeline_id;
const readStages=async()=>ok(await a.from('stages').select('*').eq('pipeline_id',pipeline).order('position'));
const initial=await readStages();
const names=['Backlog','Implantacao','Vigencia','Boas-Vindas','Cadastro | Conta Azul','Inclusao','Exclusao'];
const stages=names.map((name,i)=>({id:initial[i]?.id??randomUUID(),name,color:'blue',position:i}));
await rpc(a,'business_save_columns',{p_board:board,p_version:current.version,p_columns:stages,p_moves:Object.fromEntries(initial.filter(s=>!stages.some(t=>t.id===s.id)).map(s=>[s.id,stages[0].id]))});
const report={environment:'hosted staging',project:stagingReference,productionMutated:false,migration:version,board,pipeline,checks:[]};
const saveReport=()=>fs.writeFile('outputs/isolation/pipeline-refactor-checks.json',JSON.stringify(report,null,2));
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});await saveReport();console.log('PASS',name);};
const args=async(id,name,create=false)=>({p_board:board,p_version:(await scope()).version,p_id:id,p_name:name,p_create:create});
const makeLead=async(stage,title)=>ok(await a.from('leads').insert({workspace_id:current.workspace_id,sector_id:current.sector_id,pipeline_id:pipeline,stage_id:stage,title,description:'Registro identificado de homologação',visibility:'personal',position:0}).select('*').single());
const mainLead=await makeLead(stages[0].id,'Homologação · revisão de cadastro');
await makeLead(stages[1].id,'Homologação · implantação');await makeLead(stages[3].id,'Homologação · boas-vindas');
await check('Rename persists the trimmed label, same ID, record associations and column order',async()=>{
 await rpc(a,'business_pipeline_column',await args(stages[0].id,'  Backlog revisado  '));
 const actual=await readStages();assert.equal(actual[0].name,'Backlog revisado');assert.deepEqual(actual.map(s=>s.id),stages.map(s=>s.id));
 assert.equal(ok(await a.from('leads').select('stage_id').eq('id',mainLead.id).single()).stage_id,stages[0].id);
 await rpc(a,'business_pipeline_column',await args(stages[0].id,'Backlog'));
});
await check('Empty names and stale versions are refused without losing the persisted stage',async()=>{
 await denied(a.rpc('business_pipeline_column',await args(stages[0].id,'   ')));
 const stale=await args(stages[0].id,'Stale');await rpc(a,'business_pipeline_column',await args(stages[1].id,'Implantacao revisada'));
 await denied(a.rpc('business_pipeline_column',stale));await rpc(a,'business_pipeline_column',await args(stages[1].id,'Implantacao'));
});
const extra=randomUUID();
await check('Stable creation ID deduplicates retries and remains scoped to the original board',async()=>{
 const p=await args(extra,'Homologação · temporária',true);await rpc(a,'business_pipeline_column',p);await rpc(a,'business_pipeline_column',p);
 assert.equal((await readStages()).filter(s=>s.id===extra).length,1);
});
await check('Other organizations/sectors and a same-sector participant cannot manage these stages',async()=>{
 for(const name of ['B','C','G']){await denied(clients[name].rpc('business_pipeline_column',await args(stages[0].id,'Proibido')));await denied(clients[name].rpc('business_pipeline_column_count',{p_board:board,p_id:stages[0].id}));}
 await rpc(a,'business_set_board_member',{p_board:board,p_user:fixture.users.A2.id,p_active:true,p_write:true});
 await denied(clients.A2.rpc('business_pipeline_column',await args(stages[0].id,'Proibido')));
});
await check('Empty stage removal is idempotent and undo restores its original ID',async()=>{
 const request=randomUUID(),p={p_board:board,p_version:(await scope()).version,p_id:extra,p_destination:stages[0].id,p_request:request};
 assert.equal(await rpc(a,'business_pipeline_column_count',{p_board:board,p_id:extra}),0);
 assert.equal((await rpc(a,'business_pipeline_remove_column',p)).undoable,true);await rpc(a,'business_pipeline_remove_column',p);
 await rpc(a,'business_pipeline_restore_column',{p_board:board,p_version:(await scope()).version,p_request:request});
 assert.equal((await readStages()).filter(s=>s.id===extra).length,1);
});
const hidden1=await makeLead(extra,'Homologação · oculto pelo filtro'),hidden2=await makeLead(extra,'Homologação · segundo registro');
await check('Populated removal counts all rows, requires a same-pipeline destination, and migrates without loss',async()=>{
 assert.equal(await rpc(a,'business_pipeline_column_count',{p_board:board,p_id:extra}),2);
 const request=randomUUID(),p={p_board:board,p_version:(await scope()).version,p_id:extra,p_destination:randomUUID(),p_request:request};
 await denied(a.rpc('business_pipeline_remove_column',p));
 const result=await rpc(a,'business_pipeline_remove_column',{...p,p_destination:stages[0].id});assert.deepEqual(result,{count:2,undoable:false});
 const rows=ok(await a.from('leads').select('id,stage_id').in('id',[hidden1.id,hidden2.id]));assert.equal(rows.length,2);assert.ok(rows.every(l=>l.stage_id===stages[0].id));
 await denied(a.rpc('business_pipeline_restore_column',{p_board:board,p_version:(await scope()).version,p_request:request}));
});
await check('Accessible movement keeps the same row, persists stage/position and rejects an invalid target',async()=>{
 ok(await a.from('leads').update({stage_id:stages[6].id,position:4}).eq('id',mainLead.id).eq('updated_at',mainLead.updated_at).select('id').single());
 await denied(a.from('leads').update({stage_id:randomUUID()}).eq('id',mainLead.id).select('id').single());
 const row=ok(await a.from('leads').select('*').eq('id',mainLead.id).single());assert.equal(row.stage_id,stages[6].id);assert.equal(row.position,4);
});
await check('Fresh authenticated reads retain the seven stages, their order, labels and record identities',async()=>{
 const fresh=client();ok(await fresh.auth.signInWithPassword({email:fixture.users.A.email,password:fixture.password}));
 const actual=ok(await fresh.from('stages').select('id,name').eq('pipeline_id',pipeline).order('position'));
 assert.deepEqual(actual.map(s=>s.name),names);assert.deepEqual(actual.map(s=>s.id),stages.map(s=>s.id));
 assert.equal(ok(await fresh.from('leads').select('id').eq('pipeline_id',pipeline)).length,5);
});
report.completedAt=new Date().toISOString();await saveReport();console.log(JSON.stringify({passed:true,checks:report.checks.length,board,pipeline}));
