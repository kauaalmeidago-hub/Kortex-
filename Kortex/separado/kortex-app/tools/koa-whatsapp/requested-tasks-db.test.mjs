// Explicit integration check against the configured database. All DDL, mode
// changes, tasks and audit entries are rolled back. No WhatsApp messages.
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import {createRequire} from 'node:module';
const {Client}=createRequire(new URL('../../automation-server/package.json',import.meta.url))('pg');
test('requested creation is scoped, atomic, idempotent and isolated between the two recipients',{skip:process.env.KOA_DATABASE_TEST!=='1'},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:12000,ssl:{rejectUnauthorized:true,ca:fs.readFileSync(new URL('./supabase-root.crt',import.meta.url),'utf8')}});
 await db.connect();try{
 await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s'");
 const version='20261019235900',source=fs.readFileSync(new URL('../../supabase/migrations/'+version+'_koa_whatsapp_requested_tasks.sql',import.meta.url),'utf8');
 const applied=(await db.query('SELECT statements FROM supabase_migrations.schema_migrations WHERE version=$1',[version])).rows[0];
 if(!applied)await db.query(source);else assert.equal(applied.statements.join('\n'),source);
 const c=(await db.query('SELECT * FROM public.koa_whatsapp_channels WHERE id=$1',[process.env.KOA_CHANNEL_ID])).rows[0];assert.equal(c.instance,'koa-kortex');
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[c.actor_id]);
 for(const [code,email] of [['comercial','comercial01@grupoejccorp.com.br'],['relacionamento','relacionamento@grupoejccorp.com.br']]){
  const rows=(await db.query("SELECT b.id,u.id recipient FROM public.business_boards b JOIN public.task_sectors s ON s.id=b.sector_id JOIN auth.users u ON u.id=b.owner_id WHERE b.workspace_id=$1 AND s.code=$2 AND lower(u.email)=$3 AND b.kind='tasks' AND NOT b.archived",[c.workspace_id,code,email])).rows;assert.equal(rows.length,1);
  await db.query('INSERT INTO public.koa_whatsapp_destinations(channel_id,sector_code,board_id,recipient_id) VALUES($1,$2,$3,$4) ON CONFLICT(channel_id,sector_code) DO UPDATE SET board_id=excluded.board_id,recipient_id=excluded.recipient_id',[c.id,code,rows[0].id,rows[0].recipient]);
 }
 const mode=(await db.query('SELECT public.koa_whatsapp_tasks($1,true) v',[c.board_id])).rows[0].v;assert.equal(mode.tasks_enabled,true);assert.equal(mode.destinations.length,2);
 const sourceAt=(await db.query('SELECT clock_timestamp() t')).rows[0].t;
 const nonce=Date.now();const items=[{sector:'comercial',title:'Verificação transacional Comercial '+nonce,description:'Validação que será desfeita.',operational_code:'',priority:'medium',due_date:''},{sector:'relacionamento',title:'Verificação transacional Relacionamento '+nonce,description:'Validação que será desfeita.',operational_code:'',priority:'medium',due_date:''}];
 const call=async(event,payload=items,at=sourceAt)=>(await db.query('SELECT public.koa_whatsapp_create_tasks($1,$2,$3,$4::jsonb) v',[c.id,event,at,JSON.stringify(payload)])).rows[0].v;
 const created=await call('rollback-test');assert.deepEqual(created.map(r=>r.status),['created','created']);assert.deepEqual(await call('rollback-test'),created);
 assert.deepEqual((await call('duplicate-test')).map(r=>r.status),['duplicate','duplicate']);
 assert.equal((await call('review-test',[{...items[0],description:'Uma alteração que requer revisão.'}]))[0].status,'review');
 assert.equal((await db.query('SELECT count(*)::int n FROM public.tasks WHERE id=ANY($1::uuid[])',[created.map(r=>r.task_id)])).rows[0].n,2);
 const rows=(await db.query('SELECT title,company_id,operator,project,operational_code,due_date,status,assigned_to,board_id FROM public.tasks WHERE id=ANY($1::uuid[])',[created.map(r=>r.task_id)])).rows;
 for(const t of rows){assert.equal(t.company_id,null);assert.equal(t.operator,null);assert.equal(t.project,null);assert.equal(t.operational_code,null);assert.equal(t.due_date,null);assert.equal(t.status,'todo');}
 async function rejects(fn,pattern){await db.query('SAVEPOINT rejected');await assert.rejects(fn,pattern);await db.query('ROLLBACK TO SAVEPOINT rejected');await db.query('RELEASE SAVEPOINT rejected');}
 await rejects(()=>call('invalid-batch',[{...items[0],title:'Primeiro item não pode persistir '+nonce},{...items[1],sector:'financeiro'}]),/TASK_REQUEST_INVALID/);
 assert.equal((await db.query('SELECT count(*)::int n FROM public.tasks WHERE title=$1',['Primeiro item não pode persistir '+nonce])).rows[0].n,0);
 await rejects(()=>call('old-event',items,new Date('2020-01-01T00:00:00Z')),/TASK_MODE_UNAVAILABLE/);
 await rejects(()=>call('rollback-test',[{...items[0],title:'Changed event'}]),/TASK_SOURCE_CONFLICT/);
 assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.koa_whatsapp_create_tasks(uuid,text,timestamptz,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
 for(const t of rows){
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[t.assigned_to]);await db.query('SET LOCAL ROLE authenticated');
  const seen=(await db.query('SELECT id FROM public.tasks WHERE id=ANY($1::uuid[])',[created.map(r=>r.task_id)])).rows;assert.equal(seen.length,1);
  await rejects(()=>db.query('SELECT public.koa_whatsapp_tasks($1,false)',[c.board_id]),/SCOPE_UNAVAILABLE/);await db.query('RESET ROLE');
 }
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[c.actor_id]);await db.query('SELECT public.koa_whatsapp_tasks($1,false)',[c.board_id]);
 await rejects(()=>call('paused-test'),/TASK_MODE_UNAVAILABLE/);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
