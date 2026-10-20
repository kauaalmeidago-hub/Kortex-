import fs from 'node:fs/promises';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';import{createClient}from'@supabase/supabase-js';
import{stagingConfiguration,stagingReference}from'./staging-preflight.mjs';import{remoteQuery}from'./staging-remote.mjs';
const{env}=await stagingConfiguration({requireDatabase:false}),fixture=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));assert.equal(fixture.project,stagingReference);assert.equal((await remoteQuery('SELECT name FROM app_private.deployment_environment WHERE singleton'))[0].name,'staging');
const version='20261020140000',name='pipeline_record_profile';const history=await remoteQuery(`SELECT name FROM supabase_migrations.schema_migrations WHERE version='${version}'`);
if(history.length)assert.equal(history[0].name,name);else{const sql=await fs.readFile(`supabase/migrations/${version}_${name}.sql`,'utf8');await remoteQuery(`BEGIN;SET LOCAL lock_timeout='10s';${sql} INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[$migration$${sql}$migration$]);COMMIT;`);console.log('APPLIED_STAGING',version);}
const ok=r=>{if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data;},rpc=async(c,n,p)=>ok(await c.rpc(n,p)),denied=async p=>assert.ok((await p).error);
const clients={};for(const key of ['A','A2','B','C','D']){const c=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});ok(await c.auth.signInWithPassword({email:fixture.users[key].email,password:fixture.password}));clients[key]=c;}
const a=clients.A,scope=(await rpc(a,'business_pipeline_setup_scopes')).find(s=>s.workspace_id===fixture.workspace&&s.sector_name==='Relacionamento');
const before=await remoteQuery('SELECT id,pipeline_id,name,position FROM public.stages ORDER BY id');
const created=(await rpc(a,'business_create_pipeline_setup',{p_sector:scope.sector_id,p_name:'Homologação · ficha completa 20/10',p_columns:[{name:'Triagem personalizada'},{name:'Acompanhamento'},{name:'Conclusão'}],p_request:randomUUID()}))[0];
const stages=ok(await a.from('stages').select('*').eq('pipeline_id',created.pipeline_id).order('position'));
const base={workspace_id:created.workspace_id,sector_id:created.sector_id,pipeline_id:created.pipeline_id,stage_id:stages[0].id,visibility:'personal',title:'Homologação · lead independente'};
let independent=ok(await a.from('leads').insert(base).select('*').single());
const report={project:stagingReference,migration:version,productionMutated:false,board:created.board_id,pipeline:created.pipeline_id,independent:independent.id,checks:[]};
const save=()=>fs.writeFile('outputs/isolation/pipeline-record-checks.json',JSON.stringify(report,null,2));const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});await save();console.log('PASS',name);};
const reread=async(id,c=a)=>ok(await c.from('leads').select('*').eq('id',id).single());
await check('Independent lead fields persist without a company, preserving unrelated values and optimistic conflicts',async()=>{
 const values={phone:'(31) 98765-4321',email:'pipeline-qa@example.invalid',city:'Belo Horizonte',project:'Projeto de homologação',description:'Descrição preservada',offerings:[{product:'Saúde',operator:'Unimed'}]};
 independent=ok(await a.from('leads').update(values).eq('id',independent.id).eq('updated_at',independent.updated_at).select('*').single());assert.equal(independent.company_id,null);for(const[k,v]of Object.entries(values))assert.deepEqual(independent[k],v);
 const stale=independent.updated_at;independent=ok(await a.from('leads').update({city:'Contagem'}).eq('id',independent.id).eq('updated_at',stale).select('*').single());
 await denied(a.from('leads').update({phone:'31999999999'}).eq('id',independent.id).eq('updated_at',stale).select('*').single());assert.equal((await reread(independent.id)).phone,values.phone);
 independent=ok(await a.from('leads').update({phone:''}).eq('id',independent.id).select('*').single());assert.equal(independent.phone,'');assert.equal(independent.email,values.email);
});
await check('Invalid optional values and another organization or sector cannot write or read the lead',async()=>{
 for(const patch of [{email:'invalid'},{phone:'1'},{city:'x'.repeat(161)},{offerings:[{product:'Saúde',operator:''}]}])await denied(a.from('leads').update(patch).eq('id',independent.id).select('*').single());
 for(const key of ['B','C','D']){assert.equal(ok(await clients[key].from('leads').select('id').eq('id',independent.id)).length,0);await denied(clients[key].rpc('business_lead_contact',{p_lead:independent.id,p_contact:randomUUID(),p_action:'create',p_values:{full_name:'Forbidden'}}));}
});
let firstContact;const secondContact=randomUUID();
await check('Several contacts can be created for a companyless lead with stable retry IDs and no fabricated company',async()=>{
 const id=randomUUID(),args={p_lead:independent.id,p_contact:id,p_action:'create',p_values:{full_name:'Homologação · contato financeiro',job_title:'Financeiro',phone:'31987654321',email:'financeiro@example.invalid'}};
 await Promise.all([rpc(a,'business_lead_contact',args),rpc(a,'business_lead_contact',args)]);firstContact=ok(await a.from('contacts').select('*').eq('id',id).single());assert.equal(firstContact.company_id,null);
 await rpc(a,'business_lead_contact',{p_lead:independent.id,p_contact:secondContact,p_action:'create',p_values:{full_name:'Homologação · contato RH'}});
 assert.equal(ok(await a.from('lead_contacts').select('*').eq('lead_id',independent.id)).length,2);assert.equal((await reread(independent.id)).company_id,null);
});
await check('Contact editing checks current version and unlinking preserves the contact and other relationships',async()=>{
 await rpc(a,'business_lead_contact',{p_lead:independent.id,p_contact:firstContact.id,p_action:'edit',p_updated:firstContact.updated_at,p_values:{full_name:'Homologação · contato revisado',phone:'31987654321'}});
 await denied(a.rpc('business_lead_contact',{p_lead:independent.id,p_contact:firstContact.id,p_action:'edit',p_updated:firstContact.updated_at,p_values:{full_name:'Stale'}}));
 await rpc(a,'business_lead_contact',{p_lead:independent.id,p_contact:secondContact,p_action:'unlink'});assert.ok(ok(await a.from('contacts').select('id').eq('id',secondContact).single()));assert.equal(ok(await a.from('lead_contacts').select('*').eq('lead_id',independent.id)).length,1);
});
const company=ok(await a.from('companies').insert({workspace_id:scope.workspace_id,sector_id:scope.sector_id,name:'Homologação · empresa compartilhada não alterada',phone:'3133334444',city:'Cidade da empresa',project:'PME',created_by:fixture.users.A.id,visibility:'personal'}).select('*').single());
const linked=ok(await a.from('leads').insert({...base,title:'Homologação · lead vinculado',company_id:company.id}).select('*').single());report.linked=linked.id;
await check('Linked company is not edited by lead fields; read-only and independent lead access retain existing company restrictions',async()=>{
 ok(await a.from('leads').update({phone:'31912345678',project:'Projeto do lead'}).eq('id',linked.id).select('*').single());assert.deepEqual(ok(await a.from('companies').select('*').eq('id',company.id).single()),company);
 await rpc(a,'business_set_board_member',{p_board:created.board_id,p_user:fixture.users.A2.id,p_active:true,p_write:false});
 assert.ok(ok(await clients.A2.from('leads').select('*').eq('id',linked.id).single()));await denied(clients.A2.from('leads').update({city:'Denied'}).eq('id',linked.id).select('*').single());
 assert.equal(ok(await clients.A2.from('companies').select('*').eq('id',company.id)).length,0);
 await rpc(a,'business_set_board_member',{p_board:created.board_id,p_user:fixture.users.A2.id,p_active:true,p_write:true});
 ok(await clients.A2.from('leads').update({city:'Cidade do lead'}).eq('id',linked.id).select('*').single());assert.equal(ok(await clients.A2.from('companies').select('*').eq('id',company.id)).length,0);
 await denied(clients.A2.from('leads').update({company_id:company.id}).eq('id',independent.id).select('*').single());
});
await check('Notes and files are anchored to the independent lead and protected by its authorization',async()=>{
 const note=ok(await a.from('notes').insert({workspace_id:scope.workspace_id,lead_id:independent.id,user_id:fixture.users.A.id,content:'Homologação · nota do lead independente'}).select('*').single());assert.equal(note.company_id,null);
 const id=randomUUID(),storagePath=`${scope.workspace_id}/${independent.id}/${id}-qa.txt`;ok(await a.storage.from('lead-files').upload(storagePath,new Blob(['Homologação pipeline'],{type:'text/plain'})));
 ok(await a.from('lead_files').insert({id,workspace_id:scope.workspace_id,lead_id:independent.id,name:'qa.txt',mime_type:'text/plain',size_bytes:21,storage_path:storagePath,created_by:fixture.users.A.id}));assert.ok(ok(await a.storage.from('lead-files').createSignedUrl(storagePath,60)).signedUrl);
 assert.equal(ok(await clients.B.from('notes').select('*').eq('id',note.id)).length,0);assert.equal(ok(await clients.B.from('lead_files').select('*').eq('id',id)).length,0);await denied(clients.B.storage.from('lead-files').createSignedUrl(storagePath,60));
});
await check('Movement, stage customization, saved optional fields and existing stage identities remain intact',async()=>{
 ok(await a.from('leads').update({stage_id:stages[1].id,position:3}).eq('id',independent.id).select('*').single());const lead=await reread(independent.id);assert.equal(lead.stage_id,stages[1].id);assert.equal(lead.project,'Projeto de homologação');
 const after=await remoteQuery('SELECT id,pipeline_id,name,position FROM public.stages ORDER BY id'),byId=new Map(after.map(s=>[s.id,s]));before.forEach(s=>assert.deepEqual(byId.get(s.id),s));
});
report.completedAt=new Date().toISOString();await save();console.log(JSON.stringify({passed:true,checks:report.checks.length,board:report.board,pipeline:report.pipeline,independent:report.independent,linked:report.linked}));
