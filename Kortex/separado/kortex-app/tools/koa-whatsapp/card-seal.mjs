import {createCipheriv,createPublicKey,publicEncrypt,randomBytes,constants} from 'node:crypto';
export function sealCardPayload(value,publicKey,keyId,id){
 const key=randomBytes(32),iv=randomBytes(12);
 try{
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(id));
  const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final(),cipher.getAuthTag()]);
  const wrapped=publicEncrypt({key:createPublicKey({key:publicKey,format:'jwk'}),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
  return {version:1,keyId,key:wrapped.toString('base64'),iv:iv.toString('base64'),data:data.toString('base64')};
 }finally{key.fill(0);}
}
export const savedCardPrefix='KOA carteirinha protegida: ';
