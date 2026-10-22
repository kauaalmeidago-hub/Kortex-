import {createHash} from 'node:crypto';
import {HttpError} from './core.mjs';
import {checked} from './service.mjs';
export function validEnvelope(value){
 return value&&value.version===1&&typeof value.keyId==='string'&&/^[a-f0-9]{64}$/.test(value.keyId)
  &&[['key',1024],['iv',24],['data',16000]].every(([key,max])=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=max&&/^[A-Za-z0-9+/]+={0,2}$/.test(value[key]))
  &&Buffer.from(value.iv,'base64').length===12&&Object.keys(value).every(key=>['version','keyId','key','iv','data'].includes(key));
}
export async function cardAccess(admin,body,now=Date.now()){
 if(!['open','submit','status'].includes(body?.action)||Object.keys(body).some(k=>!['action','token','envelope'].includes(k))||typeof body.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.token))throw new HttpError(400,'CARD_LINK_INVALID','Solicite um novo link ao KOA.');
 const tokenHash=createHash('sha256').update(body.token).digest('hex');
 const row=await checked(admin.from('koa_whatsapp_card_requests').select('id,state,expires_at,worker_id,key_id,sealed_hash,channel_id').eq('token_hash',tokenHash).maybeSingle());
 if(!row||Date.parse(row.expires_at)<now)throw new HttpError(410,'CARD_LINK_EXPIRED','Este link expirou. Peça um novo ao KOA pelo WhatsApp.');
 const channel=await checked(admin.from('koa_whatsapp_channels').select('conversations_enabled').eq('id',row.channel_id).maybeSingle());
 if(!channel?.conversations_enabled)throw new HttpError(403,'CARD_CHANNEL_PAUSED','Este atendimento foi pausado. Procure a equipe.');
 if(body.action==='status')return {state:row.state};
 const worker=await checked(admin.from('koa_whatsapp_card_workers').select('ready,last_seen_at,public_key,key_id').eq('id',row.worker_id).maybeSingle());
 if(!worker?.ready||Date.parse(worker.last_seen_at)<now-45000||worker.key_id!==row.key_id)throw new HttpError(503,'CARD_WORKER_OFFLINE','A ferramenta local está offline. Tente novamente em instantes.');
 if(body.action==='open')return {id:row.id,state:row.state,expiresAt:row.expires_at,publicKey:worker.public_key,keyId:worker.key_id};
 if(!validEnvelope(body.envelope)||body.envelope.keyId!==row.key_id)throw new HttpError(400,'CARD_DATA_INVALID','Não foi possível proteger os dados. Reabra o formulário.');
 const sealedHash=createHash('sha256').update(JSON.stringify(body.envelope)).digest('hex');
 if(row.state!=='awaiting_access'){
  if(row.sealed_hash===sealedHash)return {state:row.state};
  throw new HttpError(409,'CARD_ALREADY_SUBMITTED','Este pedido já foi enviado. Acompanhe pelo WhatsApp.');
 }
 const updated=await checked(admin.from('koa_whatsapp_card_requests').update({sealed_payload:body.envelope,sealed_hash:sealedHash,state:'queued',expires_at:new Date(now+20*60000).toISOString(),updated_at:new Date(now).toISOString()})
  .eq('id',row.id).eq('state','awaiting_access').select('id'));
 if(!updated.length)throw new HttpError(409,'CARD_ALREADY_SUBMITTED','Este pedido já foi enviado.');
 return {state:'queued'};
}
