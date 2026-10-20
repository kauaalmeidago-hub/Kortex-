import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(root,'tmp/isolation-runtime/package.json'));
const {PGlite}=require('@electric-sql/pglite');
export async function isolatedDatabase(options={}){
 let db;
 if(process.env.ISOLATION_NATIVE_POSTGRES==='1'){
  const {Client,types}=createRequire(path.join(root,'automation-server/package.json'))('pg');
  types.setTypeParser(1184,value=>value);types.setTypeParser(1114,value=>value);
  const admin=new Client({host:'127.0.0.1',port:55434,user:'postgres',database:'postgres'});await admin.connect();
  const name=`kortex_isolation_${Date.now()}_${Math.floor(Math.random()*1000000)}`;await admin.query(`CREATE DATABASE ${name}`);
  const connection=new Client({host:'127.0.0.1',port:55434,user:'postgres',database:name});await connection.connect();await admin.end();
  db={query:(...args)=>connection.query(...args),exec:sql=>connection.query(sql),close:()=>connection.end(),uri:`postgresql://authenticator:postgres@127.0.0.1:55434/${name}`,engine:'PostgreSQL 17.6 native'};
 }else{db=new PGlite();await db.waitReady;db.engine='PostgreSQL 18.6/PGlite';}
 await db.exec(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS;END IF;END $$;
 CREATE SCHEMA auth;CREATE SCHEMA storage;CREATE SCHEMA extensions;
 CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,raw_user_meta_data jsonb DEFAULT '{}',banned_until timestamptz,created_at timestamptz DEFAULT now());
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'');$$;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,service_role;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated,service_role;
 GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO PUBLIC;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,owner_id text,metadata jsonb DEFAULT '{}');
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;GRANT ALL ON ALL TABLES IN SCHEMA storage TO service_role;
 CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name,'/');$$;`);
 const files=(await readdir(path.join(root,'supabase/migrations'))).filter(f=>/^(20260608|202610060|202610061|202610071|20261015090000|20261015091000|20261015140000|20261015141000|20261015142000|20261015170000|202610152|20261016143000)/.test(f)).sort();
 for(const f of files){
  if(f.startsWith('20261015200000'))await options.beforeScope?.(db);
  const sql=(await readFile(path.join(root,'supabase/migrations',f),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS "?pgcrypto"?[^;]*;/ig,'');
  try{await db.exec('BEGIN;'+sql+';COMMIT;');}catch(e){await db.exec('ROLLBACK;');throw new Error(`${f}: ${e.message}`,{cause:e});}
 }
 return db;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const db=await isolatedDatabase();console.log('Migrations applied to isolated PostgreSQL (PGlite), no remote connection.');await db.close();}
