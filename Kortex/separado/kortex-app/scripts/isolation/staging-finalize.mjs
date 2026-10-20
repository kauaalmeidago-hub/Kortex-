import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {stagingConfiguration} from './staging-preflight.mjs';
import {remoteQuery} from './staging-remote.mjs';
const {createClient}=createRequire(new URL('../../package.json',import.meta.url))('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});
const fixtures=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));
const report=JSON.parse(await fs.readFile('outputs/isolation/staging-checks.json','utf8'));
const clients={};
for(const name of ['A','A2','B','G']){
 const c=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const login=await c.auth.signInWithPassword({email:fixtures.users[name].email,password:fixtures.password});assert.equal(login.error,null,'normal login');clients[name]=c;
}
const ok=r=>{assert.equal(r.error,null,r.error?.code??'request failed');return r.data;};
const contexts=async name=>ok(await clients[name].rpc('business_contexts',{}));
const qa=async(name,fn)=>{await fn();report.results=report.results.filter(r=>r.name!==name);report.results.push({name,passed:true});await fs.writeFile('outputs/isolation/staging-checks.json',JSON.stringify(report,null,2));console.log('PASS',name);};
const a=(await contexts('A')).find(c=>c.kind==='tasks'&&c.visibility==='personal');
let columns=ok(await clients.A.from('task_stages').select('*').eq('board_id',a.board_id).order('position'));
await qa('Hosted column conflict returns SQLSTATE PT409 explicitly, with no cancellation or repeated mutation',async()=>{
 const started=Date.now();const r=await clients.A.rpc('business_save_columns',{p_board:a.board_id,p_version:'2000-01-01T00:00:00Z',p_columns:columns,p_moves:{}}).retry(false).abortSignal(AbortSignal.timeout(15000));
 assert.equal(r.error?.code,'PT409');report.versionConflictMillis=Date.now()-started;
});
await qa('Hosted concurrency: two normal sessions produce one column commit/one PT409; request key creates one task ID',async()=>{
 const second=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 ok(await second.auth.signInWithPassword({email:fixtures.users.A.email,password:fixtures.password}));
 const current=(await contexts('A')).find(c=>c.board_id===a.board_id);
 const args={p_board:a.board_id,p_version:current.version,p_columns:columns,p_moves:{}};
 const results=await Promise.all([clients.A.rpc('business_save_columns',args).abortSignal(AbortSignal.timeout(15000)),second.rpc('business_save_columns',args).abortSignal(AbortSignal.timeout(15000))]);
 assert.equal(results.filter(r=>!r.error).length,1);assert.equal(results.filter(r=>r.error?.code==='PT409').length,1);
 const request={p_board:a.board_id,p_request:randomUUID(),p_id:null,p_updated:null,p_payload:{title:'Homologação · criação concorrente'}};
 const saved=await Promise.all([clients.A.rpc('business_save_task',request).single(),second.rpc('business_save_task',request).single()]);
 assert.equal(ok(saved[0]).id,ok(saved[1]).id);await second.auth.signOut({scope:'local'});
});
await qa('Hosted shared pipeline: manager cannot remove a column containing an inaccessible personal lead',async()=>{
 const scope=(await contexts('G')).find(c=>c.kind==='pipeline'&&c.visibility==='sector');assert.ok(scope);
 const stages=ok(await clients.G.from('stages').select('*').eq('pipeline_id',scope.pipeline_id).order('position'));
 const lead=ok(await clients.A.from('leads').insert({workspace_id:scope.workspace_id,sector_id:scope.sector_id,pipeline_id:scope.pipeline_id,stage_id:stages[0].id,title:'Homologação · lead pessoal em quadro compartilhado',visibility:'personal'}).select('*').single());
 const r=await clients.G.rpc('business_save_columns',{p_board:scope.board_id,p_version:scope.version,p_columns:stages.slice(1),p_moves:{[stages[0].id]:stages[1].id}}).abortSignal(AbortSignal.timeout(15000));assert.equal(r.error?.code,'42501');
 assert.equal(ok(await clients.A.from('leads').select('stage_id').eq('id',lead.id).single()).stage_id,stages[0].id);
 assert.equal(ok(await clients.G.from('leads').select('id').eq('id',lead.id)).length,0);
});
await qa('Real signed URLs expire after their configured 60-second lifetime',async()=>{
 const items=JSON.parse(await fs.readFile('tmp/staging-expiry-checks.json','utf8'));const evidence=[];
 for(const item of items){assert.ok(Date.now()>item.expiresAt+2000,'URL expiry time has not elapsed');const response=await fetch(item.url,{signal:AbortSignal.timeout(15000)});assert.ok([400,401,403,404].includes(response.status),'expired signed URL must not download');evidence.push({kind:item.kind,status:response.status,lifetimeSeconds:60,expired:true});}
 report.storageExpiry=evidence;report.signedURLExpiryPending=false;
});
await qa('Real session renewal and raw REST do not reveal another sector or a private task',async()=>{
 ok(await clients.B.auth.refreshSession());const session=ok(await clients.B.auth.getSession()).session;
 const response=await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/tasks?id=eq.${fixtures.task}&select=id`,{headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${session.access_token}`},signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),[]);
 const company=ok(await clients.A.from('companies').select('id').eq('workspace_id',fixtures.workspace)).find(Boolean);assert.ok(company);
 const r=await clients.B.rpc('business_save_task',{p_board:fixtures.financeQueue,p_request:randomUUID(),p_id:null,p_updated:null,p_payload:{title:'forged company relation',company_id:company.id}});assert.equal(r.error?.code,'42501');
});
await qa('Trusted production phase blocks administrative dispatch while keeping authorized business reads',async()=>{
 const scope=(await contexts('G')).find(c=>c.kind==='tasks'&&c.visibility==='sector');
 try{
  await remoteQuery("UPDATE app_private.deployment_environment SET name='production' WHERE singleton;");
  assert.equal(ok(await clients.G.rpc('business_modules_enabled',{})),false);
  const result=await clients.G.rpc('business_start_conversation',{p_board:scope.board_id,p_id:randomUUID()});assert.equal(result.error?.code,'42501');
  assert.equal(ok(await clients.A.from('tasks').select('id').eq('id',fixtures.task)).length,1);
 }finally{await remoteQuery("UPDATE app_private.deployment_environment SET name='staging' WHERE singleton;");}
 assert.equal(ok(await clients.G.rpc('business_modules_enabled',{})),true);
});
report.completedAt=new Date().toISOString();await fs.writeFile('outputs/isolation/staging-checks.json',JSON.stringify(report,null,2));
for(const client of Object.values(clients))await client.auth.signOut({scope:'local'});
console.log('HOSTED_STAGING_FINAL_CHECKS_COMPLETE',report.results.length);
