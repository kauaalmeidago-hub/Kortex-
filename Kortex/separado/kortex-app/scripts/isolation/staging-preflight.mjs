// Read-only staging verification. Never reads credentials from the existing app environment.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

export const stagingReference='ukahtcymdcjphvptjamz';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export async function stagingConfiguration({requireDatabase=true}={}){
  const source=await fs.readFile(path.join(root,'.env.staging.local'),'utf8');
  const env=Object.fromEntries(source.split(/\r?\n/).flatMap(line=>{
    const match=line.match(/^\s*([A-Z][A-Z_0-9]*)\s*=\s*(.*?)\s*$/);
    return match?[[match[1],match[2].replace(/^(['"])(.*)\1$/,'$2')]]:[];
  }));
  const required=['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','STAGING_SUPABASE_SECRET_KEY',...(requireDatabase?['STAGING_DATABASE_URL']:[])];
  const missing=required.filter(key=>!env[key]);
  if(missing.length)throw new Error('CONFIGURATION_MISSING: '+missing.join(', '));
  if(new URL(env.VITE_SUPABASE_URL).origin!==`https://${stagingReference}.supabase.co`||env.VITE_APP_ENV!=='staging')throw new Error('STAGING_TARGET_MISMATCH');
  if(!/^(sb_publishable_|eyJ)/.test(env.VITE_SUPABASE_PUBLISHABLE_KEY))throw new Error('INVALID_PUBLIC_KEY_FORMAT');
  if(env.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('eyJ')){
    const payload=JSON.parse(Buffer.from(env.VITE_SUPABASE_PUBLISHABLE_KEY.split('.')[1],'base64url').toString());
    if(payload.role!=='anon'||payload.ref!==stagingReference)throw new Error('PUBLIC_KEY_TARGET_MISMATCH');
  }
  if(!env.STAGING_DATABASE_URL&&!requireDatabase)return {env,connectionString:null,ssl:null};
  const connection=new URL(env.STAGING_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(connection.protocol)||!connection.password)throw new Error('INVALID_DATABASE_CONNECTION');
  const direct=connection.hostname===`db.${stagingReference}.supabase.co`;
  const pooler=connection.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(connection.username)===`postgres.${stagingReference}`;
  if(!direct&&!pooler)throw new Error('DATABASE_TARGET_MISMATCH');
  // URL SSL parameters must not override certificate verification.
  for(const key of ['sslmode','sslrootcert','sslcert','sslkey'])connection.searchParams.delete(key);
  const caFile=env.STAGING_DATABASE_CA_FILE;
  const ssl={rejectUnauthorized:true,...(caFile?{ca:await fs.readFile(path.resolve(root,caFile),'utf8')}:{})};
  return {env,connectionString:connection.href,ssl};
}

async function preflight(){
  const management=process.argv.includes('--management');
  const {env,connectionString,ssl}=await stagingConfiguration({requireDatabase:!management});
  const settings=await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/settings`,{headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(12000)});
  if(!settings.ok)throw new Error(`PUBLIC_AUTH_CHECK_FAILED_${settings.status}`);
  const admin=await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:env.STAGING_SUPABASE_SECRET_KEY,Authorization:`Bearer ${env.STAGING_SUPABASE_SECRET_KEY}`},signal:AbortSignal.timeout(12000)});
  if(!admin.ok)throw new Error(`SERVER_AUTH_CHECK_FAILED_${admin.status}`);
  if(management){
    const {remoteAudit,remoteQuery}=await import('./staging-remote.mjs');
    const audit=await remoteAudit();
    const versions=audit.migration_history?(await remoteQuery('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).map(row=>row.version):[];
    const report={checkedAt:new Date().toISOString(),project:stagingReference,readOnly:true,transport:'Supabase CLI Management API / HTTPS',publicAuthKeyValidated:true,serverAuthKeyValidated:true,...audit,migrationVersions:versions,isolationMigrationApplied:versions.includes('20261015200000')};
    await fs.mkdir(path.join(root,'outputs/isolation'),{recursive:true});
    await fs.writeFile(path.join(root,'outputs/isolation/staging-preflight.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));return;
  }
  const {Client}=createRequire(new URL('../../automation-server/package.json',import.meta.url))('pg');
  const client=new Client({connectionString,ssl,connectionTimeoutMillis:12000});
  try{
    await client.connect();await client.query('BEGIN READ ONLY');
    const tables=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(row=>row.table_name);
    const historyExists=(await client.query("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL present")).rows[0].present;
    const versions=historyExists?(await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(row=>row.version):[];
    const users=Number((await client.query('SELECT count(*) FROM auth.users')).rows[0].count);
    const report={checkedAt:new Date().toISOString(),project:stagingReference,readOnly:true,remoteMutations:false,tlsCertificateVerified:true,publicAuthKeyValidated:true,serverAuthKeyValidated:true,users,publicTables:tables,migrationVersions:versions,isolationMigrationApplied:versions.includes('20261015200000')};
    await client.query('ROLLBACK');
    await fs.mkdir(path.join(root,'outputs/isolation'),{recursive:true});
    await fs.writeFile(path.join(root,'outputs/isolation/staging-preflight.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }finally{await client.end();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  void preflight().catch(error=>{
    // Never serialize a connection, URL, response body or a database error containing credentials.
    const code=String(error.message).match(/^(CONFIGURATION_MISSING: [A-Z_, ]+|[A-Z][A-Z_0-9]+)$/)?.[0]??error.code??'STAGING_PREFLIGHT_UNAVAILABLE';
    console.error(code);process.exitCode=1;
  });
}
