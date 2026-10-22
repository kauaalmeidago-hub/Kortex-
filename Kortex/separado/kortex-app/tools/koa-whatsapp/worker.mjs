import http from 'node:http';
import fs from 'node:fs';
import pg from 'pg';
import {Inbox,validSecret} from './core.mjs';
import {WhatsAppRuntime} from './runtime.mjs';
import {readLimitedJson} from './files.mjs';
import {parseGroupRoutes,expandGroupRoutes} from './routes.mjs';
import {CardIntake} from './card-intake.mjs';

for(const name of ['DATABASE_URL','EVOLUTION_API_KEY','KOA_WEBHOOK_SECRET'])if(!process.env[name])throw Error('MISSING_'+name);
const channelIds=[...new Set((process.env.KOA_CHANNEL_IDS||process.env.KOA_CHANNEL_ID||'').split(',').map(x=>x.trim()).filter(Boolean))];
if(!channelIds.length)throw Error('MISSING_KOA_CHANNEL_ID');
const concurrency=Number(process.env.KOA_CONCURRENCY??8);
const groupRoutes=parseGroupRoutes(process.env.KOA_GROUP_ROUTES??'[]');
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>32)throw Error('INVALID_KOA_CONCURRENCY');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:Math.min(concurrency+2,16),connectionTimeoutMillis:12000,
 query_timeout:15000,statement_timeout:12000,
 ssl:{rejectUnauthorized:true,ca:fs.readFileSync(new URL('./supabase-root.crt',import.meta.url),'utf8')}});
const inbox=new Inbox(process.env.KOA_SQLITE_PATH||'conversations.sqlite');
const base=process.env.EVOLUTION_API_URL||'http://evolution-api:8080';
const headers={apikey:process.env.EVOLUTION_API_KEY,Origin:'http://localhost:8080','Content-Type':'application/json'};
const cardIntake=process.env.KOA_CARDS_ENABLED==='true'?new CardIntake({query:(sql,params)=>pool.query(sql,params),secret:process.env.KOA_WEBHOOK_SECRET,origin:process.env.KOA_PORTAL_ORIGIN||'https://kortex-usuarios.vercel.app'}):null;
const runtime=new WhatsAppRuntime({inbox,concurrency,privateMessages:process.env.KOA_PRIVATE_MESSAGES==='true',privateActivatedAt:process.env.KOA_PRIVATE_ACTIVATED_AT??null,
 privatePolicy:process.env.KOA_PRIVATE_POLICY??'group_members',groupMessages:process.env.KOA_GROUP_MESSAGES!=='false',cardIntake,query:(sql,params)=>pool.query(sql,params),loadChannels:async()=>{
 const result=await pool.query(`SELECT c.* FROM public.koa_whatsapp_channels c
  JOIN public.business_boards b ON b.id=c.board_id AND b.workspace_id=c.workspace_id
  WHERE c.id=ANY($1::uuid[]) AND NOT b.archived AND app_private.task_admin_actor(c.workspace_id,c.actor_id)`,[channelIds]);
 return expandGroupRoutes(result.rows,groupRoutes);
},evolution:async(path,options={})=>{
 const {maxBytes,...requestOptions}=options;
 const response=await fetch(base+path,{...requestOptions,headers,signal:AbortSignal.timeout(options.method==='POST'?25000:12000)});
 if(!response.ok)throw Error('EVOLUTION_'+response.status);
 return maxBytes?readLimitedJson(response,maxBytes):response.json();
}});

const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(req.url==='/health'&&req.method==='GET'){const health=runtime.health();reply(health.ready?200:503,health);return;}
 if(req.url!=='/webhook'||req.method!=='POST'){reply(404,{});return;}
 if(!validSecret(req.headers['x-koa-webhook-secret'],process.env.KOA_WEBHOOK_SECRET)){reply(401,{});return;}
 req.setEncoding('utf8');
 let body='',bytes=0;
 try {
  for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>1000000){reply(413,{});return;}body+=chunk;}
  const accepted=await runtime.accept(JSON.parse(body));reply(200,{accepted});
 }catch{reply(503,{error:'PERSISTENCE_UNAVAILABLE'});}
});
await runtime.refresh();await runtime.heartbeat();
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3335,'0.0.0.0',resolve);});
console.log(JSON.stringify({service:'koa-whatsapp',...runtime.health()}));
const timer=setInterval(()=>runtime.scheduler.wake(),250);
const heartbeat=setInterval(()=>void runtime.heartbeat(),15000);
const retention=setInterval(()=>{
 inbox.db.prepare("DELETE FROM inbox WHERE state NOT IN ('pending','processing','sending') AND received_at<?").run(Date.now()-7*86400000);
 inbox.db.prepare('DELETE FROM private_calls WHERE expires_at<?').run(Date.now());
},3600000);
let stopping=false;
async function shutdown(){
 if(stopping)return;stopping=true;
 clearInterval(timer);clearInterval(heartbeat);clearInterval(retention);
 const closed=new Promise(resolve=>server.close(resolve));
 server.closeIdleConnections();
 await closed;await runtime.stop();inbox.close();await pool.end();process.exit(0);
}
process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
