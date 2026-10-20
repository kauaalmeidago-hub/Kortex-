import {useRef,useState} from "react";
import {Dialog,DialogContent,DialogDescription,DialogTitle} from "@/components/ui/dialog";
import {CompanyField} from "@/components/companies/CompanyForm";
import {useBusinessAccess} from "@/features/access/BusinessAccess";
import {useUnsavedChanges} from "@/hooks/useUnsavedChanges";
import {actLeadContact,type LeadContact} from "./profile";
import type {LeadRow} from "./service";
export default function LeadContactDialog({lead,previous,unlink,options,onClose,onSaved}:{lead:LeadRow;previous:LeadContact|null;unlink:boolean;options:{id:string;full_name:string}[];onClose:()=>void;onSaved:()=>void}){
 const access=useBusinessAccess();const [mode,setMode]=useState<"create"|"link">("create"),[existing,setExisting]=useState("");
 const initial={full_name:previous?.full_name??"",job_title:previous?.job_title??"",email:previous?.email??"",phone:previous?.phone??""};
 const [values,setValues]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState("");const lock=useRef(false),id=useRef(crypto.randomUUID());
 useUnsavedChanges(!unlink&&(JSON.stringify(values)!==JSON.stringify(initial)||Boolean(existing)));
 const close=()=>{if(busy)return;if(!unlink&&(JSON.stringify(values)!==JSON.stringify(initial)||Boolean(existing))&&!window.confirm("Descartar as alterações deste contato?"))return;onClose();};
 return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="companies-theme lead-contact-dialog"><DialogTitle>{unlink?"Desvincular contato do lead?":previous?"Editar contato":"Adicionar contato"}</DialogTitle><DialogDescription>{unlink?"O cadastro do contato e seus outros vínculos serão preservados.":"Cadastre um contato ou vincule um cadastro autorizado, sem criar uma empresa."}</DialogDescription>
  <form onSubmit={async e=>{e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError("");const token=access.token;try{await actLeadContact(lead.id,previous?.id??(mode==="link"?existing:id.current),unlink?"unlink":previous?"edit":mode,values,previous?.updated_at);if(access.isCurrent(token)){onSaved();onClose();}}catch(err){if(access.isCurrent(token))setError((err as Error).message);}finally{lock.current=false;setBusy(false);}}}>
   {!previous&&<CompanyField label="Como adicionar"><select value={mode} disabled={busy} onChange={e=>setMode(e.target.value as typeof mode)}><option value="create">Cadastrar contato</option><option value="link">Vincular contato existente</option></select></CompanyField>}
   {!unlink&&(mode==="link"&&!previous?<CompanyField label="Contato existente"><select required value={existing} disabled={busy} onChange={e=>setExisting(e.target.value)}><option value="">Selecione um contato autorizado</option>{options.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}</select></CompanyField>:Object.entries({full_name:"Nome do contato",job_title:"Cargo",email:"E-mail do contato",phone:"Telefone do contato"}).map(([key,label])=><CompanyField key={key} label={label}><input required={key==="full_name"} maxLength={key==="full_name"?240:key==="email"?254:key==="phone"?40:160} type={key==="email"?"email":"text"} value={values[key as keyof typeof values]} disabled={busy} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/></CompanyField>))}
   {previous&&!unlink&&<p className="lead-profile-feedback">A edição altera o cadastro deste contato nos locais em que ele estiver vinculado.</p>}{error&&<p className="task-error" role="alert">{error}</p>}
   <div className="task-actions"><button type="button" className="task-button" disabled={busy} onClick={close}>Cancelar</button><button className="task-button task-cyan" disabled={busy}>{busy?"Salvando...":unlink?"Desvincular":mode==="link"&&!previous?"Vincular contato":"Salvar contato"}</button></div>
  </form></DialogContent></Dialog>;
}
