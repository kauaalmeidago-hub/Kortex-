// Explicit operator command; never invoked on startup or deployment.
// node announce.mjs --id=<unique-request-key> --everyone
import fs from 'node:fs';
import pg from 'pg';
import {Inbox} from './core.mjs';
import {composeGroupReplies,loadGroupDirectory} from './groups.mjs';
const key=process.argv.find(a=>a.startsWith('--id='))?.slice(5);
if(!key||!/^[-a-zA-Z0-9]{10,100}$/.test(key))throw Error('ANNOUNCEMENT_ID_REQUIRED');
const everyone=process.argv.includes('--everyone');
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:12000,
 ssl:{rejectUnauthorized:true,ca:fs.readFileSync(new URL('./supabase-root.crt',import.meta.url),'utf8')}});
let inbox;
try{
 await db.connect();
 const config=(await db.query(`SELECT c.* FROM public.koa_whatsapp_channels c JOIN public.business_boards b ON b.id=c.board_id AND b.workspace_id=c.workspace_id
  WHERE c.id=$1 AND NOT b.archived AND app_private.task_admin_actor(c.workspace_id,c.actor_id)`,[process.env.KOA_CHANNEL_ID])).rows[0];
 if(!config?.conversations_enabled)throw Error('CHANNEL_NOT_ENABLED');
 inbox=new Inbox(process.env.KOA_SQLITE_PATH||'conversations.sqlite',{recover:false});
 const id='announcement:'+config.id+':'+key;
 const existing=inbox.db.prepare('SELECT state FROM inbox WHERE id=?').get(id);
 if(existing){console.log(JSON.stringify({id,state:existing.state,alreadyQueued:true}));}
 else{
  const evolution=async(path,options={})=>{
   const r=await fetch(process.env.EVOLUTION_API_URL+path,{...options,headers:{apikey:process.env.EVOLUTION_API_KEY,Origin:'http://localhost:8080','Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('EVOLUTION_'+r.status);return r.json();
  };
  const instances=await evolution('/instance/fetchInstances?instanceName='+encodeURIComponent(config.instance));
  const bot=instances.find(i=>i.name===config.instance)?.ownerJid;
  if(!bot)throw Error('BOT_IDENTITY_UNAVAILABLE');
  const profiles=inbox.db.prepare('SELECT * FROM participant_names WHERE group_jid=?').all(config.group_jid);
  const members=await loadGroupDirectory(evolution,config,profiles,bot);
  const message={id,group:config.group_jid,participant:'administration',fromMe:true,text:'KOA, se apresente para o grupo'+(everyone?' e mencione todos no final.':'.'),timestamp:Math.floor(Date.now()/1000),mentioned:[]};
  const parts=composeGroupReplies([],{kind:'introduction',names:[],everyone},message,{},members,config.tasks_enabled);
  inbox.db.exec('BEGIN IMMEDIATE');
  try{
   const added=inbox.db.prepare('INSERT OR IGNORE INTO inbox(id,group_jid,participant,text,ts,payload,received_at,state) VALUES(?,?,?,?,?,?,?,?)').run(id,config.group_jid,message.participant,message.text,message.timestamp,JSON.stringify(message),Date.now(),'processing').changes;
   if(added){
    const part=parts[0];inbox.db.prepare('INSERT INTO outbox_parts(inbox_id,part_index,text,mentioned,recipients) VALUES(?,?,?,?,?)').run(id,0,part.text,JSON.stringify(part.mentioned),JSON.stringify(part.recipients));
    inbox.db.prepare("UPDATE inbox SET state='pending',answer=?,presentation=1 WHERE id=?").run(part.text,id);
   }
   inbox.db.exec('COMMIT');
  }catch(e){inbox.db.exec('ROLLBACK');throw e;}
  console.log(JSON.stringify({id,queued:true,group:config.group_name,mentions:parts[0].mentioned.length}));
 }
}finally{inbox?.close();await db.end();}
