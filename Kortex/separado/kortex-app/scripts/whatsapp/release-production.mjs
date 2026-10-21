// Explicitly scoped release; credentials and backup data remain local and ignored.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { Client } = createRequire(new URL('../../automation-server/package.json', import.meta.url))('pg');
const ref = 'vlacojrryjazwrljysqx';
const files = [
 '20261020173632_whatsapp_local_provider_relay.sql', '20261020175148_whatsapp_authenticated_events.sql',
 '20261020210000_whatsapp_chat.sql', '20261020211000_whatsapp_read.sql', '20261020212000_whatsapp_onboarding.sql',
 '20261020213000_whatsapp_signup_proof.sql', '20261020214000_whatsapp_cleanup_guard.sql',
 '20261021201659_whatsapp_case_phases_transfer.sql', '20261021201821_whatsapp_case_security_review.sql',
];
const env = Object.fromEntries((await fs.readFile('automation-server/.env.local','utf8')).split(/\r?\n/).flatMap(l => {
 const m=l.match(/^(\w+)=(.*)$/);return m?[[m[1],m[2].trim().replace(/^["']|["']$/g,'')]]:[];
}));
const url = new URL(env.DATABASE_URL);
if(env.SUPABASE_URL!==`https://${ref}.supabase.co` || (!decodeURIComponent(url.username).includes(ref)&&!url.hostname.includes(ref))) throw Error('WRONG_PRODUCTION_TARGET');
for(const key of ['sslmode','sslrootcert','sslcert','sslkey'])url.searchParams.delete(key);
const client = new Client({connectionString:url.href,ssl:{rejectUnauthorized:true,ca:await fs.readFile('tmp/supabase-root.crt','utf8')},connectionTimeoutMillis:15000});
const hash = data => createHash('sha256').update(data).digest('hex');
async function inventory() {
 const tables=(await client.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='id' ORDER BY table_name")).rows;
 const inventory={};
 for(const {table_name:name} of tables) inventory[name]=(await client.query(`SELECT count(*)::int count,coalesce(jsonb_agg(id::text ORDER BY id::text),'[]') ids FROM public."${name.replaceAll('"','""')}"`)).rows[0];
 return {inventory,versions:(await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r=>r.version),users:(await client.query('SELECT count(*)::int n FROM auth.users')).rows[0].n};
}
try {
 if(!process.argv.includes('--migrate'))throw Error('EXPLICIT_MIGRATE_REQUIRED');
 const backup=JSON.parse(await fs.readFile('tmp/production-backups/latest.json','utf8'));
 if(backup.project!==ref || hash(await fs.readFile(backup.dump))!==backup.sha256 || Date.now()-Date.parse(backup.createdAt)>3600000)throw Error('RECENT_VERIFIED_BACKUP_REQUIRED');
 await client.connect();
 if((await client.query('SELECT name FROM app_private.deployment_environment WHERE singleton')).rows[0]?.name!=='production')throw Error('PRODUCTION_REQUIRED');
 const before=await inventory();
 if(JSON.stringify(before)!==JSON.stringify(backup.before))throw Error('PRODUCTION_CHANGED_SINCE_BACKUP');
 const pending=files.filter(f=>!before.versions.includes(f.slice(0,14)));
 await client.query('BEGIN');
 try {
  await client.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='90s';SELECT pg_advisory_xact_lock(1743120198)");
  for(const file of pending){
   const sql=await fs.readFile('supabase/migrations/'+file,'utf8');
   await client.query(sql);
   await client.query('INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES($1,$2,$3)',[file.slice(0,14),[sql],file.slice(15,-4)]);
  }
  const after=await inventory();
  if(after.users!==before.users)throw Error('EXISTING_AUTH_USERS_CHANGED');
  for(const [table,value] of Object.entries(before.inventory))if(JSON.stringify(after.inventory[table])!==JSON.stringify(value))throw Error('EXISTING_RECORDS_CHANGED:'+table);
  const unsafe=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'wa_%' AND NOT rowsecurity")).rows;
  if(unsafe.length)throw Error('CHAT_RLS_REQUIRED');
  await client.query("NOTIFY pgrst,'reload schema';COMMIT");
  const report={project:ref,at:new Date().toISOString(),backupSha256:backup.sha256,migrations:pending,existingRecordIdsAndCountsPreserved:true,users:after.users,rlsEnabled:true};
  await fs.mkdir('outputs/whatsapp-production',{recursive:true});
  await fs.writeFile('outputs/whatsapp-production/migrations.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){await client.query('ROLLBACK');throw e;}
}catch(e){await fs.writeFile('tmp/whatsapp-production-release.error.log',String(e.message));console.error('WHATSAPP_PRODUCTION_RELEASE_FAILED',e.code||e.message);process.exitCode=1;}finally{await client.end();}
