import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../tmp/isolation-runtime/package.json',import.meta.url));
const {createClient}=require('@supabase/supabase-js');
const f=JSON.parse(await readFile('tmp/isolation-runtime/fixtures.json','utf8'));const results=[];
const clients=Object.fromEntries(Object.keys(f.users).map(name=>[name,createClient('http://127.0.0.1:54322',f.anon,{accessToken:async()=>f.tokens[name]})]));
const rest=async(name,path,options={})=>fetch('http://127.0.0.1:54322/rest/v1/'+path,{...options,headers:{Authorization:'Bearer '+(f.tokens[name]??f.anon),...options.headers}});
const check=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS',name);};
await check('Native PostgREST 14.5 / SDK: personal task ID and count isolated for A/A2/B/C/D/G',async()=>{
 for(const name of Object.keys(clients)){
  const r=await clients[name].from('tasks').select('id,title',{count:'exact'}).eq('id',f.personal.id);assert.equal(r.error,null,JSON.stringify(r.error));assert.equal(r.count,name==='A'?1:0,name);
 }
});
await check('Native REST: direct update/delete outside permission return zero rows',async()=>{
 for(const method of ['PATCH','DELETE']){const response=await rest('B',`tasks?id=eq.${f.personal.id}`,{method,headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:method==='PATCH'?JSON.stringify({title:'forged'}):undefined});assert.equal(response.status,200);assert.deepEqual(await response.json(),[]);}
});
await check('SDK/RPC: author, sector, board and recipient payload tampering denied',async()=>{
 for(const part of [{created_by:f.users.B},{sector_id:f.fin},{board_id:f.privateA2},{assigned_to:f.users.A2}]){const r=await clients.A.rpc('business_save_task',{p_board:f.privateA,p_request:randomUUID(),p_id:null,p_updated:null,p_payload:{title:'tampered',...part}});assert.equal(r.error?.code,'42501',JSON.stringify(r));}
});
await check('SDK: normal personal creation is persisted and has server-owned identity',async()=>{
 const r=await clients.A.rpc('business_save_task',{p_board:f.privateA,p_request:randomUUID(),p_id:null,p_updated:null,p_payload:{title:'SDK persisted QA'}}).single();assert.equal(r.error,null,JSON.stringify(r.error));assert.equal(r.data.created_by,f.users.A);assert.equal(r.data.owner_id,f.users.A);assert.equal(r.data.assigned_to,f.users.A);
 const read=await clients.A.from('tasks').select('id').eq('id',r.data.id);assert.equal(read.data.length,1);
 assert.equal((await clients.A2.from('tasks').select('id').eq('id',r.data.id)).data.length,0);
 const removed=await clients.A.from('tasks').delete().eq('id',r.data.id).select('id');assert.equal(removed.data.length,1);
});
await check('SDK: sector queue, private/shared pipeline and columns follow the matrix',async()=>{
 for(const name of ['A','A2']){const r=await clients[name].from('tasks').select('id',{count:'exact',head:true}).eq('board_id',f.queue);assert.equal(r.error,null);assert.ok(r.count>=1);}
 for(const name of ['B','C','D']){
  const r=await clients[name].from('tasks').select('id',{count:'exact',head:true}).eq('board_id',f.queue);assert.equal(r.count,0);
  const p=await clients[name].from('stages').select('id',{count:'exact'}).eq('pipeline_id',f.pSharedId);assert.equal(p.count,0);
 }
 assert.equal((await clients.A2.from('leads').select('id').eq('id',f.privateLead.id)).data.length,0);
 assert.equal((await clients.A2.from('leads').select('id').eq('id',f.sharedLead.id)).data.length,1);
});
await check('Native REST: unauthorized RPC, private schema and anonymous role are closed',async()=>{
 const anonymous=await rest('anon','rpc/business_contexts',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.ok([401,403].includes(anonymous.status));
 const privateSchema=await rest('A','deployment_environment',{headers:{'Accept-Profile':'app_private'}});assert.equal(privateSchema.status,406);
 const directory=await clients.A.rpc('task_people',{p_workspace:f.ws});assert.equal(directory.error?.code,'42501');
 const forged=await clients.A2.rpc('business_set_sector_member',{p_sector:f.fin,p_user:f.users.A2,p_active:true,p_dispatch:true});assert.equal(forged.error?.code,'42501');
});
const contextCounts=[];
await check('SDK: each normal account receives only its authorized boards and matching list/HEAD/page totals',async()=>{
 for(const [name,client] of Object.entries(clients)){
  const contexts=await client.rpc('business_contexts');assert.equal(contexts.error,null);
  for(const context of contexts.data){
   const table=context.kind==='tasks'?'tasks':'leads';
   const query=()=>{let q=client.from(table).select('id',{count:'exact'}).eq('workspace_id',context.workspace_id).eq('sector_id',context.sector_id);return context.kind==='tasks'?q.eq('board_id',context.board_id):q.eq('pipeline_id',context.pipeline_id);};
   const listed=await query();const paged=await query().range(0,0);
   let head=client.from(table).select('id',{count:'exact',head:true}).eq('workspace_id',context.workspace_id).eq('sector_id',context.sector_id);
   head=context.kind==='tasks'?head.eq('board_id',context.board_id):head.eq('pipeline_id',context.pipeline_id);
   const total=await head;assert.equal(listed.error,null);assert.equal(paged.error,null);assert.equal(total.error,null);
   assert.equal(listed.data.length,listed.count);assert.equal(total.count,listed.count);assert.equal(paged.count,listed.count);assert.equal(paged.data.length,Math.min(1,listed.count));
   contextCounts.push({account:name,kind:context.kind,board:context.board_name,count:listed.count,pagedCount:paged.count});
  }
 }
});
await writeFile('outputs/isolation/rest-sdk-checks.json',JSON.stringify({nativePostgrest:'14.5',database:'PostgreSQL 17.6 native',tokens:'Synthetic HS256 test JWTs; no service_role used for assertions',realGoTrueTested:false,results,contextCounts},null,2));
