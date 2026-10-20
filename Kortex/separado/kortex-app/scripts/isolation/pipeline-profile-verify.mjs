// Acceptance tests use identified fixtures and ordinary sessions in hosted staging only.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
import {remoteQuery} from './staging-remote.mjs';
const {createClient}=createRequire(new URL('../../package.json',import.meta.url))('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});
assert.equal((await remoteQuery('SELECT name FROM app_private.deployment_environment WHERE singleton'))[0].name,'staging');
const mediaVersion='20261019234500';
if(!(await remoteQuery(`SELECT version FROM supabase_migrations.schema_migrations WHERE version='${mediaVersion}'`)).length){
 const sql=await fs.readFile(`supabase/migrations/${mediaVersion}_company_media_object_scope.sql`,'utf8');
 await remoteQuery(`BEGIN;SET LOCAL lock_timeout='10s';${sql}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${mediaVersion}','company_media_object_scope',ARRAY[$migration$${sql}$migration$]);COMMIT;`);
 console.log('APPLIED_STAGING',mediaVersion);
}
const fixtures=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));assert.equal(fixtures.project,stagingReference);
const make=()=>createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const ok=r=>{if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data;};
const clients={};for(const name of ['A','B','C','G']){const c=make();ok(await c.auth.signInWithPassword({email:fixtures.users[name].email,password:fixtures.password}));clients[name]=c;}
const a=clients.A, contexts=()=>a.rpc('business_contexts').then(ok);
const rel=(await contexts()).find(c=>c.kind==='pipeline'&&c.workspace_id===fixtures.workspace&&c.sector_name==='Relacionamento');assert.ok(rel);
const baseline=ok(await a.from('stages').select('id,name,position,pipeline_id').eq('pipeline_id',rel.pipeline_id).order('id'));
const board=ok(await a.rpc('business_create_board',{p_sector:rel.sector_id,p_kind:'pipeline',p_name:'Homologação · ficha contextual '+Date.now(),p_visibility:'personal',p_access:'members'}));
const scope=(await contexts()).find(c=>c.board_id===board);assert.ok(scope);
const stages=ok(await a.from('stages').select('*').eq('pipeline_id',scope.pipeline_id).order('position'));
const report={environment:'hosted staging',project:stagingReference,productionMutated:false,board,pipeline:scope.pipeline_id,checks:[],records:[]};
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS',name);};
const companyIds=[],contactIds=[];
for(let i=0;i<2;i++){
 const company=ok(await a.from('companies').insert({workspace_id:scope.workspace_id,sector_id:scope.sector_id,name:`Homologação · empresa ${i+1} · ${Date.now()}`,email:`pipeline-${i+1}@homologacao.invalid`,phone:'11900000001',city:'Homologação',created_by:fixtures.users.A.id}).select('*').single());companyIds.push(company.id);
 const contact=ok(await a.from('contacts').insert({workspace_id:scope.workspace_id,sector_id:scope.sector_id,company_id:company.id,full_name:`Homologação · contato ${i+1}`,job_title:'Contato de teste',email:`contato-${i+1}@homologacao.invalid`,created_by:fixtures.users.A.id}).select('*').single());contactIds.push(contact.id);
 const lead=ok(await a.from('leads').insert({id:randomUUID(),workspace_id:scope.workspace_id,sector_id:scope.sector_id,pipeline_id:scope.pipeline_id,visibility:'personal',stage_id:stages[i%stages.length].id,title:`Homologação · ficha ${i+1}`,company_id:i===0?company.id:null,contact_id:contact.id,created_by:fixtures.users.A.id}).select('*').single());report.records.push({id:lead.id,companyId:company.id,contactId:contact.id});
}
await check('Two cards resolve distinct real companies by direct ID or linked contact ID',async()=>{
 for(const expected of report.records){const lead=ok(await a.from('leads').select('*').eq('id',expected.id).single());const contact=ok(await a.from('contacts').select('*').eq('id',lead.contact_id).single());const company=ok(await a.from('companies').select('*').eq('id',lead.company_id??contact.company_id).single());assert.equal(company.id,expected.companyId);assert.equal(contact.company_id,company.id);}
});
await check('A record without a company/contact remains unlinked',async()=>{
 const lead=ok(await a.from('leads').insert({workspace_id:scope.workspace_id,sector_id:scope.sector_id,pipeline_id:scope.pipeline_id,visibility:'personal',stage_id:stages[0].id,title:'Homologação · sem empresa vinculada',created_by:fixtures.users.A.id}).select('*').single());assert.equal(lead.company_id,null);assert.equal(lead.contact_id,null);report.unlinkedRecord=lead.id;
});
await check('Company edits persist in a fresh authenticated session and stale writes cannot overwrite them',async()=>{
 const previous=ok(await a.from('companies').select('*').eq('id',companyIds[0]).single());
 ok(await a.from('companies').update({name:previous.name+' revisada',phone:'11900000002'}).eq('id',previous.id).eq('updated_at',previous.updated_at).select('id').single());
 const stale=await a.from('companies').update({name:'MUST_NOT_OVERWRITE'}).eq('id',previous.id).eq('updated_at',previous.updated_at).select('id').single();assert.ok(stale.error);
 const fresh=make();ok(await fresh.auth.signInWithPassword({email:fixtures.users.A.email,password:fixtures.password}));const saved=ok(await fresh.from('companies').select('*').eq('id',previous.id).single());assert.equal(saved.phone,'11900000002');assert.ok(saved.name.endsWith('revisada'));
});
let note,file;
await check('Notes and private uploads persist only on the selected company',async()=>{
 note=ok(await a.from('notes').insert({workspace_id:scope.workspace_id,company_id:companyIds[0],user_id:fixtures.users.A.id,content:'Nota identificada de homologação da ficha'}).select('*').single());
 assert.equal(ok(await a.from('notes').select('id').eq('company_id',companyIds[1])).some(n=>n.id===note.id),false);
 const path=`${scope.workspace_id}/${companyIds[0]}/files/${randomUUID()}-homologacao.txt`;
 ok(await a.storage.from('company-media').upload(path,new Blob(['Arquivo de homologação da pipeline'],{type:'text/plain'}),{contentType:'text/plain'}));
 file=ok(await a.from('company_files').insert({workspace_id:scope.workspace_id,company_id:companyIds[0],name:'homologacao-pipeline.txt',storage_path:path,mime_type:'text/plain',size_bytes:34,created_by:fixtures.users.A.id}).select('*').single());
 const signed=ok(await a.storage.from('company-media').createSignedUrl(path,60));assert.equal((await fetch(signed.signedUrl)).status,200);
 assert.equal(ok(await a.from('company_files').select('id').eq('company_id',companyIds[1])).some(f=>f.id===file.id),false);
});
await check('Other organizations, sectors and nonmembers cannot read/edit these records or sign the private file',async()=>{
 for(const name of ['B','C','G']){const c=clients[name];
  for(const [table,id] of [['leads',report.records[0].id],['companies',companyIds[0]],['contacts',contactIds[0]],['notes',note.id],['company_files',file.id]])assert.equal(ok(await c.from(table).select('id').eq('id',id)).length,0,`${name}:${table}`);
  assert.equal(ok(await c.rpc('business_can_company',{p_id:companyIds[0],p_write:true})),false);
  assert.ok((await c.storage.from('company-media').createSignedUrl(file.storage_path,60)).error);
 }
});
await check('Stable creation identity prevents duplicate records on retry',async()=>{
 const id=report.records[0].id;
 const duplicate=await a.from('leads').insert({id,workspace_id:scope.workspace_id,sector_id:scope.sector_id,pipeline_id:scope.pipeline_id,visibility:'personal',stage_id:stages[0].id,title:'DUPLICATE_NOT_ALLOWED',created_by:fixtures.users.A.id});assert.equal(duplicate.error?.code,'23505');assert.equal(ok(await a.from('leads').select('id').eq('id',id)).length,1);
});
await check('Original pipeline stages and order stay unchanged',async()=>{
 assert.deepEqual(ok(await a.from('stages').select('id,name,position,pipeline_id').eq('pipeline_id',rel.pipeline_id).order('id')),baseline);
});
report.completedAt=new Date().toISOString();await fs.writeFile('outputs/isolation/pipeline-profile-checks.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.checks.length,pipeline:scope.pipeline_id}));


