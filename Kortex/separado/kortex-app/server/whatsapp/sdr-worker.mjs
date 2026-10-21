import {clients,checked}from'./service.mjs';
import {workerId}from'./relay.mjs';
import {sdrStep}from'./sdr.mjs';
process.env.WHATSAPP_EVOLUTION_TRANSPORT='relay';
const admin=clients().admin,id='sdr-'+workerId();let stopping=false,lastHeartbeat=0;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
try{do{
 try{
  if(Date.now()-lastHeartbeat>10000){await checked(admin.rpc('wa_provider_heartbeat',{p_worker:id,p_state:'ready',p_version:'koa-sdr-1'}));lastHeartbeat=Date.now();}
  await sdrStep(admin);
 }catch(error){console.error(JSON.stringify({code:'SDR_WORKER_RETRY',reason:error.code||'UNAVAILABLE'}));}
 if(process.argv.includes('--once'))break;
 await new Promise(resolve=>setTimeout(resolve,2000));
}while(!stopping);}finally{await checked(admin.rpc('wa_provider_heartbeat',{p_worker:id,p_state:'offline',p_version:'koa-sdr-1'})).catch(()=>{});}
