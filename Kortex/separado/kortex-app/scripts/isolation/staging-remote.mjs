// Uses the user's existing Supabase CLI login. The original linked project is never changed.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {stagingReference,stagingConfiguration} from './staging-preflight.mjs';

const run=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function cliJson(output){
  const text=output.replace(/^\uFEFF/,'');
  const start=text.indexOf('{');
  if(start<0)throw new Error('CLI_JSON_UNAVAILABLE');
  return JSON.parse(text.slice(start,text.lastIndexOf('}')+1));
}
export async function remoteQuery(sql){
  const binary=process.env.SUPABASE_CLI_PATH;
  if(!binary)throw new Error('SUPABASE_CLI_PATH_REQUIRED');
  const directory=path.join(root,'tmp/staging-queries');await fs.mkdir(directory,{recursive:true});
  const file=path.join(directory,`${randomUUID()}.sql`);await fs.writeFile(file,sql);
  try{
    const {stdout}=await run(binary,['db','query','--linked','--project-ref',stagingReference,'--output','json','--file',file],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,timeout:120000});
    const result=cliJson(stdout);return result.rows??[];
  }catch(error){
    // Child-process errors include the command/query. Keep raw output only in ignored local files.
    await fs.writeFile(file+'.error.log',String(error.stderr??error.message));
    const code=String(error.stderr??'').match(/SQLSTATE\s+(\w+)/)?.[1]??'REMOTE_QUERY_FAILED';
    throw new Error(`${code}; diagnostic file: ${path.basename(file)}.error.log`);
  }finally{await fs.unlink(file).catch(()=>{});}
}
export async function remoteAudit(){
  return (await remoteQuery(`SELECT jsonb_build_object(
    'auth_users',(SELECT count(*) FROM auth.users),
    'public_tables',(SELECT coalesce(jsonb_agg(tablename ORDER BY tablename),'[]'::jsonb) FROM pg_tables WHERE schemaname='public'),
    'migration_history',to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
    'server_version',current_setting('server_version'),
    'vault_ready',to_regclass('vault.secrets') IS NOT NULL) audit;`))[0].audit;
}
async function migrate(){
  await stagingConfiguration({requireDatabase:false});
  const before=await remoteAudit();
  const all=(await fs.readdir(path.join(root,'supabase/migrations'))).filter(name=>/^\d{14}_.*\.sql$/.test(name)).sort();
  const versions=before.migration_history?(await remoteQuery('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).map(row=>row.version):[];
  if(versions.some(version=>!all.some(name=>name.startsWith(version+'_'))))throw new Error('UNRECONCILED_REMOTE_MIGRATIONS');
  if(!versions.length&&(before.auth_users||before.public_tables.length))throw new Error('FRESH_STAGING_REQUIRED');
  if(!versions.includes('20261015200000')&&before.auth_users)throw new Error('STAGING_ALREADY_HAS_USERS_REVIEW_REQUIRED');
  const report={project:stagingReference,startedAt:new Date().toISOString(),before,migrations:[]};
  await fs.mkdir(path.join(root,'outputs/isolation'),{recursive:true});
  await fs.writeFile(path.join(root,'outputs/isolation/staging-before.json'),JSON.stringify(report,null,2));
  for(const name of all){
    const version=name.slice(0,14);const source=await fs.readFile(path.join(root,'supabase/migrations',name),'utf8');
    const item={version,file:name,sha256:createHash('sha256').update(source).digest('hex'),alreadyApplied:versions.includes(version)};
    if(!item.alreadyApplied){
      const title=name.slice(15,-4).replaceAll("'","''");
      const delimiter=`$migration_${version}$`;
      if(source.includes(delimiter))throw new Error('MIGRATION_DELIMITER_COLLISION');
      await remoteQuery(`BEGIN;SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='90s';
        SELECT pg_advisory_xact_lock(1743120198);
        CREATE SCHEMA IF NOT EXISTS supabase_migrations;
        CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text);
        ${source}
        INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
        VALUES('${version}',ARRAY[${delimiter}${source}${delimiter}],'${title}');COMMIT;`);
      console.log('APPLIED',name);
    }else console.log('ALREADY_APPLIED',name);
    report.migrations.push(item);
    await fs.writeFile(path.join(root,'outputs/isolation/staging-migrations.json'),JSON.stringify(report,null,2));
  }
  await remoteQuery("UPDATE app_private.deployment_environment SET name='staging' WHERE singleton;NOTIFY pgrst,'reload schema';");
  report.completedAt=new Date().toISOString();report.after=await remoteAudit();
  await fs.writeFile(path.join(root,'outputs/isolation/staging-migrations.json'),JSON.stringify(report,null,2));
  console.log('STAGING_MIGRATIONS_COMPLETE',stagingReference);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.includes('--migrate'))await migrate();
    else console.log(JSON.stringify(await remoteAudit(),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
