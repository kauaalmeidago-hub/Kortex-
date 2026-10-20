// Real Responses API acceptance on QA-only records. The configured production
// credential is read server-side in memory; never copied to QA Vault or files.
// Run with the installed tsx loader because the handler is shared TypeScript.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
import {createTaskAiHandler} from '../../supabase/functions/_shared/task-ai-core.ts';
const require=createRequire(new URL('../../automation-server/package.json',import.meta.url));
const {Client}=require('pg');const {createClient}=require('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});
const f=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));assert.equal(f.project,stagingReference);
const secrets={};for(const line of (await fs.readFile('automation-server/.env.local','utf8')).split(/\r?\n/)){const m=line.match(/^(\w+)=(.*)$/);if(m)secrets[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');}
assert.equal(secrets.SUPABASE_URL,'https://vlacojrryjazwrljysqx.supabase.co');
const db=new Client({connectionString:secrets.DATABASE_URL,ssl:{rejectUnauthorized:true,ca:await fs.readFile('tmp/supabase-root.crt','utf8')}});
let credential;
try{await db.connect();await db.query('BEGIN READ ONLY');
 const row=(await db.query("SELECT c.user_id,c.workspace_id FROM app_private.task_ai_connections c JOIN auth.users u ON u.id=c.user_id WHERE lower(u.email)='suportealaive@gmail.com' AND u.email_confirmed_at IS NOT NULL")).rows;assert.equal(row.length,1);
 credential=(await db.query('SELECT public.task_ai_secret($1,$2) value',[row[0].user_id,row[0].workspace_id])).rows[0].value;
 assert.ok(credential?.api_key);await db.query('ROLLBACK');
}finally{await db.end();}
const ok=r=>{if(r.error)throw Error(r.error.code??'DATABASE_ERROR');return r.data;};const rpc=async(c,n,p={})=>ok(await c.rpc(n,p));
const c=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const auth=ok(await c.auth.signInWithPassword({email:f.users.A.email,password:f.password}));
const admin=createClient(env.VITE_SUPABASE_URL,env.STAGING_SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const adapter=client=>({rpc:async(n,p)=>await client.rpc(n,p),read:async(table,columns,filters,limit=501)=>{let q=client.from(table).select(columns);for(const [k,v]of Object.entries(filters))q=q.eq(k,v);return ok(await q.limit(limit));}});
const privileged=adapter(admin);const server={...privileged,rpc:async(n,p)=>{if(n==='task_ai_secret'){assert.equal(p.p_user,f.users.A.id);assert.equal(p.p_workspace,f.workspace);return{data:credential,error:null};}return await privileged.rpc(n,p);}};
let calls=0,configured=false;
const providerDates=[];
const handler=createTaskAiHandler({admin:server,authenticate:async token=>{const r=await c.auth.getUser(token);return r.error||r.data.user?.id!==f.users.A.id?null:{id:r.data.user.id,client:adapter(c)};},fetch:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');calls++;const response=await fetch(url,options);if(response.ok){try{const out=await response.clone().json();const txt=(out.output??[]).flatMap(i=>i.content??[]).filter(i=>i.type==='output_text').map(i=>i.text).join('');providerDates.push(JSON.parse(txt).changes.map(c=>c.payload.due_date));}catch{}}return response;}});
const interpret=async(message)=>{const response=await handler(new Request('http://127.0.0.1:5181/functions/task-ai',{method:'POST',headers:{authorization:'Bearer '+auth.session.access_token,'content-type':'application/json',origin:'http://127.0.0.1:5181'},body:JSON.stringify({action:'interpret',message_id:message.id})}));const body=await response.json();if(!response.ok)throw Error(body.error??'INTERPRETATION_FAILED');return body;};
const report={backend:stagingReference,realOpenAiGeneration:true,realGoTrue:true,productionReadOnly:true,credentialPersistedInQa:false,model:credential.model,checks:[]};
try{
 assert.equal((await rpc(c,'task_ai_status',{p_workspace:f.workspace})).configured,false);
 await rpc(admin,'task_ai_configure',{p_user:f.users.A.id,p_workspace:f.workspace,p_key:'sk-QA-placeholder-not-a-real-key-'+randomUUID(),p_model:credential.model});configured=true;
 const scopes=await rpc(c,'business_contexts');
 const boards=['Relacionamento','Financeiro','Comercial'].map(name=>scopes.find(s=>s.workspace_id===f.workspace&&s.kind==='tasks'&&s.visibility==='sector'&&s.can_dispatch&&s.can_manage&&s.sector_name===name));assert.ok(boards.every(Boolean));
 const conversation=await rpc(c,'business_start_conversation',{p_board:boards[0].board_id,p_id:randomUUID()});report.conversation=conversation.id;report.board=boards[0].board_id;
 const content='Prepare exatamente seis tarefas independentes de homologação, sem empresa, operadora, projeto ou anexos. Use os quadros e pessoas explicitamente indicados. '+Array.from({length:6},(_,i)=>{const b=boards[Math.floor(i/2)];return `${i+1}. Título "Homologação real ${i+1}", setor ${b.sector_name}, quadro "${b.board_name}" (ID ${b.board_id}), responsável ${i===1?f.users.A2.email:f.users.A.email}, vencimento ${20+i}/11/2026, prioridade média, etapa inicial, descrição "Conferir os dados de homologação ${i+1}".`;}).join(' ');
 const message=await rpc(c,'task_post_message',{p_conversation:conversation.id,p_request:randomUUID(),p_content:content});
 const generated=await interpret(message);assert.equal(generated.draft_ids.length,6);
 const context=()=>rpc(c,'task_batch_context',{p_conversation:conversation.id});let rows=(await context()).drafts;assert.equal(rows.length,6);assert.equal(new Set(rows.map(d=>d.payload.sector_id)).size,3);
 assert.equal(rows[1].payload.assigned_to,f.users.A2.id);assert.equal(rows[0].payload.assigned_to,f.users.A.id);assert.ok(rows.every(d=>d.payload.unresolved.length===0));
 const ids=rows.map(d=>d.id);report.checks.push('Real OpenAI request produces six persisted drafts across three authorized sectors, including two different recipients in one sector.');
 const repeated=await interpret(message);assert.equal(repeated.reused,true);assert.equal(calls,1);assert.deepEqual(repeated.draft_ids,ids);
 report.checks.push('Repeating the same real interpretation uses the saved result without another provider request.');
 const update=await rpc(c,'task_post_message',{p_conversation:conversation.id,p_request:randomUUID(),p_content:'Mude somente o prazo da segunda tarefa (número de apresentação 2) para 27/11/2026. Preserve todos os outros campos e as outras cinco tarefas, sem criar novos pedidos.'});
 await interpret(update);const after=(await context()).drafts;assert.deepEqual(after.map(d=>d.id),ids);assert.equal(after[1].payload.due_date,'2026-11-27');assert.equal(after[1].payload.assigned_to,f.users.A2.id);for(let i=0;i<6;i++)if(i!==1)assert.deepEqual(after[i].payload,rows[i].payload);
 report.checks.push('A real natural-language edit updates only task number two, preserving all six IDs and the other five payloads.');
 const selected=after.slice(0,2).map(d=>({id:d.id,version:d.version}));const created=await rpc(c,'task_confirm_batch',{p_conversation:conversation.id,p_items:selected});assert.equal(created.length,2);assert.equal((await context()).drafts.length,4);
 report.checks.push('Explicit confirmation creates two tasks from the real model output and leaves four pending drafts.');
 const add=await rpc(c,'task_post_message',{p_conversation:conversation.id,p_request:randomUUID(),p_content:`Acrescente apenas uma sétima tarefa chamada "Homologação real adicional", no setor ${boards[2].sector_name}, quadro ${boards[2].board_name} ID ${boards[2].board_id}, responsável ${f.users.A.email}, prazo 28/11/2026. Preserve as quatro tarefas pendentes e não repita as já encaminhadas.`});
 await interpret(add);rows=(await context()).drafts;assert.equal(rows.length,5);assert.ok(after.slice(2).every(old=>rows.some(d=>d.id===old.id)));
 report.checks.push('A real additional request appends one draft without duplicating pending or confirmed items.');
 const other=await rpc(c,'business_start_conversation',{p_board:boards[0].board_id,p_id:randomUUID()});const greet=await rpc(c,'task_post_message',{p_conversation:other.id,p_request:randomUUID(),p_content:'Olá, bom dia!'});await interpret(greet);assert.equal((await rpc(c,'task_batch_context',{p_conversation:other.id})).drafts.length,0);
 report.checks.push('A real greeting response creates no draft.');
 report.completedAt=new Date().toISOString();report.openAiRequests=calls;
}catch(error){report.failedCode=error.code??error.message;process.exitCode=1;console.error('OPENAI_BATCH_ACCEPTANCE_FAILED',report.failedCode);}
finally{credential=undefined;report.providerDateFormats=providerDates;if(configured)await rpc(admin,'task_ai_disconnect',{p_user:f.users.A.id,p_workspace:f.workspace});await fs.writeFile('outputs/isolation/task-batches-openai-checks.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:!report.failedCode,checks:report.checks.length,openAiRequests:calls,productionReadOnly:true}));
