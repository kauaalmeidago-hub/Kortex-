import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {remoteQuery} from './staging-remote.mjs';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
const {env}=await stagingConfiguration({requireDatabase:false});
const version='20261019180000';
if(!(await remoteQuery(`SELECT version FROM supabase_migrations.schema_migrations WHERE version='${version}'`)).length){
 const sql=await fs.readFile('supabase/migrations/'+version+'_task_operational_conversation.sql','utf8');
 await remoteQuery(`BEGIN;SET LOCAL lock_timeout='10s';SELECT pg_advisory_xact_lock(1743120198);${sql}
 INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES('${version}',ARRAY[$task_initial$${sql}$task_initial$],'task_operational_conversation');COMMIT;`);
}
const f=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));assert.equal(f.project,stagingReference);
const {createClient}=createRequire(new URL('../../package.json',import.meta.url))('@supabase/supabase-js');
const ok=r=>{if(r.error)throw Error(r.error.code??'QA_REQUEST_FAILED');return r.data;};
const rpc=async(c,n,p={})=>ok(await c.rpc(n,p));
async function login(name){const c=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});ok(await c.auth.signInWithPassword({email:f.users[name].email,password:f.password}));return c;}
const a=await login('A'),secondTab=await login('A'),b=await login('B'),d=await login('D');
const boards=(await rpc(a,'business_contexts')).filter(c=>c.workspace_id===f.workspace&&c.kind==='tasks'&&c.can_dispatch);
assert.ok(boards.length>=2);
const read=()=>a.from('task_conversations').select('id').eq('workspace_id',f.workspace);
const before=ok(await read()).map(c=>c.id).sort();
const [one,two]=await Promise.all([rpc(a,'task_operational_conversation',{p_board:boards[0].board_id}),rpc(secondTab,'task_operational_conversation',{p_board:boards[0].board_id})]);
assert.equal(one.id,two.id);assert.ok(before.includes(one.id));
assert.deepEqual(ok(await read()).map(c=>c.id).sort(),before);
const another=await rpc(a,'task_operational_conversation',{p_board:boards[1].board_id});assert.equal(another.id,one.id);
const {randomUUID}=await import('node:crypto');
const m=await rpc(a,'task_post_message',{p_conversation:one.id,p_request:randomUUID(),p_content:'Homologação: continuidade da conversa operacional, sem criar tarefa.'});
const again=await rpc(secondTab,'task_operational_conversation',{p_board:boards[0].board_id});assert.equal(again.id,one.id);
assert.ok(ok(await secondTab.from('task_messages').select('id').eq('conversation_id',one.id)).some(r=>r.id===m.id));
for(const c of [b,d]){assert.ok((await c.rpc('task_operational_conversation',{p_board:boards[0].board_id})).error);assert.equal(ok(await c.from('task_messages').select('id').eq('conversation_id',one.id)).length,0);}
// A separate QA administrator proves first creation and isolation without
// modifying any existing person's permissions or production account.
let fresh;if(!process.argv.includes('--fresh'))try{fresh=JSON.parse(await fs.readFile('tmp/task-initial-fixture.json','utf8'));}catch{}
const admin=createClient(env.VITE_SUPABASE_URL,env.STAGING_SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
if(!fresh){
 const {randomBytes}=await import('node:crypto');const password=randomBytes(24).toString('base64url')+'Aa1!';const email='isolation-op-'+Date.now()+'@qa.kortex.invalid';
 const created=ok(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Homologação do chat',sector:'relacionamento'}}));
 fresh={project:stagingReference,email,password,userId:created.user.id};await fs.writeFile('tmp/task-initial-fixture.json',JSON.stringify(fresh));
}
assert.equal(fresh.project,stagingReference);
const freshClient=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
ok(await freshClient.auth.signInWithPassword({email:fresh.email,password:fresh.password}));
const freshScopes=await rpc(freshClient,'business_contexts');fresh.workspace=freshScopes[0].workspace_id;assert.notEqual(fresh.workspace,f.workspace);
await remoteQuery(`INSERT INTO app_private.task_admin_invites(email) VALUES('${fresh.email.replaceAll("'","''")}') ON CONFLICT(email) DO NOTHING;`);
assert.equal(await rpc(freshClient,'task_admin_accept_invite',{p_workspace:fresh.workspace}),true);
const authorized=(await rpc(freshClient,'business_contexts')).find(c=>c.kind==='tasks'&&c.can_dispatch);assert.ok(authorized);fresh.board=authorized.board_id;
const initial=ok(await freshClient.from('task_conversations').select('id').eq('workspace_id',fresh.workspace));
const [created,repeated]=await Promise.all([rpc(freshClient,'task_operational_conversation',{p_board:fresh.board}),rpc(freshClient,'task_operational_conversation',{p_board:fresh.board})]);assert.equal(created.id,repeated.id);assert.notEqual(created.id,one.id);
const createdRows=ok(await freshClient.from('task_conversations').select('id').eq('workspace_id',fresh.workspace));assert.equal(createdRows.length,Math.max(1,initial.length));
fresh.conversation=created.id;await fs.writeFile('tmp/task-initial-fixture.json',JSON.stringify(fresh));
const report={project:stagingReference,completedAt:new Date().toISOString(),realGoTrue:true,productionMutated:false,conversation:one.id,board:boards[0].board_id,freshConversation:created.id,freshWorkspace:fresh.workspace,checks:{concurrentTabsAdoptSameConversation:true,historicalConversationsPreserved:true,openingAndReloadDoNotCreateConversations:true,destinationBoardDoesNotChangeConversation:true,messagesPersistInSameConversation:true,otherSectorAndOrganizationDenied:true,firstCreationIsAtomicAcrossTabs:true,otherUserAndOrganizationHaveSeparateConversation:true}};
await fs.writeFile('outputs/isolation/task-initial-staging-checks.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,checks:8,conversation:one.id}));
