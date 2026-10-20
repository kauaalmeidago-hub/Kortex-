import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../automation-server/package.json',import.meta.url));const {Client}=require('pg');
const env=Object.fromEntries(['.env','.env.local','automation-server/.env.local'].flatMap(p=>fs.existsSync(p)?fs.readFileSync(p,'utf8').split(/\r?\n/):[]).filter(l=>/^\w+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
const client=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:12000,ssl:{rejectUnauthorized:true,ca:fs.readFileSync('tmp/supabase-root.crt','utf8')}});
try{
 await client.connect();await client.query('BEGIN READ ONLY');
 const counts=(await client.query(`SELECT
 (SELECT count(*) FROM public.workspaces)::int organizations,
 (SELECT count(*) FROM public.workspace_members)::int memberships,
 (SELECT count(*) FROM public.task_sectors)::int sectors,
 (SELECT count(*) FROM public.task_sector_members)::int sector_memberships,
 (SELECT count(*) FROM public.tasks)::int tasks,
 (SELECT count(*) FROM public.tasks WHERE sector_id IS NOT NULL)::int tasks_with_sector,
 (SELECT count(*) FROM public.pipelines)::int pipelines,
 (SELECT count(*) FROM public.leads)::int leads,
 (SELECT count(*) FROM public.companies)::int companies,
 (SELECT count(*) FROM public.contacts)::int contacts,
 (SELECT count(*) FROM public.task_attachments)::int task_attachments,
 (SELECT count(*) FROM public.tasks t WHERE sector_id IS NULL AND created_by=assigned_to AND
   (SELECT count(*) FROM public.task_sector_members m JOIN public.task_sectors s ON s.id=m.sector_id AND s.workspace_id=m.workspace_id WHERE m.workspace_id=t.workspace_id AND m.user_id=t.created_by AND s.active AND lower(btrim(s.name)) IN ('financeiro','relacionamento','comercial'))=1)::int provable_personal_candidates`)).rows[0];
 const migrated=(await client.query(`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='business_boards') applied`)).rows[0].applied;
 const policies=(await client.query(`SELECT tablename,policyname,cmd FROM pg_policies WHERE schemaname='public' AND tablename IN ('tasks','leads','pipelines','stages','task_stages','task_sectors','task_sector_members','companies','contacts') ORDER BY tablename,policyname`)).rows;
 await client.query('ROLLBACK');const report={readOnly:true,remoteMutations:false,newIsolationMigrationApplied:migrated,counts,policies,environmentClassification:'Connected project has not been designated as staging. No migration or fixtures applied.'};fs.mkdirSync('outputs/isolation',{recursive:true});fs.writeFileSync('outputs/isolation/connected-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify({readOnly:true,counts,newIsolationMigrationApplied:migrated}));
}catch(e){console.error('READ_ONLY_AUDIT_UNAVAILABLE',e.code??'connection');process.exitCode=1;}finally{await client.end();}
