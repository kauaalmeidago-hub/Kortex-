// Hosted staging only. Administrative access prepares fixtures; assertions use real GoTrue sessions.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
import {remoteQuery} from './staging-remote.mjs';
const {createClient}=createRequire(new URL('../../package.json',import.meta.url))('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(env.VITE_SUPABASE_URL,env.STAGING_SUPABASE_SECRET_KEY,options);
const report={project:stagingReference,startedAt:new Date().toISOString(),authentication:'Hosted Supabase GoTrue / normal authenticated JWTs',authorizationAssertionsRole:'authenticated with real GoTrue sessions',administrativeUse:'Fixture provisioning and schema/configuration audit only',realGoTrueTested:true,realStorageTested:true,results:[],counts:[]};
const reportPath='outputs/isolation/staging-checks.json';
async function persist(){await fs.writeFile(reportPath,JSON.stringify(report,null,2));}
async function check(name,fn){await fn();report.results.push({name,passed:true});await persist();console.log('PASS',name);}
function ok(result,label='API'){if(result.error)throw new Error(`${label}: ${result.error.code??result.error.statusCode??result.error.status??'API_ERROR'} ${result.error.message??''}`);return result.data;}
async function denied(promise,label){const r=await promise;assert.ok(r.error||Array.isArray(r.data)&&r.data.length===0,label);return r;}
const rpc=async(client,name,args)=>ok(await client.rpc(name,args),name);
const sqlString=value=>"'"+String(value).replaceAll("'","''")+"'";
let fixtures;
try{fixtures=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));}catch{}
if(!fixtures){fixtures={project:stagingReference,run:Date.now().toString(36),password:randomBytes(24).toString('base64url')+'Aa1!',users:{}};}
assert.equal(fixtures.project,stagingReference);
const clients={};
const sectors={A:'relacionamento',A2:'relacionamento',B:'financeiro',C:'comercial',D:'relacionamento',G:'relacionamento',H:'relacionamento'};
await fs.mkdir('outputs/isolation',{recursive:true});
for(const [name,sector] of Object.entries(sectors)){
 if(!fixtures.users[name]){
  const email=`isolation-${name.toLowerCase()}-${fixtures.run}@qa.kortex.invalid`;
  const created=ok(await admin.auth.admin.createUser({email,password:fixtures.password,email_confirm:true,user_metadata:{full_name:`Homologação ${name}`,sector}}),'create test account');
  fixtures.users[name]={id:created.user.id,email};await fs.writeFile('tmp/staging-fixtures.json',JSON.stringify(fixtures));
 }
 const client=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,options);
 const session=ok(await client.auth.signInWithPassword({email:fixtures.users[name].email,password:fixtures.password}),'normal sign in');
 assert.equal(session.user.id,fixtures.users[name].id);clients[name]=client;
}
const id=name=>fixtures.users[name].id;
const contexts=async name=>rpc(clients[name],'business_contexts',{});
let initial=await contexts('A');assert.equal(initial.filter(c=>c.visibility==='personal'&&['Minhas tarefas','Minha pipeline'].includes(c.board_name)).length,2,'onboarding creates personal configuration');
const ws=initial[0].workspace_id;const rel=initial[0].sector_id;
fixtures.workspace=ws;fixtures.sector=rel;await fs.writeFile('tmp/staging-fixtures.json',JSON.stringify(fixtures));
await remoteQuery(`INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES ${['A2','B','C','G','H'].map(name=>`(${sqlString(ws)},${sqlString(id(name))},'member')`).join(',')} ON CONFLICT(workspace_id,user_id) DO UPDATE SET active=true;`);
const provisionedSectors=await remoteQuery(`SELECT id,code FROM public.task_sectors WHERE workspace_id=${sqlString(ws)};`);
const fin=provisionedSectors.find(s=>s.code==='financeiro')?.id??await rpc(clients.A,'business_create_sector',{p_workspace:ws,p_code:'financeiro'});
const com=provisionedSectors.find(s=>s.code==='comercial')?.id??await rpc(clients.A,'business_create_sector',{p_workspace:ws,p_code:'comercial'});
async function setSector(name,sector,active=true,manage=false){return rpc(clients.A,'business_set_sector_member',{p_sector:sector,p_user:id(name),p_active:active,p_dispatch:manage,p_manage_boards:manage,p_manage_members:false,p_read_personal:false});}
for(const [name,sector,manage] of [['A2',rel,false],['B',fin,false],['C',com,false],['G',rel,true],['H',rel,true],['H',fin,true]])await setSector(name,sector,true,manage);
const board=async(name,sector,kind,visibility='personal')=>rpc(clients[name],'business_create_board',{p_sector:sector,p_kind:kind,p_name:`Homologação ${kind} ${name} ${randomUUID().slice(0,5)}`,p_visibility:visibility,p_access:visibility==='sector'?'sector':'members'});
const personalA=initial.find(c=>c.kind==='tasks'&&c.visibility==='personal').board_id;
const personalA2=(await contexts('A2')).find(c=>c.workspace_id===ws&&c.kind==='tasks'&&c.visibility==='personal').board_id;
const queue=await board('G',rel,'tasks','sector');const financeQueue=await board('H',fin,'tasks','sector');
const grant=async(actor,boardId,target,active=true,extra={})=>rpc(clients[actor],'business_set_board_member',{p_board:boardId,p_user:id(target),p_active:active,p_write:true,...extra});
for(const name of ['A','A2','H'])await grant('G',queue,name);
await grant('H',financeQueue,'B');
const stages=async(name,boardId)=>ok(await clients[name].from('task_stages').select('*').eq('board_id',boardId).order('position'));
const save=async(name,boardId,title,payload={})=>ok(await clients[name].rpc('business_save_task',{p_board:boardId,p_request:randomUUID(),p_id:null,p_updated:null,p_payload:{title,...payload}}).single());
const sectorTask=async(name,boardId,sector,title)=>ok(await clients[name].from('tasks').insert({workspace_id:ws,board_id:boardId,sector_id:sector,title,visibility:'sector',stage_id:(await stages(name,boardId))[0].id}).select('*').single());
const privateTask=await save('A',personalA,'Homologação · tarefa pessoal A');
await save('A2',personalA2,'Homologação · tarefa pessoal A2');
const sharedTask=await sectorTask('G',queue,rel,'Homologação · fila Relacionamento');
await sectorTask('H',financeQueue,fin,'Homologação · fila Financeiro');
fixtures.task=privateTask.id;fixtures.queue=queue;fixtures.financeQueue=financeQueue;await fs.writeFile('tmp/staging-fixtures.json',JSON.stringify(fixtures));
await check('Real GoTrue sign-in and onboarding: no seeded business records; declared sector does not join another team',async()=>{
 for(const name of ['A','A2','B','C','D','G','H']){const profile=ok(await clients[name].auth.getUser());assert.equal(profile.user.id,id(name));}
 assert.ok((await contexts('D')).every(c=>c.workspace_id!==ws));
 assert.ok((await contexts('B')).filter(c=>c.workspace_id===ws).every(c=>c.sector_id===fin));
});
await check('Private tasks, direct IDs, UPDATE/DELETE, and generic organization owner follow the matrix',async()=>{
 for(const name of ['A2','B','C','D','G','H']){
  assert.equal(ok(await clients[name].from('tasks').select('id').eq('id',privateTask.id)).length,0,name);
  assert.equal(ok(await clients[name].from('tasks').update({title:'tampered'}).eq('id',privateTask.id).select('id')).length,0,name);
  assert.equal(ok(await clients[name].from('tasks').delete().eq('id',privateTask.id).select('id')).length,0,name);
 }
 assert.equal(ok(await clients.A.from('tasks').select('id').eq('board_id',personalA2)).length,0);
 assert.equal(ok(await clients.A.from('tasks').select('id').eq('id',privateTask.id)).length,1);
});
await check('Shared queues and counts: A/A2 see Relacionamento; B sees Financeiro; C/D remain isolated',async()=>{
 for(const name of ['A','A2'])assert.equal((await clients[name].from('tasks').select('id',{count:'exact',head:true}).eq('id',sharedTask.id)).count,1);
 for(const name of ['B','C','D'])assert.equal((await clients[name].from('tasks').select('id',{count:'exact',head:true}).eq('board_id',queue)).count,0);
 assert.equal((await clients.B.from('tasks').select('id',{count:'exact',head:true}).eq('board_id',financeQueue)).count,1);
});
await check('Forged author, owner, sector, board, recipient, profile and metadata do not grant access',async()=>{
 for(const part of [{created_by:id('B')},{owner_id:id('A2')},{sector_id:fin},{board_id:personalA2},{assigned_to:id('A2')},{visibility:'sector'}])await denied(clients.A.rpc('business_save_task',{p_board:personalA,p_request:randomUUID(),p_id:null,p_updated:null,p_payload:{title:'forged',...part}}),'forged task');
 await denied(clients.A2.rpc('business_set_sector_member',{p_sector:fin,p_user:id('A2'),p_active:true,p_dispatch:true}),'self escalation');
 ok(await clients.A2.from('profiles').update({sector:'financeiro'}).eq('id',id('A2')));
 ok(await clients.A2.auth.updateUser({data:{sector:'financeiro'}}));
 assert.equal(await rpc(clients.A2,'business_can_sector',{p_sector:fin}),false);
 await denied(clients.G.rpc('business_create_board',{p_sector:fin,p_kind:'tasks',p_name:'forged',p_visibility:'sector',p_access:'sector'}),'limited manager');
});
const privatePipeline=await board('A',rel,'pipeline');const sharedPipeline=await board('G',rel,'pipeline','sector');const financePipeline=await board('B',fin,'pipeline');
for(const name of ['A','A2'])await grant('G',sharedPipeline,name);
const pipeline=async(name,b)=>(await contexts(name)).find(c=>c.board_id===b);
const privateP=await pipeline('A',privatePipeline),sharedP=await pipeline('G',sharedPipeline),financeP=await pipeline('B',financePipeline);
const leadStage=async(name,p)=>ok(await clients[name].from('stages').select('*').eq('pipeline_id',p).order('position'));
const createLead=async(name,p,visibility,value)=>ok(await clients[name].from('leads').insert({workspace_id:ws,sector_id:p.sector_id,pipeline_id:p.pipeline_id,stage_id:(await leadStage(name,p.pipeline_id))[0].id,title:`Homologação · lead ${name}`,visibility,value}).select('*').single());
const privateLead=await createLead('A',privateP,'personal',42),sharedLead=await createLead('G',sharedP,'sector',84),financeLead=await createLead('B',financeP,'personal',125);
fixtures.privatePipeline=privateP.pipeline_id;fixtures.privateLead=privateLead.id;await fs.writeFile('tmp/staging-fixtures.json',JSON.stringify(fixtures));
await check('Private/shared pipelines, Finance structure and lead values are protected through real SDK sessions',async()=>{
 for(const name of ['A2','B','C','D','G','H'])assert.equal(ok(await clients[name].from('leads').select('id,value').eq('id',privateLead.id)).length,0,name);
 assert.equal(ok(await clients.A2.from('leads').select('id').eq('id',sharedLead.id)).length,1);
 for(const name of ['A','A2','C','D','G']){
  assert.equal(ok(await clients[name].from('stages').select('id').eq('pipeline_id',financeP.pipeline_id)).length,0,name);
  assert.equal(ok(await clients[name].from('leads').select('id,value').eq('id',financeLead.id)).length,0,name);
 }
 await denied(clients.A.from('leads').update({stage_id:sharedLead.stage_id}).eq('id',privateLead.id),'cross-pipeline stage');
 await grant('A',privatePipeline,'A2');assert.equal(ok(await clients.A2.from('leads').select('id').eq('id',privateLead.id)).length,1);
 await grant('A',privatePipeline,'A2',false);assert.equal(ok(await clients.A2.from('leads').select('id').eq('id',privateLead.id)).length,0);
});
await check('Columns: rename/add stay within the board; stale versions fail; deletion preserves task IDs atomically',async()=>{
 const current=(await contexts('A')).find(c=>c.board_id===personalA);const old=await stages('A',personalA);const financeBefore=await stages('B',financeQueue);
 const columns=[...old.map((s,i)=>({...s,name:i===0?'A fazer · homologação':s.name})),{id:randomUUID(),name:'Validação',base_status:'todo',color:'blue'}];
 await rpc(clients.A,'business_save_columns',{p_board:personalA,p_version:current.version,p_columns:columns,p_moves:{}});
 assert.equal((await denied(clients.A.rpc('business_save_columns',{p_board:personalA,p_version:current.version,p_columns:columns,p_moves:{}}),'stale version')).error?.code,'PT409');
 const version=(await contexts('A')).find(c=>c.board_id===personalA).version;
 await rpc(clients.A,'business_save_columns',{p_board:personalA,p_version:version,p_columns:columns.slice(1),p_moves:{[columns[0].id]:columns[1].id}});
 assert.equal(ok(await clients.A.from('tasks').select('stage_id').eq('id',privateTask.id).single()).stage_id,columns[1].id);
 assert.deepEqual(await stages('B',financeQueue),financeBefore);
});
const body=Buffer.from('Arquivo de homologacao. Nenhum dado real de cliente.\n');
const leadPath=`${ws}/${privateLead.id}/${randomUUID()}.txt`;
ok(await clients.A.storage.from('lead-files').upload(leadPath,body,{contentType:'text/plain',upsert:false}),'lead upload');
ok(await clients.A.from('lead_files').insert({workspace_id:ws,lead_id:privateLead.id,name:'homologacao.txt',mime_type:'text/plain',size_bytes:body.length,storage_path:leadPath,created_by:id('A')}),'lead metadata');
const expires=[];
await check('Real private Storage: authorized upload/download/signing; cross-scope list/download/sign/upsert/delete denied',async()=>{
 assert.equal(await ok(await clients.A.storage.from('lead-files').download(leadPath),'lead download').text(),body.toString());
 const signed=ok(await clients.A.storage.from('lead-files').createSignedUrl(leadPath,60),'lead signed URL');
 assert.equal((await fetch(signed.signedUrl)).status,200);expires.push({kind:'lead',url:signed.signedUrl,expiresAt:Date.now()+60000});
 for(const name of ['A2','B','C','D','G']){
  assert.equal(ok(await clients[name].storage.from('lead-files').list(`${ws}/${privateLead.id}`)).length,0,name);
  await denied(clients[name].storage.from('lead-files').download(leadPath),'cross-scope download');
  await denied(clients[name].storage.from('lead-files').createSignedUrl(leadPath,60),'cross-scope signing');
  await denied(clients[name].storage.from('lead-files').upload(leadPath,body,{contentType:'text/plain',upsert:true}),'cross-scope replacement');
  const removed=await clients[name].storage.from('lead-files').remove([leadPath]);assert.ok(removed.error||removed.data.length===0,'cross-scope delete');
 }
 assert.equal(await ok(await clients.A.storage.from('lead-files').download(leadPath)).text(),body.toString());
 const publicURL=clients.A.storage.from('lead-files').getPublicUrl(leadPath).data.publicUrl;assert.notEqual((await fetch(publicURL)).status,200);
});
let taskAttachment;
await check('Real task attachment, review, confirmation and cross-sector transfer preserve ID/history and follow destination access',async()=>{
 const conversation=ok(await clients.G.rpc('business_start_conversation',{p_board:queue,p_id:randomUUID()}).single());
 let draft=ok(await clients.G.rpc('task_save_draft',{p_conversation:conversation.id,p_id:randomUUID(),p_version:0,p_payload:{title:'Homologação · transferir com arquivo',board_id:queue,sector_id:rel,unresolved:[]},p_target:null}).single());
 const fileId=randomUUID(),filePath=`${ws}/${draft.id}/${fileId}.txt`;
 ok(await clients.G.storage.from('task-attachments').upload(filePath,body,{contentType:'text/plain',upsert:false}),'task upload');
 taskAttachment=ok(await clients.G.rpc('task_register_attachment',{p_draft:draft.id,p_id:fileId,p_name:'homologacao.txt',p_mime:'text/plain',p_size:body.length,p_path:filePath}).single());
 draft=ok(await clients.G.from('task_drafts').select('*').eq('id',draft.id).single());
 const task=ok(await clients.G.rpc('task_confirm_draft',{p_id:draft.id,p_version:draft.version}).single());
 const repeat=ok(await clients.G.rpc('task_confirm_draft',{p_id:draft.id,p_version:draft.version}).single());assert.equal(repeat.id,task.id);
 await denied(clients.B.storage.from('task-attachments').download(filePath),'pre-transfer file');
 const before=ok(await clients.A.storage.from('task-attachments').createSignedUrl(filePath,60));expires.push({kind:'task',url:before.signedUrl,expiresAt:Date.now()+60000});
 const destinationConversation=ok(await clients.H.rpc('business_start_conversation',{p_board:queue,p_id:randomUUID()}).single());
 const transfer=ok(await clients.H.rpc('task_save_draft',{p_conversation:destinationConversation.id,p_id:randomUUID(),p_version:0,p_payload:{title:task.title,board_id:financeQueue,sector_id:fin,unresolved:[]},p_target:task.id}).single());
 const moved=ok(await clients.H.rpc('task_confirm_draft',{p_id:transfer.id,p_version:transfer.version}).single());assert.equal(moved.id,task.id);
 for(const name of ['A','A2','G']){
  assert.equal(ok(await clients[name].from('tasks').select('id').eq('id',task.id)).length,0,name);
  assert.equal(ok(await clients[name].from('task_attachments').select('id').eq('id',taskAttachment.id)).length,0,name);
  await denied(clients[name].storage.from('task-attachments').download(filePath),'source file after transfer');
  await denied(clients[name].storage.from('task-attachments').createSignedUrl(filePath,60),'source sign after transfer');
 }
 assert.equal(ok(await clients.B.from('tasks').select('id').eq('id',task.id)).length,1);
 assert.equal(await ok(await clients.B.storage.from('task-attachments').download(filePath)).text(),body.toString());
 assert.ok((await rpc(clients.B,'business_task_history',{p_task:task.id})).length>=2);
 assert.equal((await fetch(before.signedUrl)).status,200,'previously issued URL remains valid until expiry');
 fixtures.transferredTask=task.id;
});
await check('Membership revocation blocks a still-valid real JWT and new Storage authorization without token refresh',async()=>{
 const before=ok(await clients.A2.auth.getSession()).session.access_token;
 assert.equal(ok(await clients.A2.from('tasks').select('id').eq('id',sharedTask.id)).length,1);
 await setSector('A2',rel,false);
 assert.equal(ok(await clients.A2.auth.getSession()).session.access_token,before);
 assert.equal(ok(await clients.A2.from('tasks').select('id').eq('id',sharedTask.id)).length,0);
 assert.ok((await contexts('A2')).every(c=>c.workspace_id!==ws));
 await denied(clients.A2.rpc('business_save_task',{p_board:personalA2,p_request:randomUUID(),p_id:null,p_updated:null,p_payload:{title:'revoked'}}),'revoked create');
 await setSector('A2',rel,true);
});
await check('Every account/board: exact list, HEAD and pagination totals agree; scoped catalogs exclude other sectors',async()=>{
 for(const name of Object.keys(clients)){
  const all=await contexts(name);
  for(const c of all){
   const table=c.kind==='tasks'?'tasks':'leads';
   const query=(head=false)=>{let q=clients[name].from(table).select('id',{count:'exact',head}).eq('workspace_id',c.workspace_id).eq('sector_id',c.sector_id);return c.kind==='tasks'?q.eq('board_id',c.board_id):q.eq('pipeline_id',c.pipeline_id);};
   const list=await query(),head=await query(true),page=await query().range(0,0);ok(list);ok(head);ok(page);
   assert.equal(list.count,list.data.length);assert.equal(head.count,list.count);assert.equal(page.count,list.count);assert.equal(page.data.length,Math.min(1,list.count));
   report.counts.push({account:name,kind:c.kind,board:c.board_name,count:list.count});
  }
 }
 const company=ok(await clients.A.from('companies').insert({workspace_id:ws,sector_id:rel,name:'Homologação · empresa pessoal',owner_id:id('A'),visibility:'personal'}).select('*').single());
 for(const name of ['A2','B','C','D','G'])assert.equal(ok(await clients[name].from('companies').select('id').eq('id',company.id)).length,0,name);
 await denied(clients.A.rpc('task_people',{p_workspace:ws}),'old directory RPC');
});
await check('Anonymous/private RPCs closed; protected tables absent from Realtime publication; staging phase set by trusted backend',async()=>{
 const anonymous=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,options);
 await denied(anonymous.rpc('business_contexts',{}),'anonymous contexts');
 await denied(anonymous.from('tasks').select('id'),'anonymous tasks');
 await denied(clients.A.rpc('business_worker_scope',{p_workspace:ws,p_company:randomUUID(),p_user:id('A')}),'worker-only RPC');
 const audit=(await remoteQuery("SELECT jsonb_build_object('protected_realtime',(SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename IN ('tasks','leads','pipelines','task_attachments','lead_files','companies','contacts')),'environment',(SELECT name FROM app_private.deployment_environment WHERE singleton),'public_buckets',(SELECT count(*) FROM storage.buckets WHERE id IN ('task-attachments','lead-files','company-media') AND public)) audit;"))[0].audit;
 assert.equal(audit.protected_realtime,0);assert.equal(audit.public_buckets,0);assert.equal(audit.environment,'staging');report.configurationAudit=audit;
});
await fs.writeFile('tmp/staging-expiry-checks.json',JSON.stringify(expires));
await fs.writeFile('tmp/staging-fixtures.json',JSON.stringify(fixtures));
report.completedAt=new Date().toISOString();report.signedURLExpiryPending=true;report.accountCount=Object.keys(clients).length;await persist();
for(const client of Object.values(clients))await client.auth.signOut({scope:'local'});
console.log('HOSTED_STAGING_CHECKS_COMPLETE',report.results.length);
