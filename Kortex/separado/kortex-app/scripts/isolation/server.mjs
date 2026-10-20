// Local test harness only. Native PostgREST handles all REST/SDK/RPC requests.
// The tiny auth fixture endpoint is not GoTrue and is never part of the product.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const require=createRequire(new URL('../../tmp/isolation-runtime/package.json',import.meta.url));
const {PGLiteSocketServer}=require('@electric-sql/pglite-socket');
const {SignJWT,jwtVerify}=require('jose');
process.env.ISOLATION_KEEP_OPEN='1';
const fixture=await import('./verify.mjs');const {db,users}=fixture;
await db.query('UPDATE public.task_sector_members SET active=true WHERE workspace_id=$1 AND sector_id=$2 AND user_id=$3',[fixture.ws,fixture.rel,users.A2]);
await db.exec("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT;END IF;END $$;GRANT authenticated,anon TO authenticator;");
const socket=db.uri?null:new PGLiteSocketServer({db,port:55432,host:'127.0.0.1'});if(socket)await socket.start();
const secret=randomBytes(48).toString('hex');const key=new TextEncoder().encode(secret);
const sign=(role,sub)=>new SignJWT({role,...(sub?{sub}:{}),aud:'authenticated'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('4h').sign(key);
const anon=await sign('anon');const tokens={};for(const [name,id] of Object.entries(users))tokens[name]=await sign('authenticated',id);
const config=`db-uri = "${db.uri??'postgresql://authenticator:postgres@127.0.0.1:55432/postgres'}"\ndb-schemas = "public"\ndb-anon-role = "anon"\ndb-pool = 1\ndb-channel-enabled = false\ndb-prepared-statements = false\nserver-host = "127.0.0.1"\nserver-port = 54323\njwt-secret = "${secret}"\nlog-level = "crit"\n`;
await writeFile('tmp/isolation-runtime/postgrest.conf',config);
const postgrest=spawn('tmp/isolation-runtime/postgrest/postgrest.exe',['tmp/isolation-runtime/postgrest.conf','+RTS','-N1','-RTS'],{stdio:['ignore','pipe','pipe'],windowsHide:true});postgrest.stderr.on('data',d=>process.stderr.write(d));postgrest.on('exit',code=>console.error('PostgREST exited',code));
const sessions={};for(const [name,id] of Object.entries(users)){sessions[name]={access_token:tokens[name],refresh_token:`fixture-${name}`,expires_in:14400,expires_at:Math.floor(Date.now()/1000)+14400,token_type:'bearer',user:{id,email:`${name}@isolation.invalid`,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{full_name:name,sector:name==='B'?'financeiro':name==='C'?'comercial':'relacionamento'},created_at:new Date().toISOString()}};}
const server=createServer(async(req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,HEAD,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 try{
  const url=new URL(req.url,'http://127.0.0.1:54322');let body='';for await(const chunk of req)body+=chunk;
  if(url.pathname.startsWith('/rest/v1/')){
   const headers={...req.headers};delete headers.host;delete headers['content-length'];
   const response=await fetch(`http://127.0.0.1:54323${url.pathname.slice('/rest/v1'.length)}${url.search}`,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body});
   res.statusCode=response.status;for(const [k,v] of response.headers){if(!['content-length','transfer-encoding','content-encoding'].includes(k))res.setHeader(k,v);}res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  res.setHeader('Content-Type','application/json');
  if(url.pathname==='/auth/v1/token'){
   const input=body?JSON.parse(body):{};const name=input.email?.split('@')[0]??input.refresh_token?.replace('fixture-','');
   if(!sessions[name]||(input.password&&input.password!=='Local-isolation-only-2026')){res.writeHead(400);res.end(JSON.stringify({msg:'Invalid fixture credentials'}));return;}
   res.end(JSON.stringify(sessions[name]));return;
  }
  if(url.pathname==='/auth/v1/user'){
   const token=req.headers.authorization?.replace(/^Bearer /i,'');const {payload}=await jwtVerify(token,key);const session=Object.values(sessions).find(s=>s.user.id===payload.sub);res.end(JSON.stringify(session?.user??null));return;
  }
  if(url.pathname==='/auth/v1/logout'){res.writeHead(204);res.end();return;}
  res.writeHead(404);res.end(JSON.stringify({message:'Local fixture endpoint unavailable'}));
 }catch{res.writeHead(500);res.end(JSON.stringify({message:'Isolated test request failed'}));}
});await new Promise(resolve=>server.listen(54322,'127.0.0.1',resolve));
await writeFile('tmp/isolation-runtime/fixtures.json',JSON.stringify({...Object.fromEntries(Object.entries(fixture).filter(([k])=>k!=='db')),tokens,anon,sessions}));
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5180','--strictPort'],{env:{...process.env,VITE_SUPABASE_URL:'http://127.0.0.1:54322',VITE_SUPABASE_PUBLISHABLE_KEY:anon,VITE_APP_ENV:'development',VITE_ISOLATION_TEST:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
vite.stderr.on('data',d=>process.stderr.write(d));
await writeFile('tmp/isolation-runtime/processes.json',JSON.stringify({server:process.pid,vite:vite.pid,postgrest:postgrest.pid}));
console.log(`Isolated UI http://127.0.0.1:5180; native PostgREST 14.5; ${db.engine}; synthetic fixture auth only.`);
async function stop(){vite.kill();postgrest.kill();server.close();if(socket)await socket.stop();await db.close();process.exit(0);}process.on('SIGINT',stop);process.on('SIGTERM',stop);
