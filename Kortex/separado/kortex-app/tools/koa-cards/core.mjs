import {privateDecrypt,constants,createDecipheriv} from 'node:crypto';
export const validCpf=value=>{
 const n=String(value??'').replace(/\D/g,'');if(!/^\d{11}$/.test(n)||/^(\d)\1+$/.test(n))return false;
 return [9,10].every(length=>{const sum=Array.from(n.slice(0,length),(v,i)=>Number(v)*(length+1-i)).reduce((a,b)=>a+b,0);return Number(n[length])===(sum*10%11)%10;});
};
const date=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('CARD_DATE_INVALID');
 const d=new Date(value+'T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw Error('CARD_DATE_INVALID');return value;
};
export function cardInput(value,now=new Date()){
 if(!value||Object.keys(value).some(k=>!['beneficiaryName','cpf','birthDate','companyCode','operator','password','periodStart','periodEnd'].includes(k)))throw Error('CARD_INPUT_INVALID');
 const beneficiaryName=String(value.beneficiaryName??'').trim().replace(/\s+/g,' '),cpf=String(value.cpf??'').replace(/\D/g,'');
 if(!/^[\p{L}][\p{L}\s.'-]{3,159}$/u.test(beneficiaryName)||beneficiaryName.split(' ').length<2||!validCpf(cpf))throw Error('CARD_IDENTITY_INPUT_INVALID');
 const birthDate=date(value.birthDate);if(birthDate<'1900-01-01'||new Date(birthDate+'T12:00:00Z')>now)throw Error('CARD_IDENTITY_INPUT_INVALID');
 const companyCode=String(value.companyCode??'').replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
 if(!/^[A-Z0-9]{1,40}$/.test(companyCode)||!['ndi','hapvida'].includes(value.operator)||typeof value.password!=='string'||!value.password||value.password.length>200)throw Error('CARD_ACCESS_INPUT_INVALID');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const periodStart=date(value.periodStart||'1900-01-01'),periodEnd=date(value.periodEnd||today);
 if(periodStart>periodEnd)throw Error('CARD_PERIOD_INVALID');
 return {input:{beneficiaryName,cpf,birthDate,contractCode:companyCode,periodStart,periodEnd,beneficiaryScope:'single'},operator:value.operator,credential:{username:companyCode,password:value.password}};
}
export function openCardEnvelope(envelope,privateKey,id){
 if(!envelope||envelope.version!==1)throw Error('CARD_ENVELOPE_INVALID');
 const wrapped=Buffer.from(envelope.key,'base64'),iv=Buffer.from(envelope.iv,'base64'),ciphertext=Buffer.from(envelope.data,'base64');
 if(iv.length!==12||ciphertext.length<17||ciphertext.length>12000)throw Error('CARD_ENVELOPE_INVALID');
 const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},wrapped);
 let clear;
 try{
  if(key.length!==32)throw Error('CARD_ENVELOPE_INVALID');
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from(id));decipher.setAuthTag(ciphertext.subarray(-16));
  clear=Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]);return JSON.parse(clear.toString('utf8'));
 }finally{key.fill(0);clear?.fill(0);}
}
export function cardMedia(peer,bytes){
 if(!/^\d+@(s\.whatsapp\.net|lid)$/.test(peer)||!Buffer.isBuffer(bytes)||bytes.length<100||bytes.length>10*1024*1024||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('CARD_DELIVERY_INVALID');
 return {number:peer,mediatype:'document',mimetype:'application/pdf',fileName:'carteirinha.pdf',caption:'Sua carteirinha, após a conferência dos dados na operadora.',media:bytes.toString('base64')};
}
