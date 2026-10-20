// Exercises the real server authorizers against staging, without starting workers or portal workflows.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {stagingConfiguration} from './staging-preflight.mjs';
import {supabaseHttpAccess} from '../../automation-server/dist/security/HttpAccess.js';
import {createWorkerAuthorization} from '../../automation-server/dist/security/WorkerScope.js';
const {createClient}=createRequire(new URL('../../package.json',import.meta.url))('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});
const fixture=JSON.parse(await fs.readFile('tmp/staging-fixtures.json','utf8'));
const config={supabaseUrl:env.VITE_SUPABASE_URL,supabaseSecretKey:env.STAGING_SUPABASE_SECRET_KEY};
const access=supabaseHttpAccess(config),worker=createWorkerAuthorization(config);
const actors={},clients={};
for(const name of ['A','B']){
 const client=createClient(config.supabaseUrl,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const login=await client.auth.signInWithPassword({email:fixture.users[name].email,password:fixture.password});assert.equal(login.error,null);
 const actor=await access.authenticate(login.data.session.access_token);assert.equal(actor.userId,fixture.users[name].id);
 actors[name]=actor;clients[name]=client;
}
const company=await clients.A.from('companies').select('id').eq('workspace_id',fixture.workspace).single();assert.equal(company.error,null);
assert.equal(await access.authenticate('invalid-test-token'),null);
assert.equal(await access.company(actors.A,company.data.id,fixture.workspace,true),true);
assert.equal(await access.company(actors.B,company.data.id,fixture.workspace,false),false);
assert.equal(await access.company(actors.A,company.data.id,undefined,false),false);
const operation={workspaceId:fixture.workspace,companyId:company.data.id,requestedBy:actors.A.userId};
assert.equal(await access.operation(actors.A,operation),true);
assert.equal(await access.operation(actors.B,operation),false);
assert.equal(await worker(operation),true);
assert.equal(await worker({...operation,requestedBy:actors.B.userId}),false);
assert.equal(await worker({...operation,requestedBy:undefined}),false);
const report=JSON.parse(await fs.readFile('outputs/isolation/staging-checks.json','utf8'));
const name='Real server authorizers: GoTrue JWT, privileged apikey with user RLS, requester identity and worker scope validated without dispatch';
report.results=report.results.filter(item=>item.name!==name);report.results.push({name,passed:true});report.completedAt=new Date().toISOString();
await fs.writeFile('outputs/isolation/staging-checks.json',JSON.stringify(report,null,2));
for(const client of Object.values(clients))await client.auth.signOut({scope:'local'});
console.log('PASS',name);
