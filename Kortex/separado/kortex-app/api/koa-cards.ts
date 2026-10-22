import {clients,rateLimit} from '../server/whatsapp/service.mjs';
import {cardAccess} from '../server/whatsapp/card-access.mjs';
export default async function handler(req:any,res:any){
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 try{
  const origin=req.headers.origin;
  const allowed=new Set([process.env.APP_ORIGIN,process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:null].filter(Boolean));
  if(!origin||!allowed.has(origin))return res.status(403).json({error:'Origem não autorizada.'});
  if(Number(req.headers['content-length']||0)>24000)return res.status(413).json({error:'Dados excedem o limite.'});
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(JSON.stringify(body).length>24000)return res.status(413).json({error:'Dados excedem o limite.'});
  const {admin}=clients();await rateLimit(admin,'card-access:'+String(req.headers['x-forwarded-for']||'unknown').split(',')[0],30,60);
  return res.status(200).json(await cardAccess(admin,body));
 }catch(error:any){return res.status(Number(error?.status)||500).json({error:error?.status?error.message:'Não foi possível atender o pedido agora.'});}
}
