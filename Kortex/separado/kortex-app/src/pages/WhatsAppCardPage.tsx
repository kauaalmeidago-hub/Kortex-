import {useEffect,useState} from 'react';
import {sealCardData} from '@/features/whatsapp/cardCrypto';
type Access={id:string;state:string;publicKey:JsonWebKey;keyId:string};
async function request(body:Record<string,unknown>){
 const response=await fetch('/api/koa-cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',referrerPolicy:'no-referrer'});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Tente novamente.');return data;
}
export default function WhatsAppCardPage(){
 const [token]=useState(()=>window.location.hash.slice(1));
 const [access,setAccess]=useState<Access|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false);
 useEffect(()=>{let active=true;request({action:'open',token}).then(data=>{if(active){
  if(['cancelled','expired','failed','uncertain'].includes(data.state)){setError('Este pedido foi encerrado. Consulte o KOA no WhatsApp antes de solicitar outro.');return;}
  setAccess(data);setSent(data.state!=='awaiting_access');
 }}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[token]);
 return <main className="min-h-screen bg-background p-5 text-foreground"><section className="mx-auto my-8 max-w-lg rounded-2xl border bg-card p-6 shadow-sm">
  <p className="mb-2 text-sm font-semibold text-primary">KOA · WhatsApp</p><h1 className="text-2xl font-semibold">Sua carteirinha</h1>
  <p className="mt-3 text-sm text-muted-foreground">Informe seus dados e o acesso da operadora para esta emissão. A empresa não será cadastrada e o acesso não será salvo para outros pedidos.</p>
  {error&&<p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
  {sent?<p role="status" className="mt-6 rounded-lg bg-primary/10 p-4">Pedido recebido. O KOA enviará o resultado no mesmo privado do WhatsApp após conferir sua identidade. Você pode fechar esta página.</p>:access?<form className="mt-6 space-y-4" autoComplete="off" onSubmit={async event=>{
   event.preventDefault();if(busy)return;setBusy(true);setError('');
   const form=event.currentTarget,fields=new FormData(form),input=Object.fromEntries(Array.from(fields.entries(),([key,value])=>[key,key==='password'?String(value):String(value).trim()]));
   try{const envelope=await sealCardData(access.id,access.keyId,access.publicKey,input);await request({action:'submit',token,envelope});form.reset();setSent(true);}
   catch(e){setError(e instanceof Error?e.message:'Não foi possível enviar.');}finally{input.password='';setBusy(false);}
  }}>
   {([['beneficiaryName','Seu nome completo','text'],['cpf','Seu CPF','text'],['birthDate','Sua data de nascimento','date'],['companyCode','Código de acesso da empresa','text']] as const).map(([name,label,type])=><label key={name} className="block text-sm font-medium">{label}<input className="mt-1 block w-full rounded-lg border border-input bg-background p-3" name={name} type={type} required maxLength={name==='beneficiaryName'?160:40} autoComplete="off" inputMode={name==='cpf'?'numeric':undefined}/></label>)}
   <label className="block text-sm font-medium">Operadora<select name="operator" className="mt-1 block w-full rounded-lg border border-input bg-background p-3" required><option value="">Selecione</option><option value="hapvida">Hapvida</option><option value="ndi">NDI</option></select></label>
   <label className="block text-sm font-medium">Senha da operadora<input name="password" type="password" className="mt-1 block w-full rounded-lg border border-input bg-background p-3" required maxLength={200} autoComplete="new-password"/></label>
   <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Informar período de adesão, se necessário</summary><div className="mt-3 grid grid-cols-2 gap-3"><label>Início<input className="mt-1 w-full rounded border bg-background p-2" type="date" name="periodStart"/></label><label>Fim<input className="mt-1 w-full rounded border bg-background p-2" type="date" name="periodEnd"/></label></div></details>
   <p className="text-xs text-muted-foreground">Solicite apenas sua própria carteirinha. Se os dados não forem confirmados na operadora, o arquivo não será enviado.</p>
   <button className="w-full rounded-lg bg-primary p-3 font-medium text-primary-foreground disabled:opacity-50" disabled={busy}>{busy?'Enviando pedido…':'Solicitar minha carteirinha'}</button>
  </form>:!error&&<p role="status" className="mt-6 text-sm">Abrindo pedido…</p>}
 </section></main>;
}
