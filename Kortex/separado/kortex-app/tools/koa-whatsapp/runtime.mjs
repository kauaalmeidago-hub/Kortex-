import {modelRequest,parseReply,greetingReplies,normalizeMessage,referencesKoa} from './core.mjs';
import {requestedTaskModel,parseTaskDecision,taskResultReplies,databaseTaskItems} from './tasks.mjs';
import {withGroupActions,parseGroupAction,normalizeGroupAction,addressedToOtherMember,composeGroupReplies,loadGroupDirectory,groupDirectory,textPayload,mentionToken} from './groups.mjs';
import {ConversationScheduler} from './scheduler.mjs';
import {FileInputError,requireReadableFiles} from '../../supabase/functions/_shared/file-inputs.mjs';
import {loadMessageFile,withMessageFiles,responseFileReviews} from './files.mjs';
import {withPrivateConversation} from './private.mjs';

export class WhatsAppRuntime {
 constructor({inbox,loadChannels,query,evolution,fetchAI=fetch,concurrency=8,now=Date.now,privateMessages=false,privateActivatedAt=null,privatePolicy='group_members',groupMessages=true}) {
  if(privateMessages&&(!privateActivatedAt||!Number.isFinite(Date.parse(privateActivatedAt))))throw Error('PRIVATE_ACTIVATION_REQUIRED');
  if(!['group_members','koa_call'].includes(privatePolicy))throw Error('PRIVATE_POLICY_INVALID');
  Object.assign(this,{inbox,loadChannels,query,evolution,fetchAI,now,privateMessages,privateActivatedAt,privatePolicy,groupMessages});
  this.channels=[];this.instances=new Map();this.errors=new Map();this.heartbeats=new Map();
  this.privateDirectories=new Map();this.privateLoads=new Map();
  this.loadedAt=null;this.loading=null;this.beating=null;
  this.scheduler=new ConversationScheduler({inbox,concurrency,now,process:row=>this.processOne(row),onError:(error,row)=>{
   this.errors.set('worker','WORKER_UNAVAILABLE');
   const saved=inbox.db.prepare('SELECT state FROM inbox WHERE id=?').get(row.id);
   if(saved?.state==='processing')inbox.retry(row,'WORKER_UNAVAILABLE');
   else if(saved?.state==='sending') {
    const part=inbox.db.prepare("SELECT * FROM outbox_parts WHERE inbox_id=? AND state='sending'").get(row.id);
    if(part)inbox.uncertain(part);
   }
  }});
 }
 async refresh(force=false) {
  if(!force&&this.loadedAt!==null&&this.now()-this.loadedAt<1000)return this.channels;
  if(this.loading)return this.loading;
  this.loading=(async()=>{
   const channels=await this.loadChannels();
   const routes=new Set();
   for(const channel of channels) {
    const route=channel.group_jid; // Inbox memory is isolated by chat JID.
    if(routes.has(route))throw Error('CHANNEL_ROUTE_CONFLICT');
    routes.add(route);
   }
   this.channels=channels;this.loadedAt=this.now();return channels;
  })();
  try{return await this.loading;}finally{this.loading=null;}
 }
 channel(message,channels=this.channels) {
  if(message.chatType==='private'&&!this.privateMessages)return null;
  if(message.chatType!=='private'&&!this.groupMessages)return null;
  const matches=channels.filter(c=>(message.chatType==='private'?c.id===message.channel_id&&c.group_jid===message.origin_group:c.group_jid===message.group)&&(!message.instance||c.instance===message.instance));
  return matches.length===1?matches[0]:null;
 }
 async accept(payload) {
  // Receiving a known enabled channel needs only a durable local write. A
  // remote configuration query must not hold up the webhook acknowledgement.
  // Processing and each external send still refresh/revalidate authorization.
  const cached=this.loadedAt!==null&&this.channels.some(c=>c.instance===payload?.instance&&(c.conversations_enabled||c.tasks_enabled));
  const channels=cached?this.channels:await this.refresh(true);let accepted=0;
  for(const channel of channels)if(this.groupMessages&&channel.instance===payload?.instance&&(channel.conversations_enabled||channel.tasks_enabled))
   accepted+=this.inbox.ingest(payload,channel,this.now());
  if(this.privateMessages&&String(payload?.event).replaceAll('_','.').toLowerCase()==='messages.upsert'){
   const items=Array.isArray(payload.data)?payload.data:[payload.data];
   for(const raw of items){
    const message=normalizeMessage(raw,{allowPrivate:true});
    if(message?.chatType!=='private'||message.fromMe||message.timestamp*1000<Date.parse(this.privateActivatedAt)||message.timestamp*1000>this.now()+120000)continue;
    if(this.privatePolicy==='koa_call'){
     // Public private-chat pilot: only the caller's peer JID is used. Neither
     // display names nor the message content can select a workspace/destination.
     const parents=new Map();
     for(const channel of channels.filter(c=>c.instance===payload.instance&&c.conversations_enabled))if(!parents.has(channel.id))parents.set(channel.id,channel);
     if(parents.size!==1)continue;
     const channel=[...parents.values()][0],at=message.timestamp*1000;
     if(at<Date.parse(channel.activated_at))continue;
     if(referencesKoa(message.text))this.inbox.activatePrivateCall(channel.id,channel.instance,message.group,at,Date.parse(this.privateActivatedAt));
     if(!this.inbox.privateCallAllowed(channel.id,channel.instance,message.group,at,Date.parse(this.privateActivatedAt),this.now()))continue;
     accepted+=this.inbox.ingest({...payload,data:raw},{...channel,group_jid:message.group,
      activated_at:new Date(Math.max(Date.parse(channel.activated_at),Date.parse(this.privateActivatedAt))).toISOString(),
      private_peer:{aliases:[message.group],name:null,origin_group:channel.group_jid,policy:'koa_call'}},this.now());
     continue;
    }
    const matches=[];
    for(const channel of channels.filter(c=>c.instance===payload.instance&&c.conversations_enabled)){
     if(message.timestamp*1000<Date.parse(channel.activated_at))continue;
     const bot=this.instances.get(channel.instance)?.botJid;
     const member=(await this.privateMembers(channel,bot)).find(p=>p.aliases.includes(message.group));
     if(member)matches.push({channel,member});
    }
    // Groups sharing the same real channel also share its authorized task
    // destinations. A different parent still requires explicit routing.
    const parents=new Map(matches.map(match=>[match.channel.id,match]));
    if(parents.size!==1)continue;
    const {channel,member}=matches[0];
    accepted+=this.inbox.ingest({...payload,data:raw},{...channel,group_jid:member.jid,
     activated_at:new Date(Math.max(Date.parse(channel.activated_at),Date.parse(this.privateActivatedAt))).toISOString(),
     private_peer:{aliases:member.aliases,name:member.names[0]??null,origin_group:channel.group_jid}},this.now());
   }
  }
  if(accepted)this.scheduler.wake();
  return accepted;
 }
 async directory(channel,botJid) {
  return loadGroupDirectory(this.evolution,channel,
   this.inbox.db.prepare('SELECT * FROM participant_names WHERE group_jid=?').all(channel.group_jid),botJid);
 }
 async privateMembers(channel,botJid,force=false){
  const key=this.routeKey(channel),cached=this.privateDirectories.get(key);
  if(!force&&cached&&this.now()-cached.loadedAt<60000)return cached.members;
  if(this.privateLoads.has(key))return this.privateLoads.get(key);
  const loading=this.directory(channel,botJid).then(members=>{this.privateDirectories.set(key,{members,loadedAt:this.now()});return members;});
  this.privateLoads.set(key,loading);
  try{return await loading;}finally{this.privateLoads.delete(key);}
 }
 routeKey(channel){return channel.instance+':'+channel.group_jid;}
 async privateAllowed(message,channel,botJid){
  if(!this.privateMessages||message.timestamp*1000<Date.parse(this.privateActivatedAt)||message.fromMe)return false;
  if(this.privatePolicy==='koa_call'){
   const parents=new Set(this.channels.filter(c=>c.instance===channel.instance&&c.conversations_enabled).map(c=>c.id));
   return message.privatePolicy==='koa_call'&&message.sourceJid===message.group&&parents.size===1&&parents.has(channel.id)
    &&this.inbox.privateCallAllowed(channel.id,channel.instance,message.group,message.timestamp*1000,Date.parse(this.privateActivatedAt),this.now());
  }
  if(message.privatePolicy==='koa_call')return false;
  const routes=this.channels.filter(c=>c.id===channel.id&&c.instance===channel.instance&&c.conversations_enabled);
  const access=await Promise.allSettled(routes.map(async route=>{
   const data=await this.evolution('/group/participants/'+encodeURIComponent(route.instance)+'?groupJid='+encodeURIComponent(route.group_jid));
   const member=groupDirectory(data.participants,[],[],botJid).find(p=>p.aliases.includes(message.sourceJid));
   return Boolean(member&&member.jid===message.group);
  }));
  if(access.some(r=>r.status==='fulfilled'&&r.value))return true;
  if(access.some(r=>r.status==='rejected'))throw Error('PRIVATE_MEMBERS_UNAVAILABLE');
  return false;
 }
 async planReplies(id,replies,decision,message,context,channel,botJid) {
  const action=decision.group_action;
  const parts=action&&action.kind!=='none'
   ?composeGroupReplies(replies,action,message,context,await this.directory(channel,botJid),channel.tasks_enabled):replies;
  this.inbox.plan(id,parts,action?.kind==='introduction');
 }
 async processOne(row) {
  const {inbox}=this,message=JSON.parse(row.payload);
  let channel;
  try{channel=this.channel(message,await this.refresh());}
  catch{inbox.defer(row.id,'CONFIG_UNAVAILABLE',this.now(),1000);return;}
  if(!channel||(!channel.conversations_enabled&&!channel.tasks_enabled)
   ||message.timestamp*1000<new Date(channel.activated_at).getTime()) {
   inbox.finish(row.id,'ignored','PAUSED');return;
  }
  const instance=this.instances.get(channel.instance);
  if(instance?.connection!=='open'){inbox.defer(row.id,'DISCONNECTED',this.now(),1000);return;}
  if(message.chatType==='private'){
   try{if(!await this.privateAllowed(message,channel,instance.botJid)){inbox.finish(row.id,'ignored','PRIVATE_ACCESS_REVOKED');return;}}
   catch{inbox.defer(row.id,'PRIVATE_MEMBERS_UNAVAILABLE',this.now(),5000);return;}
  }
  const reason=inbox.reason(message,instance.botJid,this.now());
  if(!reason){inbox.finish(row.id,'ignored');return;}
  if(!row.answer) {
   try {
    if(reason==='resposta de participante chamado pelo KOA'&&addressedToOtherMember(message,await this.directory(channel,instance.botJid))){inbox.finish(row.id,'ignored');return;}
    const context=inbox.context(message),greeting=greetingReplies(message,context);
    const taskMode=channel.tasks_enabled&&channel.tasks_activated_at&&message.timestamp*1000>=new Date(channel.tasks_activated_at).getTime();
    let decision=inbox.taskDecision(row.id);
    if(decision&&!taskMode){inbox.finish(row.id,'ignored','TASK_MODE_PAUSED');return;}
    if(greeting&&!decision)inbox.plan(row.id,greeting,!context.apresentacao_realizada);
    else {
     if(!decision) {
      const candidates=inbox.fileMessages(message),files=[];
      if(candidates.length>1)throw new FileInputError('FILE_AMBIGUOUS','Há mais de um arquivo recente. Responda à mensagem do arquivo que devo analisar para esta tarefa.');
      for(const candidate of candidates){const file=await loadMessageFile(candidate,this.evolution,channel.instance);if(file)files.push(file);}
      const secret=(await this.query('SELECT public.task_ai_secret($1,$2) value',[channel.actor_id,channel.workspace_id])).rows[0]?.value;
      if(!secret?.api_key||!secret.model)throw Error('AI_NOT_CONFIGURED');
      const request=withMessageFiles(withPrivateConversation(withGroupActions((taskMode?requestedTaskModel:modelRequest)(secret.model,message,context,reason)),message,context),files);
      let response;
      try {
       response=await this.fetchAI('https://api.openai.com/v1/responses',{method:'POST',
        headers:{Authorization:'Bearer '+secret.api_key,'Content-Type':'application/json'},
        body:JSON.stringify(request),signal:AbortSignal.timeout(45000)});
      }finally{secret.api_key=null;}
      if(!response.ok){
       if(files.length&&[400,413,415,422].includes(response.status))throw new FileInputError('FILE_MODEL_UNAVAILABLE','Não consegui ler o arquivo com o modelo configurado. Envie uma cópia legível em PDF, imagem ou texto, ou peça à administração para conferir o modelo.');
       throw Error('AI_'+response.status);
      }
      const payload=await response.json(),reviews=responseFileReviews(payload,files);
      requireReadableFiles(reviews);
      const fileContext={...context,arquivos_lidos:[...(context.arquivos_lidos??[]),...reviews]};
      decision={...(taskMode?parseTaskDecision(payload,message,fileContext):parseReply(payload)),group_action:normalizeGroupAction(parseGroupAction(payload),message)};
      if(message.chatType==='private'&&decision.group_action.kind!=='none')throw Error('AI_INVALID_PRIVATE_ACTION');
      if(reviews.length)inbox.rememberFiles(row.id,reviews);
      if(taskMode)decision=inbox.saveTaskDecision(row.id,decision);
     }
     if(!decision.should_reply){inbox.finish(row.id,'ignored');return;}
     if(decision.tasks?.length) {
      if(message.chatType==='private'){
       const current=this.channel(message,await this.refresh(true));
       if(!current?.conversations_enabled||!current.tasks_enabled||!await this.privateAllowed(message,current,instance.botJid)){inbox.finish(row.id,'ignored','PRIVATE_ACCESS_REVOKED');return;}
      }
      const result=await this.query('SELECT public.koa_whatsapp_create_tasks($1,$2,$3,$4::jsonb) results',
       [channel.id,row.id,new Date(message.timestamp*1000),JSON.stringify(databaseTaskItems(decision))]);
      const replies=taskResultReplies(result.rows[0]?.results,decision);
      if(decision.group_action?.kind==='mention')replies.push(`${mentionToken}, podem ajudar com: ${decision.tasks.map(t=>t.title).join('; ')}?`);
      await this.planReplies(row.id,replies,decision,message,context,channel,instance.botJid);
     }else await this.planReplies(row.id,decision.replies,decision,message,context,channel,instance.botJid);
    }
   }catch(error) {
    if(error instanceof FileInputError){inbox.plan(row.id,[error.message]);this.errors.set(channel.id,error.code);}
    else{const code=/^AI_[A-Z0-9_]+$/.test(error.message)?error.message:'AI_UNAVAILABLE';
     this.errors.set(channel.id,code);inbox.retry(row,code);return;}
   }
  }else inbox.plan(row.id,[row.answer]);
  const part=inbox.nextPart(row.id);
  if(!part){inbox.finish(row.id,'failed','OUTBOX_INVALID');return;}
  let payload;
  try {
   if(message.chatType==='private'&&JSON.parse(part.mentioned).length)throw Error('PRIVATE_GROUP_ACTION');
   payload=textPayload(message.chatType==='private'?message.group:channel.group_jid,part,JSON.parse(part.mentioned).length?await this.directory(channel,instance.botJid):null,
    message.key?{key:message.key,message:message.quotedMessage}:null);
  }catch{inbox.finish(row.id,'failed','GROUP_MEMBERS_UNAVAILABLE');this.errors.set(channel.id,'GROUP_MEMBERS_UNAVAILABLE');return;}
  // Check revocation after all other IO and immediately before the external send.
  let current;
  try{current=this.channel(message,await this.refresh(true));}
  catch{inbox.defer(row.id,'CONFIG_UNAVAILABLE',this.now(),1000);return;}
  if(!current?.conversations_enabled||current.id!==channel.id
   ||message.timestamp*1000<new Date(current.activated_at).getTime()) {
   inbox.finish(row.id,'ignored','PAUSED');return;
  }
  if(message.chatType==='private'){
   try{if(!await this.privateAllowed(message,current,instance.botJid)){inbox.finish(row.id,'ignored','PRIVATE_ACCESS_REVOKED');return;}}
   catch{inbox.defer(row.id,'PRIVATE_MEMBERS_UNAVAILABLE',this.now(),5000);return;}
  }
  // Synchronous reservation prevents parallel sends from sharing a stale counter.
  const counts=inbox.sendCounts(message.group,message.participant,this.now());
  if(counts.total>=25||counts.personal>=8){inbox.defer(row.id,'RATE_LIMIT',this.now());return;}
  inbox.sending(part,this.now());
  try {
   const sent=await this.evolution('/message/sendText/'+encodeURIComponent(channel.instance),{method:'POST',body:JSON.stringify(payload)});
   if(!sent.key?.id)throw Error('SEND_RESULT_UNKNOWN');
   inbox.sent(part,sent.key.id,this.now());this.errors.delete(channel.id);
  }catch{inbox.uncertain(part);this.errors.set(channel.id,'SEND_RESULT_UNKNOWN');}
 }
 async heartbeat() {
  if(this.beating)return this.beating;
  this.beating=this.updateHeartbeat();
  try{return await this.beating;}finally{this.beating=null;}
 }
 async updateHeartbeat() {
  try {
   const channels=await this.refresh(true);
   const results=await Promise.allSettled([...new Set(channels.map(c=>c.instance))].map(async name=>{
    let state=this.instances.get(name)??{connection:'unknown',botJid:''};
    try {
     const status=await this.evolution('/instance/connectionState/'+encodeURIComponent(name));
     state={...state,connection:status.instance?.state??'unknown'};
     if(state.connection==='open'&&!state.botJid) {
      const all=await this.evolution('/instance/fetchInstances?instanceName='+encodeURIComponent(name));
      state.botJid=all.find(x=>x.name===name)?.ownerJid??'';
     }
    }catch{state={...state,connection:'unknown'};}
    this.instances.set(name,state);
    if(this.privateMessages&&this.privatePolicy==='group_members'&&state.connection==='open')await Promise.allSettled(channels.filter(c=>c.instance===name&&c.conversations_enabled).map(c=>this.privateMembers(c,state.botJid,true)));
    const parentRoutes=new Map();for(const route of channels.filter(c=>c.instance===name)){if(!parentRoutes.has(route.id))parentRoutes.set(route.id,[]);parentRoutes.get(route.id).push(route);}
    const writes=await Promise.allSettled([...parentRoutes.values()].map(async routes=>{
     const channel=routes[0],all=[...routes.map(c=>this.inbox.stats(c.group_jid)),this.inbox.stats(null,channel.id)];
     const maximum=key=>{const values=all.map(s=>s[key]).filter(v=>v!==null&&v!==undefined);return values.length?Math.max(...values):null;};
     const stats={received_count:all.reduce((sum,s)=>sum+s.received_count,0),reply_count:all.reduce((sum,s)=>sum+s.reply_count,0),last_event:maximum('last_event'),last_reply:maximum('last_reply')};
     await this.query(`UPDATE public.koa_whatsapp_channels SET heartbeat_at=now(),connection_state=$2,phone_suffix=$3,
      last_event_at=to_timestamp($4::double precision/1000),last_reply_at=to_timestamp($5::double precision/1000),
      received_count=$6,reply_count=$7,last_error_code=$8 WHERE id=$1`,
      [channel.id,state.connection,state.botJid?state.botJid.split('@')[0].slice(-4):null,
       stats.last_event??null,stats.last_reply??null,stats.received_count,stats.reply_count,
       state.connection==='unknown'?'EVOLUTION_UNAVAILABLE':this.errors.get(channel.id)??null]);
     this.heartbeats.set(channel.id,this.now());
    }));
    if(writes.some(r=>r.status==='rejected'))throw Error('HEARTBEAT_UNAVAILABLE');
   }));
   if(results.some(r=>r.status==='rejected'))throw Error('HEARTBEAT_UNAVAILABLE');
   this.errors.delete('worker');
  }catch{this.errors.set('worker','WORKER_UNAVAILABLE');}
  this.scheduler.wake();
 }
 health() {
  const ready=this.channels.length>0&&this.channels.every(c=>this.now()-(this.heartbeats.get(c.id)??0)<60000);
  const states=[...new Set(this.channels.map(c=>this.instances.get(c.instance)?.connection??'unknown'))];
  const stats=this.inbox.stats();
  const privateReady=this.privateMessages&&this.channels.some(c=>c.conversations_enabled&&this.instances.get(c.instance)?.connection==='open'
   &&(this.privatePolicy==='koa_call'?new Set(this.channels.filter(r=>r.instance===c.instance&&r.conversations_enabled).map(r=>r.id)).size===1:
    this.privateDirectories.get(this.routeKey(c))?.members.length>0&&this.now()-this.privateDirectories.get(this.routeKey(c)).loadedAt<60000));
  return {ready,connection:states.length===1?states[0]:'mixed',
   conversations:this.channels.some(c=>c.conversations_enabled),tasks:this.channels.some(c=>c.tasks_enabled),
   tasksMode:this.channels.some(c=>c.tasks_enabled)?'on_request':'disabled',channels:this.channels.length,
   groupConversations:this.groupMessages,privateConversations:this.privateMessages,privatePolicy:this.privateMessages?this.privatePolicy:'disabled',privateReady,
   concurrency:this.scheduler.concurrency,active:this.scheduler.active.size,pending:stats.pending_count,
   oldestPendingMs:stats.oldest_pending_at===null?0:Math.max(0,this.now()-stats.oldest_pending_at)};
 }
 async stop() {await this.scheduler.stop();if(this.beating)await this.beating;}
}
