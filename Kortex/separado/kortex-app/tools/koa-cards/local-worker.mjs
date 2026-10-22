import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync,createPrivateKey,createPublicKey,randomUUID} from 'node:crypto';
import {cardInput,openCardEnvelope,cardMedia} from './core.mjs';
import {prepareSavedDialog} from './saved-dialog.mjs';
import {loadSavedCompanyAccess,resolveSavedCompany} from './saved-access.mjs';
import {LocalCardProfiles} from './local-profiles.mjs';
import {CardIdentityRegistry} from './identity-registry.mjs';
import {sealCardPayload} from '../koa-whatsapp/card-seal.mjs';
const runtime=new URL('../../automation-server/tmp/whatsapp-card-runtime/dist/',import.meta.url);
const {loadConfig}=await import(new URL('config.js',runtime));
const {BrowserManager}=await import(new URL('browser/BrowserManager.js',runtime));
const {protectWithDpapi,unprotectWithDpapi}=await import(new URL('security/DpapiProtector.js',runtime));
const {emitSelfServiceCard}=await import(new URL('workflows/SelfServiceCard.js',runtime));
const require=createRequire(new URL('../../automation-server/package.json',import.meta.url)),{Client,Pool}=require('pg'),{chromium}=require('playwright');
const config=loadConfig(),workerId='local-whatsapp-cards',stateDir=path.join(process.env.LOCALAPPDATA,'Kortex','WhatsAppCards');
if(process.platform!=='win32'||process.env.SUPABASE_URL!=='https://vlacojrryjazwrljysqx.supabase.co'||!process.env.EVOLUTION_API_KEY)throw Error('CARD_LOCAL_CONFIGURATION');
const ssl={rejectUnauthorized:true,ca:await fs.readFile(new URL('../koa-whatsapp/supabase-root.crt',import.meta.url),'utf8')};
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl,max:4,connectionTimeoutMillis:12000,query_timeout:15000});
const gate=new Client({connectionString:process.env.DATABASE_URL,ssl,connectionTimeoutMillis:12000});
const query=(sql,params)=>pool.query(sql,params);
let stopping=false,currentId=null,currentAbort=null;
gate.on('error',()=>{stopping=true;currentAbort?.abort();});pool.on('error',()=>console.warn('CARD_DATABASE_RECONNECT'));
class PrivateBrowser extends BrowserManager {async captureErrorScreenshot(){return undefined;}}
const provider={createContext:async(_operation,_signal,options)=>{
 const browser=await chromium.launch({channel:config.browserChannel||'chrome',headless:true,downloadsPath:options.downloadsPath});
 try{const context=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:900}});context.setDefaultTimeout(config.actionTimeoutMs);context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  return {context,page:await context.newPage(),close:async()=>{await context.close().catch(()=>{});await browser.close().catch(()=>{});}};
 }catch(error){await browser.close();throw error;}
}};
const manager=new PrivateBrowser({...config,downloadsDir:path.join(stateDir,'downloads')},provider);
const profiles=new LocalCardProfiles({directory:path.join(stateDir,'beneficiaries'),protect:protectWithDpapi,unprotect:unprotectWithDpapi});
const registry=new CardIdentityRegistry({directory:path.join(stateDir,'registries'),unprotect:unprotectWithDpapi});
const savedSecrets={get:async ref=>{
 const row=(await query(`SELECT c.id,v.name,v.decrypted_secret FROM public.automation_credentials c
  JOIN koa_private.automation_credential_secrets s ON s.credential_id=c.id JOIN vault.decrypted_secrets v ON v.id=s.vault_secret_id
  WHERE c.credential_ref=$1 AND c.status='active' AND c.last_verified_at IS NOT NULL`,[ref])).rows[0];
 if(!row||row.name!=='koa-portal:'+row.id)throw Error('SAVED_ACCESS_NOT_AVAILABLE');
 const credential=JSON.parse(row.decrypted_secret);row.decrypted_secret='';return credential;
}};
let privateKey,publicKey,keyId;
async function heartbeat(){
 await query(`INSERT INTO public.koa_whatsapp_card_workers(id,ready,version,public_key,key_id,last_seen_at) VALUES($1,$2,'self-card-1',$3::jsonb,$4,now())
  ON CONFLICT(id) DO UPDATE SET ready=excluded.ready,version=excluded.version,public_key=excluded.public_key,key_id=excluded.key_id,last_seen_at=now()`,[workerId,!stopping,JSON.stringify(publicKey),keyId]);
 if(currentId)await query("UPDATE public.koa_whatsapp_card_requests SET lease_expires_at=now()+interval '90 seconds' WHERE id=$1 AND state='processing'",[currentId]);
}
async function currentAllowed(job,states){return Boolean((await query(`SELECT 1 FROM public.koa_whatsapp_card_requests r JOIN public.koa_whatsapp_channels c ON c.id=r.channel_id
 JOIN public.business_boards b ON b.id=c.board_id AND b.workspace_id=c.workspace_id AND NOT b.archived
 WHERE r.id=$1 AND r.state=ANY($2) AND r.peer_jid=$3 AND r.instance=$4 AND r.expires_at>now() AND c.conversations_enabled
 AND r.instance=c.instance AND app_private.task_admin_actor(c.workspace_id,c.actor_id)`,[job.id,states,job.peer_jid,job.instance])).rows.length);}
