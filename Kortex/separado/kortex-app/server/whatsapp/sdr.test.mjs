import test from 'node:test';import assert from 'node:assert/strict';
import {qualifySdr,validateSdr,immediateHandoff,sdrStep}from'./sdr.mjs';
const ask={action:'ask',reply:'Olá, sou o KOA, assistente virtual. Qual é o seu município?',summary:'Cliente deseja cotação.',request_type:'comercial',facts:{name:null,city:null,modality:null,lives:null},missing:['city']};
test('SDR uses a strict schema and scoped text without placing the credential in the model input',async()=>{
 let body;
 const result=await qualifySdr([{body:'quero plano para minha empresa',kind:'text',from_me:false}],{api_key:'private-test-key',model:'configured-model'},{fetcher:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(options.body);return{ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(ask)}]}]})};}});
 assert.equal(result.action,'ask');assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(JSON.stringify(body).includes('private-test-key'),false);assert.equal(body.model,'configured-model');
});
test('human requests, attachments and a bounded qualification reach a person without an OpenAI request',async()=>{
 for(const message of [{body:'quero falar com uma pessoa',kind:'text'},{body:'',kind:'audio'}]){
  assert.equal((await qualifySdr([{...message,from_me:false}],null,{fetcher:()=>{throw Error('must not call');}})).action,'handoff');
 }
 assert.equal(immediateHandoff([{body:'Ainda tenho dúvidas',kind:'text',from_me:false}],8).action,'handoff');
 assert.equal(immediateHandoff([{body:'quero plano para uma pessoa',kind:'text',from_me:false}]),null);
});
test('complete initial facts go to a human without repeating a confirmation question',()=>{
 const r=validateSdr({...ask,facts:{name:'Ana',city:'Campinas',modality:'empresa',lives:'12'}});
 assert.equal(r.action,'handoff');assert.equal(r.reply,'');assert.deepEqual(r.missing,[]);
});
test('incomplete, refused and invalid model responses never become customer replies',async()=>{
 for(const data of [{status:'incomplete'},{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}])await assert.rejects(qualifySdr([{body:'olá',kind:'text',from_me:false}],{api_key:'x',model:'y'},{fetcher:async()=>({ok:true,json:async()=>data})}));
 assert.throws(()=>validateSdr({...ask,reply:'O plano está garantido por R$ 50.'}));
 assert.throws(()=>validateSdr({...ask,reply:'Qual nome? Qual cidade?'}));
});
function fakeAdmin(plan=true){
 const calls=[];const job={id:'job',token:'lease',case_id:'case',request_id:'request',conversationId:'conversation',connectionId:'channel',actorId:'actor',workspaceId:'workspace',caseCreatedAt:'date',activatedAt:'date',replies:0};
 const rows=table=>table==='wa_messages'?[{body:'quero plano',kind:'text',from_me:false}]:{id:'channel',state:'connected'};
 return{calls,rpc:async(name,args)=>{calls.push({name,args});return{data:name==='wa_sdr_take'?job:name==='task_ai_secret'?{api_key:'private',model:'configured'}:name==='wa_sdr_plan'?plan:name==='wa_sdr_reserve'?false:null};},from:table=>{
  const p=new Proxy({},{get:(_,key)=>key==='then'?Promise.resolve({data:rows(table)}).then.bind(Promise.resolve({data:rows(table)})):()=>p});return p;
 }};
}
test('a human takeover during inference discards the reply before sending',async()=>{
 const admin=fakeAdmin(false);let sent=0;
 await sdrStep(admin,{qualify:async()=>ask,sender:async()=>{sent++;}});assert.equal(sent,0);
 assert.equal(admin.calls.filter(c=>c.name==='wa_sdr_complete').length,0);
});
test('the send boundary rechecks the database fence and never retries a stale reply',async()=>{
 const admin=fakeAdmin();let providerCalls=0;
 await sdrStep(admin,{qualify:async()=>ask,sender:async(_admin,c,b)=>{await c.reserveMessage(b.requestId,'hash');providerCalls++;}});
 assert.equal(providerCalls,0);assert.equal(admin.calls.filter(c=>c.name==='wa_sdr_reserve').length,1);
});
test('an uncertain send is handed to human review without an automatic resend',async()=>{
 const admin=fakeAdmin();let sent=0;
 await sdrStep(admin,{qualify:async()=>ask,sender:async()=>{sent++;return{state:'uncertain',uncertain:true};}});
 assert.equal(sent,1);assert.equal(admin.calls.at(-1).args.p_ok,false);
});
