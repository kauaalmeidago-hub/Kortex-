import {createHash,createHmac} from 'node:crypto';
import {normalizeMessage} from './core.mjs';
import {sealCardPayload,savedCardPrefix} from './card-seal.mjs';

export const cardRequestText=text=>/\bcarteirinh[ao]s?\b|carteira\s+provis[oó]ria|cart[aã]o\s+(?:do\s+plano|do\s+benefici[aá]rio)/iu.test(text);
const hash=value=>createHash('sha256').update(value).digest('hex');
const active=['awaiting_access','queued','processing','sending'];
export class CardIntake {
 constructor({query,secret,origin,accessMode='form'}){
  if(!secret||secret.length<32||new URL(origin).protocol!=='https:')throw Error('CARD_INTAKE_CONFIGURATION');
  if(!['form','saved'].includes(accessMode))throw Error('CARD_ACCESS_MODE_INVALID');
  Object.assign(this,{query,secret,origin,accessMode});
 }
 async ready(){try{return Boolean((await this.query("SELECT 1 FROM public.koa_whatsapp_card_workers WHERE ready AND last_seen_at>now()-interval '45 seconds' LIMIT 1")).rows.length);}catch{return false;}}
 async current(channel,peer){return (await this.query(`SELECT id,state,source_event,sealed_payload,key_id,worker_id FROM public.koa_whatsapp_card_requests WHERE channel_id=$1 AND peer_jid=$2
  AND state=ANY($3) AND expires_at>now() ORDER BY created_at DESC LIMIT 1`,[channel,peer,active])).rows[0];}
 token(channel,peer,event){return createHmac('sha256',this.secret).update(['koa-card-v1',channel,peer,event].join(':')).digest('base64url');}
 async sanitize(raw,channel,peer){
  const text=normalizeMessage(raw,{allowPrivate:true})?.text??'';
  if(/^\s*(?:cancelar|cancele|status|andamento|obrigado)[.!?\s]*$/iu.test(text))return raw;
  const sensitive=/(?:senha|password|\bcpf\b|nasciment|\d{3}[. ]?\d{3}[. ]?\d{3}[- ]?\d{2}|\/koa\/carteirinha#)/iu.test(text);
  let pending=false,lookupFailed=false;try{pending=Boolean(await this.current(channel,peer));}catch{lookupFailed=true;}
  if(this.accessMode==='saved'&&lookupFailed&&/(?:^|\n)\s*(?:nome(?:\s+completo)?|cpf|(?:data\s+de\s+)?nascimento)\s*:/iu.test(text))return {...raw,message:{conversation:'KOA, pedido de carteirinha indisponível.'}};
  if(this.accessMode==='saved'&&(pending||cardRequestText(text))){
   const worker=(await this.query("SELECT id,key_id,public_key FROM public.koa_whatsapp_card_workers WHERE ready AND last_seen_at>now()-interval '45 seconds' ORDER BY last_seen_at DESC LIMIT 1")).rows[0];
   if(!worker)return {...raw,message:{conversation:'KOA, pedido de carteirinha indisponível.'}};
   const id=normalizeMessage(raw,{allowPrivate:true}).id;
   const envelope=sealCardPayload({text:text.slice(0,4000)},worker.public_key,worker.key_id,id);
   return {...raw,message:{conversation:savedCardPrefix+JSON.stringify({envelope,incomingId:id})}};
  }
  if(!pending&&!cardRequestText(text)&&!text.includes('/koa/carteirinha#')&&!/\b(?:senha|password)\b/iu.test(text))return raw;
  if(!sensitive&&!pending)return raw;
  return {...raw,message:{conversation:cardRequestText(text)?'KOA, quero emitir minha carteirinha. [Dados omitidos; usar formulário protegido.]':'[Pedido de carteirinha: usar formulário protegido.]'}};
 }
 async handle({inbox,channel,message}){
  if(message.chatType!=='private')return null;
  let pending;try{pending=await this.current(channel.id,message.group);}catch{
   return cardRequestText(message.text)?['A emissão de carteirinhas está temporariamente indisponível. Tente novamente em instantes.']:null;
  }
  if(!pending&&!cardRequestText(message.text))return null;
  inbox.db.prepare('UPDATE inbox SET integration=? WHERE id=?').run('card',message.id);
  if(/^\s*(?:cancelar|cancele|cancelamento)\b/iu.test(message.text)&&pending){
   await this.query("UPDATE public.koa_whatsapp_card_requests SET state='cancelled',sealed_payload=NULL,updated_at=now() WHERE id=$1 AND state=ANY($2)",[pending.id,active]);
   return ['Pedido de carteirinha cancelado.'];
  }
  if(this.accessMode==='saved')return this.handleSaved({pending,channel,message});
  if(pending){
   if(pending.state==='awaiting_access')return ['Preencha o formulário protegido para informar seus dados e o acesso temporário: '+this.origin+'/koa/carteirinha#'+this.token(channel.id,message.group,pending.source_event)];
   return ['Seu pedido de carteirinha está em processamento. O resultado será enviado somente neste privado.'];
  }
  const worker=(await this.query("SELECT id,key_id FROM public.koa_whatsapp_card_workers WHERE ready AND last_seen_at>now()-interval '45 seconds' ORDER BY last_seen_at DESC LIMIT 1")).rows[0];
  if(!worker)return ['A emissão de carteirinhas está temporariamente indisponível. Tente novamente quando a ferramenta local estiver online.'];
  const recent=(await this.query("SELECT count(*)::int n FROM public.koa_whatsapp_card_requests WHERE channel_id=$1 AND peer_jid=$2 AND created_at>now()-interval '1 hour'",[channel.id,message.group])).rows[0].n;
  if(recent>=3)return ['Você atingiu o limite de tentativas de carteirinha deste período. Aguarde uma hora ou procure a equipe de atendimento.'];
  const token=this.token(channel.id,message.group,message.id);
  await this.query(`INSERT INTO public.koa_whatsapp_card_requests(channel_id,source_event,peer_jid,instance,token_hash,worker_id,key_id)
   VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(channel_id,source_event) DO NOTHING`,[channel.id,message.id,message.group,channel.instance,hash(token),worker.id,worker.key_id]);
  return ['Para emitir sua própria carteirinha, preencha os dados de identificação e o acesso temporário neste formulário protegido: '+this.origin+'/koa/carteirinha#'+token+'\nNão envie a senha por mensagem. O acesso será usado somente neste pedido, sem cadastrar empresa.'];
 }
 async handleSaved({pending,channel,message}){
  if(message.text.includes('carteirinha indisponível'))return ['A ferramenta local está offline. Tente novamente em instantes.'];
  if(pending&&/^\s*(?:status|andamento|obrigado)[.!?\s]*$/iu.test(message.text))return [pending.state==='awaiting_access'?'Seu pedido aguarda sua resposta à última pergunta do KOA neste privado.':'Seu pedido está em processamento.'];
  if(pending&&pending.state!=='awaiting_access')return ['Seu pedido está em processamento. O resultado será enviado somente neste privado.'];
  if(!message.text.startsWith(savedCardPrefix))return ['Informe o nome completo da empresa neste privado para usar o acesso já salvo. Não precisa enviar login ou senha.'];
  let incoming;try{incoming=JSON.parse(message.text.slice(savedCardPrefix.length));}catch{return ['Não foi possível receber os dados. Tente novamente neste privado.'];}
  const worker=(await this.query("SELECT id,key_id FROM public.koa_whatsapp_card_workers WHERE ready AND last_seen_at>now()-interval '45 seconds' ORDER BY last_seen_at DESC LIMIT 1")).rows[0];
  if(!worker||incoming.envelope?.keyId!==worker.key_id)return ['A emissão está temporariamente indisponível. Tente novamente em instantes.'];
  const packet={mode:'saved_company',incoming:incoming.envelope,incomingId:incoming.incomingId,continuation:pending?.sealed_payload?.continuation??null};
  if(pending){
   if(pending.key_id!==worker.key_id||pending.worker_id!==worker.id)return ['Este pedido precisa ser cancelado antes de iniciar outro. Envie cancelar.'];
   const result=await this.query("UPDATE public.koa_whatsapp_card_requests SET sealed_payload=$2::jsonb,state='queued',expires_at=now()+interval '20 minutes',updated_at=now() WHERE id=$1 AND state='awaiting_access' RETURNING id",[pending.id,JSON.stringify(packet)]);
   return [result.rows.length?'Recebi os dados. Vou conferir a emissão na operadora.':'Seu pedido já está em processamento.'];
  }
  const recent=(await this.query("SELECT count(*)::int n FROM public.koa_whatsapp_card_requests WHERE channel_id=$1 AND peer_jid=$2 AND created_at>now()-interval '1 hour'",[channel.id,message.group])).rows[0].n;
  if(recent>=3)return ['Você atingiu o limite de pedidos deste período. Aguarde uma hora ou procure a equipe de atendimento.'];
  await this.query(`INSERT INTO public.koa_whatsapp_card_requests(channel_id,source_event,peer_jid,instance,token_hash,worker_id,key_id,state,sealed_payload,expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8::jsonb,now()+interval '20 minutes') ON CONFLICT(channel_id,source_event) DO NOTHING`,[channel.id,message.id,message.group,channel.instance,hash(this.token(channel.id,message.group,message.id)),worker.id,worker.key_id,JSON.stringify(packet)]);
  return ['Vou consultar o acesso salvo da empresa. Se faltar sua identificação, confirmo os dados por aqui.'];
 }
}