async function sendResult(job,bytes,errorCode,continuation){
 if(!await currentAllowed(job,['processing']))return;
 if(job.savedCompany)await resolveSavedCompany(query,{channelId:job.channel_id,companyName:job.savedCompany.companyName});
 const payload=bytes?cardMedia(job.peer_jid,bytes):{number:job.peer_jid,text:continuation?.prompt||'Não foi possível concluir sua carteirinha ou confirmar sua identidade. Confira os dados com a equipe de atendimento e solicite um novo pedido ao KOA. Não envie senhas por mensagem.',linkPreview:false};
 const reserved=await query(`UPDATE public.koa_whatsapp_card_requests r SET state='sending',sealed_payload=NULL,identity_verified=$2,error_code=$3,lease_expires_at=now()+interval '90 seconds',updated_at=now()
  FROM public.koa_whatsapp_channels c JOIN public.business_boards b ON b.id=c.board_id AND b.workspace_id=c.workspace_id AND NOT b.archived
  WHERE r.id=$1 AND r.state='processing' AND r.channel_id=c.id AND r.expires_at>now()
  AND r.peer_jid=$4 AND r.instance=$5 AND c.instance=r.instance AND c.conversations_enabled
  AND app_private.task_admin_actor(c.workspace_id,c.actor_id) RETURNING r.id`,[job.id,Boolean(bytes),errorCode??null,job.peer_jid,job.instance]);
 if(!reserved.rows.length)return;
 try{
  const response=await fetch((process.env.EVOLUTION_API_URL||'http://127.0.0.1:8081')+(bytes?'/message/sendMedia/':'/message/sendText/')+encodeURIComponent(job.instance),{
   method:'POST',headers:{apikey:process.env.EVOLUTION_API_KEY,Origin:'http://localhost:8080','Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
  const data=await response.json();if(!response.ok||!data.key?.id)throw Error('SEND_UNKNOWN');
  const nextPacket=continuation?{mode:'saved_company',continuation:sealCardPayload(continuation.state,publicKey,keyId,job.id)}:null;
  await query("UPDATE public.koa_whatsapp_card_requests SET state=$2,provider_message_id=$3,lease_expires_at=NULL,sealed_payload=$4::jsonb,expires_at=CASE WHEN $2='awaiting_access' THEN now()+interval '20 minutes' ELSE expires_at END,updated_at=now() WHERE id=$1 AND state='sending'",[job.id,continuation?'awaiting_access':bytes?'sent':'failed',data.key.id,nextPacket?JSON.stringify(nextPacket):null]);
 }catch{await query("UPDATE public.koa_whatsapp_card_requests SET state='uncertain',sealed_payload=NULL,error_code='SEND_RESULT_UNKNOWN',lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND state='sending'",[job.id]);}
}
async function processJob(job){
 let decoded,parsed,pdf,savedIdentity,savedCredential;currentId=job.id;currentAbort=new AbortController();
 const timer=setInterval(()=>void currentAllowed(job,['processing']).then(ok=>{if(!ok)currentAbort?.abort();}).catch(()=>currentAbort?.abort()),5000);
 const signal=AbortSignal.any([currentAbort.signal,AbortSignal.timeout(5*60000)]);
 try{
  if(job.key_id!==keyId)throw Error('CARD_KEY_CHANGED');
  if(job.sealed_payload?.mode==='saved_company'){
   const dialog=await prepareSavedDialog({query,job,privateKey,readProfile:company=>profiles.get(job,company)});
   if(dialog.prompt){await sendResult(job,null,null,dialog);return;}
   const access=await loadSavedCompanyAccess(query,savedSecrets,{channelId:job.channel_id,companyName:dialog.company.companyName});
   job.savedCompany=access.company;savedIdentity=dialog.identity;savedCredential=access.credential;
   parsed=cardInput({...dialog.identity,companyCode:access.company.companyCode,operator:access.company.operator,password:savedCredential.password});
  }else{decoded=openCardEnvelope(job.sealed_payload,privateKey,job.id);parsed=cardInput(decoded);}
  if(job.savedCompany)parsed.input.expectedCompanyName=job.savedCompany.companyName;
  const operation={id:job.id,type:'CARD_ISSUE',status:'starting',companyId:job.savedCompany?.companyId||job.id,workspaceId:job.savedCompany?.workspaceId,portal:parsed.operator,credentialRef:'self-card:'+job.id,input:parsed.input,artifacts:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const repository={get:async()=>operation,update:async(_id,patch)=>{Object.assign(operation,patch);return operation;}};
  const storage={save:async input=>{if(input.type!=='card_pdf'||input.operationId!==job.id||input.metadata?.identityVerified!==true)throw Error('CARD_ARTIFACT_INVALID');pdf=Buffer.from(input.bytes);
   return {storageProvider:'memory',bucket:'memory',storagePath:job.id+'/carteirinha.pdf',fileName:'carteirinha.pdf',mimeType:'application/pdf',sizeBytes:pdf.length,checksum:createHash('sha256').update(pdf).digest('hex')};}};
  await emitSelfServiceCard(operation,signal,{config,repository,browserManager:manager,secretProvider:{get:async ref=>{if(ref!==operation.credentialRef)throw Error('CARD_CREDENTIAL_SCOPE');return parsed.credential;}},artifactStorage:storage,
   ...(job.savedCompany?{verifySavedBeneficiary:identity=>registry.verify(job.savedCompany,identity)}:{}),
   updateStatus:async(status,currentStep)=>repository.update(job.id,{status,currentStep}),emitEvent:async()=>undefined});
  if(operation.status!=='success'||operation.result?.selfServiceIdentity?.verified!==true||!pdf||operation.artifacts.length!==1)throw Error('CARD_IDENTITY_NOT_VERIFIED');
  if(job.savedCompany)await profiles.put(job,job.savedCompany,savedIdentity,operation.result.selfServiceIdentity);
  signal.throwIfAborted();await sendResult(job,pdf);
 }catch(error){
  const code=/^[A-Z_]+$/.test(error?.code??error?.message??'')?(error.code||error.message):'CARD_ISSUE_FAILED';
  if(!stopping)await sendResult(job,null,code).catch(()=>{});
 }finally{
  clearInterval(timer);if(decoded)decoded.password='';if(parsed)parsed.credential.password='';if(savedCredential)savedCredential.password='';pdf?.fill(0);
  await query("UPDATE public.koa_whatsapp_card_requests SET sealed_payload=NULL,state=CASE WHEN state='processing' THEN 'failed' ELSE state END,updated_at=now() WHERE id=$1 AND state NOT IN ('queued','awaiting_access')",[job.id]).catch(()=>{});
  currentId=null;currentAbort=null;
 }
}
async function run(){
 await fs.mkdir(stateDir,{recursive:true});await gate.connect();
 if(!(await gate.query("SELECT pg_try_advisory_lock(hashtextextended('koa-self-cards',24)) locked")).rows[0].locked)throw Error('CARD_WORKER_ALREADY_ACTIVE');
 const keyFile=path.join(stateDir,'worker-key.dpapi');let pem;
 try{pem=await unprotectWithDpapi(await fs.readFile(keyFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;
  pem=generateKeyPairSync('rsa',{modulusLength:3072}).privateKey.export({format:'pem',type:'pkcs8'}).toString();await fs.writeFile(keyFile,await protectWithDpapi(pem),{mode:0o600});}
 privateKey=createPrivateKey(pem);pem='';publicKey={...createPublicKey(privateKey).export({format:'jwk'}),alg:'RSA-OAEP-256',ext:true,key_ops:['encrypt']};keyId=createHash('sha256').update(JSON.stringify(publicKey)).digest('hex');
 const probe=await chromium.launch({channel:config.browserChannel||'chrome',headless:true});await probe.close();
 await heartbeat();await fs.writeFile(path.join(stateDir,'status.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),workerId,keyId}));
 console.log(JSON.stringify({service:'koa-self-cards',ready:true,workerId}));
 const timer=setInterval(()=>void heartbeat().catch(()=>{stopping=true;currentAbort?.abort();}),15000);
 try{while(!stopping){
  await query("UPDATE public.koa_whatsapp_card_requests SET state=CASE WHEN state='sending' THEN 'uncertain' ELSE 'failed' END,sealed_payload=NULL,error_code='WORKER_INTERRUPTED',updated_at=now() WHERE worker_id=$1 AND state IN ('processing','sending') AND lease_expires_at<now()",[workerId]);
  await query("UPDATE public.koa_whatsapp_card_requests SET state='expired',sealed_payload=NULL,updated_at=now() WHERE state IN ('awaiting_access','queued') AND expires_at<now()");
  const job=(await query(`WITH selected AS (SELECT r.id FROM public.koa_whatsapp_card_requests r JOIN public.koa_whatsapp_channels c ON c.id=r.channel_id
   JOIN public.business_boards b ON b.id=c.board_id AND b.workspace_id=c.workspace_id AND NOT b.archived
   WHERE r.worker_id=$1 AND r.state='queued' AND r.expires_at>now() AND c.conversations_enabled AND c.instance=r.instance
    AND app_private.task_admin_actor(c.workspace_id,c.actor_id) ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1)
   UPDATE public.koa_whatsapp_card_requests r SET state='processing',lease_expires_at=now()+interval '90 seconds',updated_at=now() FROM selected s WHERE r.id=s.id RETURNING r.*`,[workerId])).rows[0];
  if(job)await processJob(job);else await new Promise(resolve=>setTimeout(resolve,2000));
 }}finally{clearInterval(timer);stopping=true;await heartbeat().catch(()=>{});await gate.end();await pool.end();}
}
process.on('SIGINT',()=>{stopping=true;currentAbort?.abort();});process.on('SIGTERM',()=>{stopping=true;currentAbort?.abort();});
run().catch(()=>{console.error('CARD_WORKER_START_FAILED');process.exit(1);});
