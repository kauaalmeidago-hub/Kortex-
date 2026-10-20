// Hosted Edge wiring acceptance: reuses completed QA interpretations only.
// A nonfunctional placeholder is temporarily configured; never invokes OpenAI.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
const require=createRequire(new URL('../../automation-server/package.json',import.meta.url));
const {createClient}=require('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});
const f=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));
const proof=JSON.parse(await fs.readFile('outputs/isolation/task-batches-openai-checks.json','utf8'));
assert.equal(f.project,stagingReference);assert.equal(proof.checks.length,6);
const client=key=>createClient(env.VITE_SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});
const c=client(env.VITE_SUPABASE_PUBLISHABLE_KEY),b=client(env.VITE_SUPABASE_PUBLISHABLE_KEY),admin=client(env.STAGING_SUPABASE_SECRET_KEY);
const ok=r=>{if(r.error)throw Error(r.error.code??'QA_REQUEST_FAILED');return r.data;};
const rpc=async(c,n,p={})=>ok(await c.rpc(n,p));
const aAuth=ok(await c.auth.signInWithPassword({email:f.users.A.email,password:f.password}));
const bAuth=ok(await b.auth.signInWithPassword({email:f.users.B.email,password:f.password}));
const messages=ok(await c.from('task_messages').select('id').eq('conversation_id',proof.conversation).eq('role','user').order('created_at').limit(1));
assert.equal(messages.length,1);
const invoke=token=>fetch(env.VITE_SUPABASE_URL+'/functions/v1/task-ai',{method:'POST',headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({action:'interpret',message_id:messages[0].id}),signal:AbortSignal.timeout(20000)});
const report={project:stagingReference,hostedEdge:true,upstreamRequests:0,checks:[]};let configured=false;
try{
 assert.equal((await rpc(c,'task_ai_status',{p_workspace:f.workspace})).configured,false);
 await rpc(admin,'task_ai_configure',{p_user:f.users.A.id,p_workspace:f.workspace,p_key:'sk-QA-placeholder-not-a-real-key-'+randomUUID(),p_model:proof.model});configured=true;
 const response=await invoke(aAuth.session.access_token);assert.equal(response.status,200);const result=await response.json();assert.equal(result.reused,true);assert.equal(result.draft_ids.length,6);
 report.checks.push('Hosted task-ai reuses six saved IDs for the authorized normal QA session without calling a provider.');
 const forbidden=await invoke(bAuth.session.access_token);assert.equal(forbidden.status,403);report.checks.push('A normal account from another sector cannot interpret the conversation.');
 const anonymous=await invoke();assert.equal(anonymous.status,401);report.checks.push('The hosted endpoint rejects anonymous requests.');
 const forged=await invoke('invalid.qa.token');assert.equal(forged.status,401);report.checks.push('The hosted endpoint rejects invalid sessions.');
}catch(error){report.failedCode=error.code??error.message;process.exitCode=1;console.error('HOSTED_EDGE_CHECK_FAILED',report.failedCode);}
finally{if(configured)await rpc(admin,'task_ai_disconnect',{p_user:f.users.A.id,p_workspace:f.workspace});report.completedAt=new Date().toISOString();await fs.writeFile('outputs/isolation/task-batches-hosted-edge-checks.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:!report.failedCode,checks:report.checks.length,upstreamRequests:0}));
