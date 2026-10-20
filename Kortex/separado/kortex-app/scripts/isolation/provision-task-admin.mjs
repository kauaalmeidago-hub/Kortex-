// Explicit account provisioning. No auth credentials, workspace roles or business rows are created.
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const {Client}=createRequire(new URL('../../automation-server/package.json',import.meta.url))('pg');
const flag=name=>process.argv[process.argv.indexOf(name)+1];
const email=flag('--email')?.trim().toLowerCase(),workspace=flag('--workspace');
if(!process.argv.includes('--email')||!process.argv.includes('--workspace')||!email?.includes('@')||!/^[-0-9a-f]{36}$/i.test(workspace||''))throw Error('Explicit --email and --workspace required');
const env={};for(const line of (await fs.readFile('automation-server/.env.local','utf8')).split(/\r?\n/)){const m=line.match(/^(\w+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');}
const ref='vlacojrryjazwrljysqx',url=new URL(env.DATABASE_URL);
if(env.SUPABASE_URL!==`https://${ref}.supabase.co`||(!decodeURIComponent(url.username).includes(ref)&&!url.hostname.includes(ref)))throw Error('PRODUCTION_TARGET_MISMATCH');
const db=new Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:true,ca:await fs.readFile('tmp/supabase-root.crt','utf8')}});
try{
 await db.connect();await db.query('BEGIN');
 if((await db.query('SELECT name FROM app_private.deployment_environment WHERE singleton')).rows[0]?.name!=='production')throw Error('PRODUCTION_PHASE_REQUIRED');
 const users=(await db.query('SELECT id,email,email_confirmed_at,banned_until FROM auth.users WHERE lower(email)=$1 FOR UPDATE',[email])).rows;
 if(users.length!==1||!users[0].email_confirmed_at||(users[0].banned_until&&new Date(users[0].banned_until)>new Date()))throw Error('ONE_CONFIRMED_ACTIVE_ACCOUNT_REQUIRED');
 const user=users[0];
 const owned=(await db.query(`SELECT w.id FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id AND m.user_id=$1 AND m.active WHERE w.id=$2 AND w.owner_id=$1 FOR UPDATE OF w`,[user.id,workspace])).rows;
 if(owned.length!==1)throw Error('EXPLICIT_OWN_ORGANIZATION_REQUIRED');
 const invitation=(await db.query('SELECT claimed_by,workspace_id FROM app_private.task_admin_invites WHERE email=$1 FOR UPDATE',[email])).rows[0];
 if(invitation?.claimed_by&&(invitation.claimed_by!==user.id||invitation.workspace_id!==workspace))throw Error('INVITATION_ALREADY_BOUND');
 const before=(await db.query('SELECT workspace_id,user_id,sector_id,can_read_personal FROM public.task_sector_members ORDER BY workspace_id,user_id,sector_id')).rows;
 await db.query(`INSERT INTO app_private.task_admin_grants(user_id,workspace_id) VALUES($1,$2) ON CONFLICT(user_id,workspace_id) DO UPDATE SET active=true`,[user.id,workspace]);
 const sectors=(await db.query(`UPDATE public.task_sector_members SET can_dispatch=true,can_manage_boards=true,can_manage_members=true WHERE user_id=$1 AND workspace_id=$2 AND active RETURNING sector_id`,[user.id,workspace])).rows;
 if(!sectors.length)throw Error('EXISTING_SECTOR_ASSOCIATION_REQUIRED');
 await db.query(`INSERT INTO app_private.task_admin_invites(email,claimed_by,workspace_id,claimed_at) VALUES($1,$2,$3,now()) ON CONFLICT(email) DO UPDATE SET claimed_by=EXCLUDED.claimed_by,workspace_id=EXCLUDED.workspace_id,claimed_at=coalesce(app_private.task_admin_invites.claimed_at,now())`,[email,user.id,workspace]);
 const after=(await db.query('SELECT workspace_id,user_id,sector_id,can_read_personal FROM public.task_sector_members ORDER BY workspace_id,user_id,sector_id')).rows;
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('MEMBERSHIP_OR_PERSONAL_VISIBILITY_CHANGED');
 await db.query('COMMIT');
 const report={project:ref,email,user:user.id,workspace,sectors:sectors.map(s=>s.sector_id),scope:'Task administration in the explicitly owned organization only',otherMembershipsPreserved:true,personalReadNotExpanded:true,authCredentialsUnchanged:true,completedAt:new Date().toISOString()};
 await fs.writeFile('outputs/isolation/task-admin-provisioning.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){await db.query('ROLLBACK').catch(()=>{});console.error('ADMIN_PROVISION_FAILED',e.code||e.message);process.exitCode=1;}finally{await db.end();}
