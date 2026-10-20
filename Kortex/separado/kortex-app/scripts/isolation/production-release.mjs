// Explicit production release: preserve legacy records; never seed production.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(new URL('../../automation-server/package.json',import.meta.url));
const {Client}=require('pg');
const ref='vlacojrryjazwrljysqx';
const sha=value=>createHash('sha256').update(value).digest('hex');
const env={};
for(const name of ['.env','automation-server/.env.local']){
  const source=await fs.readFile(path.join(root,name),'utf8');
  for(const line of source.split(/\r?\n/)){const m=line.match(/^(\w+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');}
}
if(env.VITE_SUPABASE_URL!==`https://${ref}.supabase.co`||env.SUPABASE_URL!==env.VITE_SUPABASE_URL)throw Error('PRODUCTION_TARGET_MISMATCH');
const db=new URL(env.DATABASE_URL);
if(!decodeURIComponent(db.username).includes(ref)&&!db.hostname.includes(ref))throw Error('DATABASE_TARGET_MISMATCH');
const client=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true,ca:await fs.readFile(path.join(root,'tmp/supabase-root.crt'),'utf8')}});
const reportDir=path.join(root,'outputs/isolation');await fs.mkdir(reportDir,{recursive:true});
const manifestFile=path.join(root,'tmp/production-backups/latest.json');
async function inventory(){
 const tables=(await client.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='id' ORDER BY table_name")).rows;
 const inventory={};
 for(const {table_name:name} of tables){const quoted='"'+name.replaceAll('"','""')+'"';inventory[name]=(await client.query(`SELECT count(*)::int count,coalesce(jsonb_agg(id::text ORDER BY id::text),'[]') ids FROM public.${quoted}`)).rows[0];}
 const versions=(await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r=>r.version);
 return {inventory,versions,users:(await client.query('SELECT count(*)::int n FROM auth.users')).rows[0].n};
}
try{
 await client.connect();
 if(process.argv.includes('--backup')){
  const folder=path.join(root,'tmp/production-backups',new Date().toISOString().replaceAll(/[:.]/g,'-'));await fs.mkdir(folder,{recursive:true});
  const before=await inventory();
  const dump=path.join(folder,'database.dump');
  const bin=path.join(root,'tmp/isolation-runtime/native/pgsql/bin');
  const pgEnv={...process.env,PGPASSWORD:decodeURIComponent(db.password),PGSSLMODE:'verify-full',PGSSLROOTCERT:path.join(root,'tmp/supabase-root.crt')};
  const connection=['--host',db.hostname,'--port',db.port||'5432','--username',decodeURIComponent(db.username),'--dbname',db.pathname.slice(1)];
  await run(path.join(bin,'pg_dump.exe'),[...connection,'--format=custom','--no-owner','--no-acl','--schema=public','--schema=auth','--schema=storage','--schema=vault','--schema=app_private','--schema=supabase_migrations','--file',dump],{env:pgEnv,windowsHide:true,timeout:180000,maxBuffer:1024*1024});
  const {stdout:list}=await run(path.join(bin,'pg_restore.exe'),['--list',dump],{windowsHide:true,maxBuffer:8*1024*1024});
  if(!list.includes('TABLE DATA public tasks')||!list.includes('TABLE DATA auth users'))throw Error('BACKUP_CONTENT_INCOMPLETE');
  await fs.writeFile(path.join(folder,'contents.txt'),list);
  const report={project:ref,createdAt:new Date().toISOString(),dump,sha256:sha(await fs.readFile(dump)),bytes:(await fs.stat(dump)).size,before};
  await fs.writeFile(manifestFile,JSON.stringify(report,null,2));
  await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({backupCreated:true,bytes:report.bytes,tables:Object.keys(before.inventory).length,users:before.users,migrations:before.versions.length}));
 }else if(process.argv.includes('--migrate')){
  const backup=JSON.parse(await fs.readFile(manifestFile,'utf8'));
  if(backup.project!==ref||sha(await fs.readFile(backup.dump))!==backup.sha256)throw Error('VERIFIED_BACKUP_REQUIRED');
  const before=await inventory();
  if(JSON.stringify(before)!==JSON.stringify(backup.before))throw Error('PRODUCTION_CHANGED_SINCE_BACKUP');
  const all=(await fs.readdir(path.join(root,'supabase/migrations'))).filter(n=>/^\d{14}_.*\.sql$/.test(n)).sort();
  if(before.versions.some(v=>!all.some(n=>n.startsWith(v+'_'))))throw Error('UNRECONCILED_MIGRATIONS');
  const candidates=all.filter(n=>!before.versions.includes(n.slice(0,14)));
  const versionOption=process.argv.find(arg=>arg.startsWith('--versions='));
  const requested=versionOption?.slice('--versions='.length).split(',');
  if(requested?.some(v=>!/^\d{14}$/.test(v)||!all.some(n=>n.startsWith(v+'_'))))throw Error('INVALID_EXPLICIT_MIGRATION_LIST');
  const pending=requested?candidates.filter(n=>requested.includes(n.slice(0,14))):candidates;
  if(pending.some(n=>!['20261015200000','20261016143000','20261016180000','20261016200000','20261016201000','20261016202000','20261016203000','20261016220000','20261019180000','20261019200000','20261019203000','20261019210000','20261019234500','20261019230000','20261019231000','20261019232000','20261020120000','20261020140000'].includes(n.slice(0,14))))throw Error('UNREVIEWED_PRODUCTION_MIGRATION');
  await client.query('BEGIN');
  try{
   await client.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='90s';SELECT pg_advisory_xact_lock(1743120198)");
   for(const name of pending){
    const source=await fs.readFile(path.join(root,'supabase/migrations',name),'utf8');
    await client.query(source);
    await client.query('INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES($1,$2,$3)',[name.slice(0,14),[source],name.slice(15,-4)]);
   }
   if((await client.query('SELECT name FROM app_private.deployment_environment WHERE singleton')).rows[0]?.name!=='production')throw Error('PRODUCTION_PHASE_REQUIRED');
   const after=await inventory();
   for(const [name,table] of Object.entries(before.inventory))if(JSON.stringify(after.inventory[name])!==JSON.stringify(table))throw Error('LEGACY_RECORDS_CHANGED:'+name);
   if(after.users!==before.users)throw Error('AUTH_USERS_CHANGED');
   const audit=(await client.query(`SELECT jsonb_build_object('tasks_restricted',(SELECT count(*) FROM public.tasks WHERE visibility='restricted'),'pipelines_restricted',(SELECT count(*) FROM public.pipelines WHERE visibility='restricted'),'leads_restricted',(SELECT count(*) FROM public.leads WHERE visibility='restricted'),'environment',(SELECT name FROM app_private.deployment_environment WHERE singleton),'rls_enabled',NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('tasks','leads','pipelines','companies','contacts','business_boards') AND NOT c.relrowsecurity)) audit`)).rows[0].audit;
   await client.query('COMMIT');
   const report={project:ref,completedAt:new Date().toISOString(),backupVerified:true,backupPath:backup.dump,backupSha256:backup.sha256,migrations:pending,skippedMigrations:candidates.filter(n=>!pending.includes(n)),legacyIdsAndCountsPreserved:true,users:after.users,audit};
   await fs.writeFile(path.join(reportDir,'production-migrations.json'),JSON.stringify(report,null,2));
   console.log(JSON.stringify(report));
  }catch(error){await client.query('ROLLBACK');throw error;}
 }else throw Error('Use --backup or --migrate');
}catch(error){await fs.writeFile(path.join(root,'tmp/pipeline-full-production-diagnostic.log'),String(error.stderr??error.message));console.error('PRODUCTION_RELEASE_FAILED',error.code??error.message);process.exitCode=1;}finally{await client.end();}


