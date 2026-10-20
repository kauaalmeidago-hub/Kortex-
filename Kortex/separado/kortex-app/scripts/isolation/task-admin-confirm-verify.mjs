// Confirmation acceptance uses only the existing staging fixtures, never production.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
import {remoteQuery} from './staging-remote.mjs';
const {createClient}=createRequire(new URL('../../package.json',import.meta.url))('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});
const f=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));
assert.equal(f.project,stagingReference);
assert.equal((await remoteQuery('SELECT name FROM app_private.deployment_environment WHERE singleton'))[0].name,'staging');
const ok=r=>{if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data;};
const rpc=async(c,n,p)=>ok(await c.rpc(n,p));
const clients={};
for(const name of ['A','B','C','D']){
 const c=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 ok(await c.auth.signInWithPassword({email:f.users[name].email,password:f.password}));clients[name]=c;
}
const scope=(await rpc(clients.A,'business_contexts')).find(c=>c.workspace_id===f.workspace&&c.kind==='tasks'&&c.visibility==='sector'&&c.can_dispatch&&c.sector_name==='Financeiro');
assert.ok(scope);
let phase=false;
try{
 await remoteQuery("UPDATE app_private.deployment_environment SET name='production' WHERE singleton");phase=true;
 const conversation=await rpc(clients.A,'business_start_conversation',{p_board:scope.board_id,p_id:randomUUID()});
 const stage=ok(await clients.A.from('task_stages').select('id').eq('board_id',scope.board_id).eq('archived',false).order('position').limit(1))[0].id;
 const before=ok(await clients.A.from('tasks').select('id').eq('board_id',scope.board_id)).length;
 const draft=await rpc(clients.A,'task_save_draft',{p_conversation:conversation.id,p_id:randomUUID(),p_version:0,p_target:null,p_payload:{title:'Homologação · confirmação administrativa',description:'Teste de aceitação após revisão manual; nenhuma emissão ou mensagem externa.',board_id:scope.board_id,sector_id:scope.sector_id,stage_id:stage,priority:'medium',unresolved:[]}});
 assert.equal(ok(await clients.A.from('tasks').select('id').eq('board_id',scope.board_id)).length,before);
 const task=await rpc(clients.A,'task_confirm_draft',{p_id:draft.id,p_version:draft.version});
 assert.equal(task.board_id,scope.board_id);
 assert.equal((await rpc(clients.A,'task_confirm_draft',{p_id:draft.id,p_version:draft.version})).id,task.id);
 assert.equal(ok(await clients.A.from('tasks').select('id').eq('board_id',scope.board_id)).length,before+1);
 // A task deliberately routed to the Financeiro team is readable by its member B.
 // C belongs to another sector; D belongs to a different organization.
 assert.equal(ok(await clients.B.from('tasks').select('id').eq('id',task.id)).length,1);
 for(const name of ['C','D'])assert.equal(ok(await clients[name].from('tasks').select('id').eq('id',task.id)).length,0);
 const report={project:stagingReference,completedAt:new Date().toISOString(),realGoTrue:true,productionPhaseSimulatedOnlyInStaging:true,productionMutated:false,openAiUsed:false,taskId:task.id,checks:{draftAloneCreatesNoTask:true,explicitConfirmationPersistsOneTask:true,repeatedConfirmationIsIdempotent:true,destinationSectorMemberCanRead:true,otherSectorAndOrganizationCannotRead:true}};
 await fs.writeFile('outputs/isolation/task-admin-confirmation-checks.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{if(phase)await remoteQuery("UPDATE app_private.deployment_environment SET name='staging' WHERE singleton");}
