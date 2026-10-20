import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
process.env.ISOLATION_NATIVE_POSTGRES='1';process.env.ISOLATION_KEEP_OPEN='1';
const f=await import('./verify.mjs');const {Client}=createRequire(new URL('../../automation-server/package.json',import.meta.url))('pg');
const a=new Client({connectionString:f.db.uri}),b=new Client({connectionString:f.db.uri});await a.connect();await b.connect();
const columns=(await f.db.query('SELECT * FROM public.task_stages WHERE board_id=$1 ORDER BY position',[f.privateA])).rows;
const version=(await f.db.query('SELECT updated_at FROM public.business_boards WHERE id=$1',[f.privateA])).rows[0].updated_at;
async function change(connection,label){await connection.query('BEGIN;SET LOCAL ROLE authenticated');await connection.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`,[f.users.A]);assert.equal((await connection.query('SELECT current_user role')).rows[0].role,'authenticated');try{await connection.query('SELECT public.business_save_columns($1,$2,$3,$4)',[f.privateA,version,JSON.stringify(columns.map((c,i)=>({...c,name:i===0?label:c.name}))),'{}']);await connection.query('COMMIT');return 'committed';}catch(e){await connection.query('ROLLBACK');throw e;}}
const result=await Promise.allSettled([change(a,'Concurrent one'),change(b,'Concurrent two')]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.filter(r=>r.status==='rejected'&&r.reason.code==='PT409').length,1);
assert.equal((await f.db.query('SELECT count(*)::int n FROM public.tasks WHERE board_id=$1',[f.privateA])).rows[0].n,1);
const request=crypto.randomUUID();
async function create(connection){await connection.query('BEGIN;SET LOCAL ROLE authenticated');await connection.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`,[f.users.A]);try{const r=await connection.query('SELECT * FROM public.business_save_task($1,$2,NULL,NULL,$3)',[f.privateA,request,JSON.stringify({title:'Concurrent idempotent request'})]);await connection.query('COMMIT');return r.rows[0].id;}catch(e){await connection.query('ROLLBACK');throw e;}}
const ids=await Promise.all([create(a),create(b)]);assert.equal(ids[0],ids[1]);
await writeFile('outputs/isolation/concurrency-checks.json',JSON.stringify({engine:f.db.engine,normalRoles:true,twoIndependentConnections:true,oneColumnCommitOneVersionConflict:true,tasksPreserved:true,oneRecordForConcurrentSameRequest:true},null,2));console.log('PASS: independent authenticated transactions serialize column versions and concurrent idempotent creation.');await a.end();await b.end();await f.db.close();
