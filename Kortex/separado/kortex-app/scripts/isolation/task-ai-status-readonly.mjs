// Read-only audit. Credentials stay in process memory and never enter the report.
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../automation-server/package.json',import.meta.url));
const {Client}=require('pg');
const env={};
for(const file of ['.env','automation-server/.env.local']){
  for(const line of (await fs.readFile(file,'utf8')).split(/\r?\n/)){
    const m=line.match(/^(\w+)=(.*)$/);
    if(m)env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');
  }
}
if(new URL(env.VITE_SUPABASE_URL).hostname!=='vlacojrryjazwrljysqx.supabase.co')throw Error('TARGET_MISMATCH');
const db=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:12000,
  ssl:{rejectUnauthorized:true,ca:await fs.readFile('tmp/supabase-root.crt','utf8')}});
try{
  await db.connect();await db.query('BEGIN READ ONLY');
  const {rows}=await db.query(`SELECT c.user_id IS NOT NULL configured,c.model,c.updated_at,
    EXISTS(SELECT 1 FROM vault.secrets s WHERE s.id=c.secret_id) secret_present
    FROM app_private.task_admin_grants g LEFT JOIN app_private.task_ai_connections c
    ON c.user_id=g.user_id AND c.workspace_id=g.workspace_id WHERE g.active`);
  const edge=(await db.query("SELECT to_regprocedure('public.task_ai_status(uuid)') IS NOT NULL status_rpc_ready")).rows[0];
  const providers=[];
  if(process.argv.includes('--verify-provider')){
    const credentials=await db.query(`SELECT c.model,v.decrypted_secret credential
      FROM app_private.task_ai_connections c JOIN app_private.task_admin_grants g
      ON g.user_id=c.user_id AND g.workspace_id=c.workspace_id AND g.active
      JOIN vault.decrypted_secrets v ON v.id=c.secret_id`);
    for(const entry of credentials.rows){
      const response=await fetch('https://api.openai.com/v1/models/'+encodeURIComponent(entry.model),{
        headers:{Authorization:'Bearer '+entry.credential},signal:AbortSignal.timeout(12000)});
      providers.push({model:entry.model,httpStatus:response.status,accepted:response.ok});
      entry.credential=null;
    }
  }
  await db.query('ROLLBACK');
  const report={checkedAt:new Date().toISOString(),environment:'production',readOnly:true,...edge,connections:rows,providers};
  await fs.writeFile('outputs/isolation/task-ai-current-status.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}catch(e){console.error('AI_STATUS_UNAVAILABLE',/^[A-Z_0-9]+$/.test(e.code??'')?e.code:'CONNECTION');process.exitCode=1;}
finally{await db.end();}
