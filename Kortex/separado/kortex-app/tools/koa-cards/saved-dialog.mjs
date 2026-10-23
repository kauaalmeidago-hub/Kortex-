import {resolveSavedCompany} from './saved-access.mjs';
import {cardInput,openCardEnvelope} from './core.mjs';
export function identityFromText(text){
 const fields={};
 const name=text.match(/(?:^|\n)\s*nome(?:\s+completo)?\s*:\s*([^\n]{4,160})/iu);
 const cpf=text.match(/(?:^|\n)\s*cpf\s*:\s*([\d. -]{11,18})/iu);
 const birth=text.match(/(?:^|\n)\s*(?:data\s+de\s+)?nascimento\s*:\s*(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/iu);
 if(name)fields.beneficiaryName=name[1].trim();if(cpf)fields.cpf=cpf[1].replace(/\D/g,'');
 if(birth)fields.birthDate=birth[1].replace(/^(\d{2})\/(\d{2})\/(\d{4})$/,'$3-$2-$1');
 return fields;
}
const prompt='Localizei o acesso salvo da empresa. Para enviar somente a sua carteirinha, confirme neste privado:\nNome completo: seu nome\nNascimento: DD/MM/AAAA\nCPF: seu CPF (opcional)\nNão precisa informar login ou senha.';
export async function prepareSavedDialog({query,job,privateKey,readProfile=async()=>null}){
 const packet=job.sealed_payload;
 if(packet?.mode!=='saved_company'||typeof packet.incomingId!=='string'||packet.incomingId.length>200)throw Error('SAVED_CARD_PACKET_INVALID');
 const incoming=openCardEnvelope(packet.incoming,privateKey,packet.incomingId);
 if(typeof incoming.text!=='string'||incoming.text.length>4000)throw Error('SAVED_CARD_PACKET_INVALID');
 const state=packet.continuation?openCardEnvelope(packet.continuation,privateKey,job.id):{};
 let company;
 try{company=await resolveSavedCompany(query,{channelId:job.channel_id,companyName:state.companyName||incoming.text,mention:!state.companyName});}
 catch(error){
  if(error.code==='SAVED_COMPANY_NOT_AVAILABLE'||error.code==='SAVED_COMPANY_NAME_REQUIRED')return {prompt:'Qual é o nome completo da empresa? Vou usar o acesso já salvo e vinculado ao KOA.',state:{}};
  throw error;
 }
 const identity={...await readProfile(company),...state.identity,...identityFromText(incoming.text)};
 try{cardInput({...identity,companyCode:company.companyCode,operator:company.operator,password:'$saved-access$'},new Date(),{allowMissingCpf:true});}
 catch{return {prompt,state:{companyName:company.companyName,identity}};}
 return {company,identity};
}
