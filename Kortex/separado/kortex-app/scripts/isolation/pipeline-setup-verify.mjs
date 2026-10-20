// Ordinary-session acceptance tests on the explicitly configured hosted staging.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
import {remoteQuery} from './staging-remote.mjs';
const {env}=await stagingConfiguration({requireDatabase:false});const fixture=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));
assert.equal(fixture.project,stagingReference);assert.equal((await remoteQuery('SELECT name FROM app_private.deployment_environment WHERE singleton'))[0].name,'staging');
const version='20261020120000',title='pipeline_initial_setup';
const history=await remoteQuery(`SELECT name FROM supabase_migrations.schema_migrations WHERE version='${version}'`);
if(history.length)assert.equal(history[0].name,title);else{
 const sql=await fs.readFile(`supabase/migrations/${version}_${title}.sql`,'utf8');
 await remoteQuery(`BEGIN;SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='60s';${sql} INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${title}',ARRAY[$migration$${sql}$migration$]);COMMIT;`);console.log('APPLIED_STAGING',version);
}
const ok=r=>{if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data;};
const rpc=async(c,n,p={})=>ok(await c.rpc(n,p));const denied=async p=>assert.ok((await p).error,'Forbidden or invalid operation must fail');
const client=()=>createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const clients={};for(const name of ['A','A2','B','C','D','G']){clients[name]=client();ok(await clients[name].auth.signInWithPassword({email:fixture.users[name].email,password:fixture.password}));}
const a=clients.A,scopes=await rpc(a,'business_pipeline_setup_scopes'),scope=scopes.find(s=>s.workspace_id===fixture.workspace&&s.sector_name==='Relacionamento');assert.ok(scope?.can_create);
const before=await remoteQuery('SELECT id,pipeline_id,name,position FROM public.stages ORDER BY id');
const report={project:stagingReference,productionMutated:false,migration:version,checks:[],created:[]};
const save=()=>fs.writeFile('outputs/isolation/pipeline-setup-checks.json',JSON.stringify(report,null,2));
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});await save();console.log('PASS',name);};
const args={p_sector:scope.sector_id,p_name:' Homologação · configuração inicial ',p_columns:[{name:' Entrada '},{name:'Contato em andamento'},{name:'Acompanhamento'}],p_request:randomUUID(),p_visibility:'personal'};
let created;
await check('One confirmed request creates precisely the requested empty pipeline, with trimmed names and real IDs',async()=>{
 assert.deepEqual(await rpc(a,'business_pipeline_setup_status',{p_request:args.p_request}),[]);
 created=(await rpc(a,'business_create_pipeline_setup',args))[0];assert.ok(created.board_id&&created.pipeline_id);report.created.push(created);
 const stages=ok(await a.from('stages').select('id,name,position').eq('pipeline_id',created.pipeline_id).order('position'));
 assert.deepEqual(stages.map(s=>s.name),['Entrada','Contato em andamento','Acompanhamento']);assert.deepEqual(stages.map(s=>s.position),[0,1,2]);assert.equal(new Set(stages.map(s=>s.id)).size,3);
 assert.equal(ok(await a.from('leads').select('id').eq('pipeline_id',created.pipeline_id)).length,0);
 const p=ok(await a.from('pipelines').select('name,board_id').eq('id',created.pipeline_id).single());assert.equal(p.name,args.p_name.trim());assert.equal(p.board_id,created.board_id);
 assert.ok((await rpc(a,'business_contexts')).some(c=>c.board_id===created.board_id&&c.pipeline_id===created.pipeline_id&&c.can_manage));
});
await check('Concurrent repetitions and uncertain-result lookup return the same IDs without extra boards',async()=>{
 const responses=await Promise.all(Array.from({length:4},()=>rpc(a,'business_create_pipeline_setup',args)));responses.forEach(r=>assert.deepEqual(r[0],created));
 assert.deepEqual((await rpc(a,'business_pipeline_setup_status',{p_request:args.p_request}))[0],created);
 await denied(a.rpc('business_create_pipeline_setup',{...args,p_name:'Different payload'}));
});
await check('Validation failures roll back without leaving a board, pipeline, stage or receipt',async()=>{
 const counts=()=>remoteQuery("SELECT (SELECT count(*) FROM public.business_boards) boards,(SELECT count(*) FROM public.pipelines) pipelines,(SELECT count(*) FROM public.stages) stages,(SELECT count(*) FROM app_private.pipeline_setup_requests) receipts");
 const initial=await counts();
 for(const changes of [{p_name:'  '},{p_name:'x'.repeat(101)},{p_columns:[]},{p_columns:[{name:'  '}]},{p_columns:[{name:12}]},{p_columns:Array.from({length:31},()=>({name:'A'}))},{p_columns:[{name:'x'.repeat(81)}]}])await denied(a.rpc('business_create_pipeline_setup',{...args,p_request:randomUUID(),...changes}));
 assert.deepEqual(await counts(),initial);
});
await check('A failure while inserting a stage rolls back the entire confirmed operation',async()=>{
 const marker='Homologação · falha '+randomUUID(),constraint='qa_pipeline_setup_'+randomUUID().replaceAll('-','');
 const count=()=>remoteQuery("SELECT (SELECT count(*) FROM public.business_boards) boards,(SELECT count(*) FROM public.pipelines) pipelines,(SELECT count(*) FROM public.stages) stages,(SELECT count(*) FROM app_private.pipeline_setup_requests) receipts");
 const before=await count();
 await remoteQuery(`ALTER TABLE public.stages ADD CONSTRAINT ${constraint} CHECK(name <> '${marker}') NOT VALID`);
 try{await denied(a.rpc('business_create_pipeline_setup',{...args,p_request:randomUUID(),p_columns:[{name:'Primeira'},{name:marker}]}));assert.deepEqual(await count(),before);}
 finally{await remoteQuery(`ALTER TABLE public.stages DROP CONSTRAINT ${constraint}`);}
});
await check('Other organizations and sectors cannot create here, read private receipts or see personal pipelines',async()=>{
 for(const name of ['B','C','D']){await denied(clients[name].rpc('business_create_pipeline_setup',{...args,p_request:randomUUID()}));assert.deepEqual(await rpc(clients[name],'business_pipeline_setup_status',{p_request:args.p_request}),[]);assert.equal(ok(await clients[name].from('pipelines').select('id').eq('id',created.pipeline_id)).length,0);}
 assert.equal(ok(await clients.G.from('pipelines').select('id').eq('id',created.pipeline_id)).length,0);
 assert.deepEqual(await rpc(clients.A2,'business_pipeline_setup_status',{p_request:args.p_request}),[]);
 await denied(clients.A2.rpc('business_create_pipeline_setup',{...args,p_visibility:'sector',p_request:randomUUID()}));
 const grants=await remoteQuery("SELECT has_table_privilege('authenticated','app_private.pipeline_setup_requests','SELECT') allowed");assert.equal(grants[0].allowed,false);
});
await check('A single column and duplicate column names preserve the current model rules',async()=>{
 for(const columns of [[{name:'Única'}],[{name:'Igual'},{name:'Igual'}]]){
  const row=(await rpc(a,'business_create_pipeline_setup',{...args,p_name:'Homologação · regras de colunas',p_columns:columns,p_request:randomUUID()}))[0];report.created.push(row);
  assert.deepEqual(ok(await a.from('stages').select('name').eq('pipeline_id',row.pipeline_id).order('position')).map(s=>s.name),columns.map(c=>c.name));
 }
});
await check('A fresh account keeps task onboarding and starts without automatic pipelines',async()=>{
 const admin=createClient(env.VITE_SUPABASE_URL,env.STAGING_SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const email=`pipeline-setup-${randomUUID()}@kortex-staging.invalid`,password=randomUUID()+'aA1!';
 const user=ok(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Homologação pipeline inicial',sector:'relacionamento'}})).user;
 assert.ok(user);const fresh=client();ok(await fresh.auth.signInWithPassword({email,password}));
 const contexts=await rpc(fresh,'business_contexts');assert.equal(contexts.filter(c=>c.kind==='pipeline').length,0);assert.ok(contexts.some(c=>c.kind==='tasks'));
 const options=await rpc(fresh,'business_pipeline_setup_scopes');assert.equal(options.length,1);assert.equal(options[0].can_create,true);
 await rpc(fresh,'business_onboard_personal',{p_sector:'relacionamento'});assert.equal((await rpc(fresh,'business_contexts')).filter(c=>c.kind==='pipeline').length,0);
 report.newAccount=user.id;
 // Keep this identified staging account available for local visual acceptance; never copy into a release.
 await fs.writeFile('tmp/pipeline-setup-visual-user.json',JSON.stringify({project:stagingReference,email,password,id:user.id,sector:options[0].sector_id}));
});
await check('Existing persisted stages retain every ID, name, pipeline and position',async()=>{
 const after=await remoteQuery('SELECT id,pipeline_id,name,position FROM public.stages ORDER BY id');const byId=new Map(after.map(s=>[s.id,s]));before.forEach(s=>assert.deepEqual(byId.get(s.id),s));
});
report.completedAt=new Date().toISOString();await save();console.log(JSON.stringify({passed:true,checks:report.checks.length,created:report.created.length}));
