// Live acceptance checks are hard-bound to the existing QA project; no production credentials.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
import {remoteQuery} from './staging-remote.mjs';
const {createClient}=createRequire(new URL('../../package.json',import.meta.url))('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});
const f=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));assert.equal(f.project,stagingReference);
assert.equal((await remoteQuery("SELECT name FROM app_private.deployment_environment WHERE singleton"))[0].name,'staging');
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const ok=r=>{if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data;};
const rpc=async(c,n,p={})=>ok(await c.rpc(n,p));
const denied=async promise=>assert.ok((await promise).error,'a forbidden RPC must fail');
const clients={},tokens={};
for(const name of ['A','B','G']){
 const c=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 tokens[name]=ok(await c.auth.signInWithPassword({email:f.users[name].email,password:f.password})).session.access_token;clients[name]=c;
}
const server=createClient(env.VITE_SUPABASE_URL,env.STAGING_SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const endpoint=env.VITE_SUPABASE_URL+'/functions/v1/task-ai';
const invoke=(name,body)=>fetch(endpoint,{method:'POST',headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,'content-type':'application/json',...(name?{authorization:'Bearer '+tokens[name]}:{})},body:JSON.stringify(body)});
const report={project:stagingReference,realGoTrue:true,realEdge:true,realOpenAiGeneration:false,productionMutated:false,checks:[]};
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS',name);};
let phaseChanged=false;
const fake='sk-kortex-QA-invalid-not-a-real-key-'+randomUUID().replaceAll('-','');
let scope;
try {
 await check('Verified invitation activates only the intended account in its own organization and is idempotent',async()=>{
  await remoteQuery(`INSERT INTO app_private.task_admin_invites(email) VALUES(${q(f.users.A.email.toLowerCase())}) ON CONFLICT(email) DO NOTHING;`);
  assert.equal(await rpc(clients.B,'task_admin_accept_invite',{p_workspace:f.workspace}),false);
  assert.equal(await rpc(clients.A,'task_admin_accept_invite',{p_workspace:f.workspace}),true);
  assert.equal(await rpc(clients.A,'task_admin_accept_invite',{p_workspace:f.workspace}),true);
  scope=(await rpc(clients.A,'business_contexts')).find(c=>c.workspace_id===f.workspace&&c.kind==='tasks'&&c.visibility==='personal'&&c.can_dispatch);
  assert.ok(scope);assert.equal(await rpc(clients.A,'task_admin_access',{p_board:scope.board_id}),true);
 });
 await check('Anonymous and forged sessions cannot call the hosted Edge Function',async()=>{
  assert.equal((await invoke(null,{action:'connect',workspace_id:f.workspace,api_key:fake,model:'gpt-4.1-mini'})).status,401);
  const r=await fetch(endpoint,{method:'POST',headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,authorization:'Bearer invalid-session','content-type':'application/json'},body:'{}'});assert.equal(r.status,401);
 });
 await check('Sector setup is scoped, idempotent and provides a real authorized team destination',async()=>{
  const beforeRows=(await rpc(clients.A,'business_contexts')).filter(c=>c.kind==='tasks'&&c.visibility==='sector'&&c.sector_name==='Financeiro');const before=beforeRows.map(c=>c.board_id).sort();
  const sector=await rpc(clients.A,'task_admin_create_sector',{p_workspace:f.workspace,p_code:'financeiro'});
  const contexts=await rpc(clients.A,'business_contexts');const destinations=contexts.filter(c=>c.sector_id===sector&&c.kind==='tasks'&&c.visibility==='sector');assert.ok(destinations.length>=1);assert.ok(destinations.some(c=>c.can_dispatch));
  for(const id of before)assert.ok(destinations.some(c=>c.board_id===id));
  assert.equal(destinations.length,beforeRows.some(c=>c.can_dispatch)?before.length:before.length+1);
  assert.equal(await rpc(clients.A,'task_admin_create_sector',{p_workspace:f.workspace,p_code:'financeiro'}),sector);
  assert.deepEqual((await rpc(clients.A,'business_contexts')).filter(c=>c.sector_id===sector&&c.kind==='tasks'&&c.visibility==='sector').map(c=>c.board_id).sort(),destinations.map(c=>c.board_id).sort());
  await denied(clients.B.rpc('task_admin_create_sector',{p_workspace:f.workspace,p_code:'comercial'}));
 });
 await check('Another user cannot configure the connection, read secrets or invoke privileged RPCs directly',async()=>{
  const r=await invoke('B',{action:'connect',workspace_id:f.workspace,api_key:fake,model:'gpt-4.1-mini'});assert.equal(r.status,403);
  for(const name of ['A','B']){
   await denied(clients[name].rpc('task_ai_secret',{p_user:f.users.A.id,p_workspace:f.workspace}));
   await denied(clients[name].rpc('task_ai_configure',{p_user:f.users.A.id,p_workspace:f.workspace,p_key:fake,p_model:'gpt-4.1-mini'}));
  }
 });
 assert.equal((await rpc(clients.A,'task_ai_status',{p_workspace:f.workspace})).configured,false,'do not overwrite a real QA connection');
 await check('The real OpenAI model endpoint rejects an invalid QA key; no connection is saved',async()=>{
  const r=await invoke('A',{action:'connect',workspace_id:f.workspace,api_key:fake,model:'gpt-4.1-mini'});
  const text=await r.text();assert.equal(r.status,422,text);assert.ok(!text.includes(fake));
  assert.equal((await rpc(clients.A,'task_ai_status',{p_workspace:f.workspace})).configured,false);
 });
 await check('Server-only Vault storage encrypts a QA credential and returns only metadata to the administrator',async()=>{
  await rpc(server,'task_ai_configure',{p_user:f.users.A.id,p_workspace:f.workspace,p_key:fake,p_model:'gpt-4.1-mini'});
  const status=await rpc(clients.A,'task_ai_status',{p_workspace:f.workspace});assert.equal(status.configured,true);assert.ok(!JSON.stringify(status).includes(fake));
  assert.equal((await rpc(server,'task_ai_secret',{p_user:f.users.A.id,p_workspace:f.workspace})).api_key,fake);
  const rows=await remoteQuery(`SELECT v.secret::text=${q(fake)} plaintext FROM app_private.task_ai_connections c JOIN vault.secrets v ON v.id=c.secret_id WHERE c.user_id=${q(f.users.A.id)} AND c.workspace_id=${q(f.workspace)};`);assert.equal(rows[0].plaintext,false);
  await denied(clients.B.rpc('task_ai_status',{p_workspace:f.workspace}));
 });
 const conversation=await rpc(clients.A,'business_start_conversation',{p_board:scope.board_id,p_id:randomUUID()});
 const message=await rpc(clients.A,'task_post_message',{p_conversation:conversation.id,p_request:randomUUID(),p_content:'Homologação administrativa: preparar um rascunho para revisão.'});
 const claim=await rpc(server,'task_ai_claim',{p_user:f.users.A.id,p_message:message.id});
 await check('A lease prevents duplicate processing and rejects a spoofed actor',async()=>{
  const duplicate=await server.rpc('task_ai_claim',{p_user:f.users.A.id,p_message:message.id});assert.equal(duplicate.error?.code,'PT409');
  await denied(server.rpc('task_ai_claim',{p_user:f.users.B.id,p_message:message.id}));
 });
 const stage=ok(await clients.A.from('task_stages').select('id').eq('board_id',scope.board_id).eq('archived',false).order('position').limit(1))[0].id;
 const tasksBefore=(await clients.A.from('tasks').select('id',{head:true,count:'exact'}).eq('board_id',scope.board_id)).count;
 await check('An incomplete draft cannot be confirmed; preparing and completing an AI operation creates no task',async()=>{
  const payload={title:'Homologação · revisão administrativa',board_id:scope.board_id,sector_id:scope.sector_id,stage_id:stage,priority:'medium',unresolved:['Confira o prazo.']};
  const draft=await rpc(clients.A,'task_save_draft',{p_conversation:conversation.id,p_id:claim.draft_id,p_version:0,p_payload:payload,p_target:null});
  await denied(clients.A.rpc('task_confirm_draft',{p_id:draft.id,p_version:draft.version}));
  await rpc(server,'task_ai_complete',{p_user:f.users.A.id,p_message:message.id,p_lease:claim.lease_id});
  await rpc(server,'task_ai_complete',{p_user:f.users.A.id,p_message:message.id,p_lease:claim.lease_id});
  assert.equal((await clients.A.from('tasks').select('id',{head:true,count:'exact'}).eq('board_id',scope.board_id)).count,tasksBefore);
  assert.equal(ok(await clients.A.from('task_messages').select('id').eq('conversation_id',conversation.id).eq('role','assistant')).length,1);
 });
 await check('Hosted Edge retry reuses the persisted draft, without making another OpenAI request',async()=>{
  const r=await invoke('A',{action:'interpret',message_id:message.id});const body=await r.json();assert.equal(r.status,200);assert.equal(body.draft_id,claim.draft_id);assert.equal(body.reused,true);
 });
 await check('The administrator can disconnect through the hosted Edge; the secret is removed without affecting the draft',async()=>{
  const r=await invoke('A',{action:'disconnect',workspace_id:f.workspace});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.connection.configured,false);
  assert.equal(ok(await clients.A.from('task_drafts').select('id').eq('id',claim.draft_id)).length,1);
 });
 await remoteQuery("UPDATE app_private.deployment_environment SET name='production' WHERE singleton");phaseChanged=true;
 await check('Production simulation exposes management only to the explicit grant, preserving ordinary tasks',async()=>{
  assert.equal(await rpc(clients.A,'task_admin_access',{p_board:scope.board_id}),true);
  const g=(await rpc(clients.G,'business_contexts')).find(c=>c.kind==='tasks'&&c.can_dispatch);assert.ok(g);
  assert.equal(await rpc(clients.G,'task_admin_access',{p_board:g.board_id}),false);
  await denied(clients.G.rpc('business_start_conversation',{p_board:g.board_id,p_id:randomUUID()}));
  ok(await clients.B.from('tasks').select('id').limit(1));
 });
 await check('Revoking the explicit grant blocks new requests and conversation reads immediately',async()=>{
  await remoteQuery(`UPDATE app_private.task_admin_grants SET active=false WHERE user_id=${q(f.users.A.id)} AND workspace_id=${q(f.workspace)};`);
  assert.equal(await rpc(clients.A,'task_admin_access',{p_board:scope.board_id}),false);
  await denied(clients.A.rpc('task_ai_status',{p_workspace:f.workspace}));
  assert.equal(ok(await clients.A.from('task_conversations').select('id').eq('id',conversation.id)).length,0);
  await remoteQuery(`UPDATE app_private.task_admin_grants SET active=true WHERE user_id=${q(f.users.A.id)} AND workspace_id=${q(f.workspace)};`);
 });
 report.completedAt=new Date().toISOString();
} finally {
 if(phaseChanged)await remoteQuery("UPDATE app_private.deployment_environment SET name='staging' WHERE singleton");
 if(phaseChanged)await remoteQuery(`UPDATE app_private.task_admin_grants SET active=true WHERE user_id=${q(f.users.A.id)} AND workspace_id=${q(f.workspace)};`);
 // No real OpenAI key is used in this test. Never log the credential even when fake.
 try{await server.rpc('task_ai_disconnect',{p_user:f.users.A.id,p_workspace:f.workspace});}catch{/* Preserve the original assertion failure. */}
 await fs.writeFile('outputs/isolation/task-admin-staging-checks.json',JSON.stringify(report,null,2));
}
