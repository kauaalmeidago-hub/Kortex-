const base64=(bytes:Uint8Array)=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
export async function sealCardData(id:string,keyId:string,publicKey:JsonWebKey,input:Record<string,string>){
 const rsa=await crypto.subtle.importKey('jwk',publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
 const raw=await crypto.subtle.exportKey('raw',key),iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(id)},key,new TextEncoder().encode(JSON.stringify(input)));
 const wrapped=await crypto.subtle.encrypt({name:'RSA-OAEP'},rsa,raw);new Uint8Array(raw).fill(0);
 return {version:1,keyId,key:base64(new Uint8Array(wrapped)),iv:base64(iv),data:base64(new Uint8Array(data))};
}
