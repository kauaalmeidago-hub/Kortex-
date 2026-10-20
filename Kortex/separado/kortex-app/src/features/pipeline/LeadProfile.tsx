import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, ClipboardList, FileText, Loader2, MessageSquare, MoreHorizontal, Package, Paperclip, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBusinessAccess } from "@/features/access/BusinessAccess";
import { environmentKey } from "@/features/access/environment";
import { deleteLead, pipelineData, pipelineRecord, type LeadRow } from "./service";
import { leadProfileCatalog, leadProfileDetails, leadProfilePatch, leadProfileValues, saveLeadProfile, type LeadContact, type LeadProfileValues } from "./profile";
import { pipelineReturn } from "./navigation";
import LeadRecordActivity from "./LeadRecordActivity";
import LeadContactDialog from "./LeadContactDialog";
import { CompanyAvatar, CompanyField } from "@/components/companies/CompanyForm";
import { emptyOffering, formatCnpj, parseOfferings, type CompanyContact } from "@/features/companies/model";
import KoaChatComposer from "@/components/KoaChatComposer";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import "@/pages/TasksPage.css";
import "@/pages/CompaniesPage.css";
import "@/pages/PipelineRecordPage.css";

export default function LeadDetailPage(){
 const {leadId=""}=useParams(),[params]=useSearchParams(),{user}=useAuth(),access=useBusinessAccess();
 const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId);
 const record=useQuery({queryKey:[environmentKey,"pipeline-record",user?.id,access.token,leadId],queryFn:({signal})=>pipelineRecord(leadId,signal),enabled:Boolean(valid&&user&&!access.loading&&!access.error),retry:false,refetchInterval:15000});
 const scope=access.contexts.find(c=>c.kind==="pipeline"&&c.pipeline_id===record.data?.lead.pipeline_id&&c.workspace_id===record.data.lead.workspace_id&&c.sector_id===record.data.lead.sector_id);
 useEffect(()=>{if(scope&&access.selected("pipeline")?.board_id!==scope.board_id)access.select(scope);},[access,scope]);
 const back=pipelineReturn(params.get("return"),record.data?.lead.pipeline_id);
 if(access.loading||record.isLoading&&valid)return <div className="tasks-theme lead-profile-page"><p role="status">Carregando registro...</p></div>;
 if(access.error||record.error||!record.data||!scope)return <div className="tasks-theme lead-profile-page"><Link className="task-link" to={back}><ArrowLeft size={17}/>Voltar para pipeline</Link><div className="lead-profile-unavailable" role="alert"><Building2 size={36}/><h1>Registro indisponível para esta conta.</h1>{(access.error||record.error)&&<><p>{access.error||record.error?.message}</p><button className="task-button" onClick={()=>{void access.retry();void record.refetch();}}>Tentar novamente</button></>}</div></div>;
 return <LeadProfile key={`${user!.id}:${scope.board_id}:${leadId}`} scope={scope} lead={record.data.lead} primaryContact={record.data.contact} companyId={record.data.companyId} userId={user!.id} back={back}/>;
}

function LeadProfile({scope,lead,primaryContact,companyId,userId,back}:{scope:BusinessContext;lead:LeadRow;primaryContact:CompanyContact|null;companyId:string|null;userId:string;back:string}){
 const access=useBusinessAccess(),client=useQueryClient(),navigate=useNavigate(),catalogId=useId();
 const details=useQuery({queryKey:[environmentKey,"lead-profile-details",userId,access.token,lead.id,companyId,lead.contact_id],queryFn:({signal})=>leadProfileDetails(scope,lead,companyId,signal),retry:false,refetchInterval:15000});
 const catalog=useQuery({queryKey:[...access.key("pipeline","lead-profile-catalog"),lead.id],queryFn:({signal})=>leadProfileCatalog(scope,signal),retry:false});
 const board=useQuery({queryKey:access.key("pipeline","pipeline-data"),queryFn:({signal})=>pipelineData(scope,signal),retry:false});
 const initial=leadProfileValues(lead,primaryContact,details.data?.company);
 const [baseline,setBaseline]=useState(initial),[values,setValues]=useState(initial),[version,setVersion]=useState(lead);
 const dirty=Object.keys(leadProfilePatch(baseline,values)).length>0;
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");const lock=useRef(false);
 const [tab,setTab]=useState<"conversation"|"notes"|"files">("conversation"),[history,setHistory]=useState(false);
 const [selectedContact,setSelectedContact]=useState(lead.contact_id??""),[chatDrafts,setChatDrafts]=useState<Record<string,string>>({});
 const [contactEditor,setContactEditor]=useState<LeadContact|null|undefined>(),[unlink,setUnlink]=useState(false),[removing,setRemoving]=useState(false),[deleting,setDeleting]=useState(false);
 useUnsavedChanges(dirty||Object.values(chatDrafts).some(Boolean));
 useEffect(()=>{if(!dirty&&!busy){const next=leadProfileValues(lead,primaryContact,details.data?.company);setBaseline(next);setValues(next);setVersion(lead);}},[lead,primaryContact,details.data?.company,dirty,busy]);
 const refresh=async()=>{await Promise.all([client.invalidateQueries({predicate:q=>["pipeline-record","pipeline-data","lead-profile-details","lead-profile-catalog"].includes(String(q.queryKey[1]))}),access.retry()]);};
 const change=<K extends keyof LeadProfileValues>(key:K,value:LeadProfileValues[K])=>{setNotice("");setValues(v=>({...v,[key]:value}));};
 const selected=details.data?.contacts.find(c=>c.id===selectedContact),readOnly=!lead.can_edit,disabled=readOnly||busy,company=details.data?.company;
 const field=(key:"title"|"phone"|"email"|"project"|"city",label:string,placeholder:string,maxLength:number,type="text")=><CompanyField label={label}><input name={key} value={values[key]} placeholder={placeholder} maxLength={maxLength} required={key==="title"} type={type} readOnly={readOnly} disabled={busy} onChange={e=>change(key,e.target.value)}/></CompanyField>;
 const titles=[{id:"conversation",label:"Conversa",Icon:MessageSquare},{id:"notes",label:"Notas",Icon:FileText},{id:"files",label:"Arquivos",Icon:Paperclip}] as const;
 return <div className="tasks-theme companies-theme lead-profile-page">
  <div className="lead-profile-top"><Link className="lead-profile-back" to={back} aria-label="Voltar para pipeline" title="Voltar para pipeline"><ArrowLeft size={19}/></Link><DropdownMenu><DropdownMenuTrigger asChild><button className="company-icon-button" aria-label="Ações do registro"><MoreHorizontal size={19}/></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={()=>{setTab("notes");setHistory(true);}}>Histórico do registro</DropdownMenuItem>{lead.can_edit&&<DropdownMenuItem onSelect={()=>setRemoving(true)}><Trash2 size={15}/>Excluir registro</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></div>
  <div className="lead-profile-layout">
   <aside className="lead-profile-sidebar"><CompanyAvatar name={lead.title} size="profile"/><h1>{lead.title}</h1>
    <dl className="lead-profile-context"><div><Building2 size={17}/><dt>Setor</dt><dd>{scope.sector_name}</dd></div><div><ClipboardList size={17}/><dt>Pipeline</dt><dd>{scope.board_name}</dd></div><div><FileText size={17}/><dt>Valor estimado</dt><dd>{lead.value==null?"Não informado":new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(lead.value)}</dd></div></dl>
    <section className="lead-profile-contacts" aria-label="Contatos do lead"><header><h2>Contatos do lead</h2><button className="company-link" disabled={readOnly} onClick={()=>{setUnlink(false);setContactEditor(null);}}>Adicionar contato</button></header>
     {details.isLoading?<p role="status">Carregando contatos...</p>:details.error?<div role="alert"><p>{details.error.message}</p><button className="task-link" onClick={()=>void details.refetch()}>Tentar novamente</button></div>:!details.data?.contacts.length?<p>Nenhum contato vinculado.</p>:details.data.contacts.map(contact=><article key={contact.id}>
      <button className="lead-profile-contact" aria-pressed={selectedContact===contact.id} onClick={()=>setSelectedContact(contact.id)}><CompanyAvatar name={contact.full_name}/><span><strong>{contact.full_name}</strong><small>{contact.job_title||contact.phone||contact.email||"Contato"}</small></span></button>
      {lead.can_edit&&<DropdownMenu><DropdownMenuTrigger asChild><button className="company-icon-button" aria-label={`Ações de ${contact.full_name}`}><MoreHorizontal size={18}/></button></DropdownMenuTrigger><DropdownMenuContent align="end">{contact.can_edit&&<DropdownMenuItem onSelect={()=>{setUnlink(false);setContactEditor(contact);}}><Pencil size={15}/>Editar contato</DropdownMenuItem>}{(contact.linked||contact.primary)&&<DropdownMenuItem onSelect={()=>{setUnlink(true);setContactEditor(contact);}}><Trash2 size={15}/>Desvincular do lead</DropdownMenuItem>}{!contact.can_edit&&!contact.linked&&!contact.primary&&<DropdownMenuItem disabled>Contato da empresa · Somente leitura</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>}
     </article>)}
    </section>
   </aside>
   <div className="lead-profile-main">
    <form className="lead-profile-form" onSubmit={async e=>{e.preventDefault();if(lock.current||readOnly)return;lock.current=true;setBusy(true);setError("");setNotice("");const token=access.token;
     try{const saved=await saveLeadProfile(scope,version,baseline,values);if(access.isCurrent(token)){const next=leadProfileValues(saved,primaryContact,details.data?.company);setBaseline(next);setValues(next);setVersion(saved);setNotice("Alterações salvas.");await refresh();}}
     catch(err){if(access.isCurrent(token))setError((err as Error).message);}finally{lock.current=false;setBusy(false);}}}>
     {details.isLoading&&<p role="status" className="lead-profile-feedback">Carregando vínculos autorizados...</p>}
     <div className="lead-profile-fields">
      {field("title","Nome do cliente *","Informe o nome do cliente",240)}{field("phone","Telefone","Informe o telefone",40,"tel")}{field("email","E-mail","Informe o e-mail",254,"email")}
      <CompanyField label="Empresa"><select aria-label="Empresa" value={values.company_id} disabled={disabled||!catalog.data} onChange={e=>change("company_id",e.target.value)}><option value="" disabled={!lead.company_id&&Boolean(company?.id)}>Sem empresa vinculada</option>{values.company_id&&!catalog.data?.companies.some(c=>c.id===values.company_id)&&<option value={values.company_id}>{company?.name??"Empresa vinculada indisponível"}</option>}{catalog.data?.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>{!lead.company_id&&company?.id&&<small>Empresa vinculada pelo contato principal.</small>}</CompanyField>
      {field("project","Projeto","Informe o projeto",160)}
      <CompanyField label="Responsável"><select aria-label="Responsável" value={lead.assigned_to??""} disabled aria-describedby="lead-assignee-policy"><option value="">Sem responsável</option>{lead.assigned_to&&!details.data?.people.some(p=>p.user_id===lead.assigned_to)&&<option value={lead.assigned_to}>{lead.assignee?.full_name||(lead.assigned_to===userId?"Você":"Responsável indisponível")}</option>}{details.data?.people.map(p=><option key={p.user_id} value={p.user_id}>{p.full_name||p.email}</option>)}</select><small id="lead-assignee-policy">Definido pelo vínculo autorizado do registro.</small></CompanyField>
      <div className="lead-profile-city">{field("city","Cidade","Informe a cidade",160)}</div>
     </div>
     {catalog.error&&<div className="lead-profile-feedback" role="alert"><p>{catalog.error.message}</p><button type="button" className="task-link" onClick={()=>void catalog.refetch()}>Recarregar vínculos</button></div>}
     <details className="company-form-section"><summary><FileText size={20}/>Informações complementares</summary><div className="lead-profile-complement">
      <CompanyField label="Descrição"><textarea rows={3} value={values.description} maxLength={16000} disabled={disabled} onChange={e=>change("description",e.target.value)} placeholder="Informações sobre o registro"/></CompanyField>
      <CompanyField label="Etapa"><select value={values.stage_id} disabled={disabled||!board.data} onChange={e=>change("stage_id",e.target.value)}>{!board.data&&<option value={values.stage_id}>Carregando etapa...</option>}{board.data?.stages.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></CompanyField>
      <CompanyField label="Valor estimado"><input type="number" min="0" step="0.01" placeholder="Não informado" value={values.value} disabled={disabled} onChange={e=>change("value",e.target.value)}/></CompanyField>
      <CompanyField label="Previsão"><input type="date" value={values.expected_close_date} disabled={disabled} onChange={e=>change("expected_close_date",e.target.value)}/></CompanyField>
      <CompanyField label="Situação"><select value={values.status} disabled={disabled} onChange={e=>change("status",e.target.value as LeadRow["status"])}>{Object.entries({new:"Novo",qualified:"Qualificado",proposal:"Proposta",negotiation:"Negociação",won:"Ganho",lost:"Perdido"}).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></CompanyField>
      <CompanyField label="CNPJ da empresa"><input readOnly value={formatCnpj(company?.cnpj)} placeholder="Não informado"/></CompanyField>
     </div></details>
     <details className="company-form-section"><summary><Package size={20}/>Produtos e operadoras</summary><div className="lead-profile-offerings">
      <datalist id={`${catalogId}-products`}>{[...new Set(catalog.data?.companies.flatMap(c=>parseOfferings(c.offerings).map(o=>o.product))??[])].map(p=><option key={p} value={p}/>)}</datalist><datalist id={`${catalogId}-operators`}>{[...new Set(catalog.data?.companies.flatMap(c=>parseOfferings(c.offerings).map(o=>o.operator))??[])].map(p=><option key={p} value={p}/>)}</datalist>
      {!values.offerings.length&&<p>Nenhum produto ou operadora informado.</p>}{values.offerings.map((offering,index)=><div key={index} className="lead-profile-offering"><CompanyField label={`Produto ${index+1}`}><input maxLength={120} list={`${catalogId}-products`} value={offering.product} disabled={disabled} placeholder="Informe o produto" onChange={e=>change("offerings",values.offerings.map((o,i)=>i===index?{...o,product:e.target.value}:o))}/></CompanyField><CompanyField label={`Operadora ${index+1}`}><input maxLength={120} list={`${catalogId}-operators`} value={offering.operator} disabled={disabled} placeholder="Informe a operadora" onChange={e=>change("offerings",values.offerings.map((o,i)=>i===index?{...o,operator:e.target.value}:o))}/></CompanyField><button type="button" className="company-icon-button" aria-label={`Remover produto ${index+1}`} disabled={disabled} onClick={()=>change("offerings",values.offerings.filter((_,i)=>i!==index))}><Trash2 size={17}/></button></div>)}
      <button type="button" className="task-link" disabled={disabled||values.offerings.length>=30} onClick={()=>change("offerings",[...values.offerings,emptyOffering()])}><Plus size={16}/>Adicionar produto e operadora</button>
     </div></details>
     {error&&<p role="alert" className="task-error lead-profile-feedback">{error}</p>}{dirty&&version.updated_at!==lead.updated_at&&<p role="alert" className="lead-profile-feedback">Este registro foi atualizado. Seu rascunho foi preservado; recarregue e revise antes de salvar.</p>}
     {(error||dirty&&version.updated_at!==lead.updated_at)&&<button type="button" className="task-link" onClick={()=>{if(dirty&&!window.confirm("Descartar alterações locais e carregar a versão atual?"))return;const next=leadProfileValues(lead,primaryContact,details.data?.company);setValues(next);setBaseline(next);setVersion(lead);setError("");void refresh();}}>Recarregar versão atual</button>}
     <footer><p role="status">{notice|| (readOnly?"Somente leitura":"")}</p><button className="task-button task-cyan" disabled={disabled||!dirty}>{busy?<Loader2 size={17} className="animate-spin"/>:<Save size={17}/>} {busy?"Salvando...":"Salvar alterações"}</button></footer>
    </form>
    <section className="lead-profile-activity">
     <div className="lead-profile-tabs" role="tablist" aria-label="Atividades do lead">{titles.map(({id,label,Icon})=><button key={id} id={`lead-tab-${id}`} role="tab" aria-selected={tab===id} aria-controls={`lead-panel-${id}`} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)} onKeyDown={e=>{if(e.key==="ArrowRight"||e.key==="ArrowLeft"){e.preventDefault();const next=titles[(titles.findIndex(t=>t.id===tab)+(e.key==="ArrowRight"?1:2))%3].id;setTab(next);document.getElementById(`lead-tab-${next}`)?.focus();}}}><Icon size={20}/>{label}</button>)}</div>
     <div id="lead-panel-conversation" role="tabpanel" aria-labelledby="lead-tab-conversation" hidden={tab!=="conversation"}><div className="lead-profile-conversation-empty"><MessageSquare size={48} strokeWidth={1.2}/><p>{selected?`O canal de conversa de ${selected.full_name} ainda não está conectado.`:"Selecione um contato para conversar."}</p></div><KoaChatComposer multiline value={chatDrafts[selected?.id??""]??""} inputLabel={selected?`Mensagem para ${selected.full_name}`:"Mensagem para o contato"} onChange={text=>setChatDrafts(d=>({...d,[selected?.id??""]:text}))} onSubmit={()=>{}} disabled attachmentDisabled attachmentTitle="Disponível quando o canal do contato estiver conectado"/><p className="lead-profile-chat-help">Envio indisponível até selecionar um contato com canal conectado.</p></div>
     <div id="lead-panel-notes" role="tabpanel" aria-labelledby="lead-tab-notes" hidden={tab!=="notes"}><LeadRecordActivity scope={scope} lead={lead} userId={userId} tab="notes" authorNames={Object.fromEntries((details.data?.people??[]).map(p=>[p.user_id,p.full_name||p.email]))} active={tab==="notes"}/><details open={history} onToggle={e=>setHistory(e.currentTarget.open)} className="lead-profile-history"><summary>Histórico do registro</summary><LeadRecordActivity scope={scope} lead={lead} userId={userId} tab="activities" active={history&&tab==="notes"}/></details></div>
     <div id="lead-panel-files" role="tabpanel" aria-labelledby="lead-tab-files" hidden={tab!=="files"}><LeadRecordActivity scope={scope} lead={lead} userId={userId} tab="files" active={tab==="files"}/></div>
    </section>
   </div>
  </div>
  {contactEditor!==undefined&&<LeadContactDialog key={contactEditor?.id??"new"} lead={lead} previous={contactEditor} unlink={unlink} options={catalog.data?.contacts??[]} onClose={()=>setContactEditor(undefined)} onSaved={()=>void refresh()}/>}
  <AlertDialog open={removing} onOpenChange={v=>{if(!deleting)setRemoving(v);}}><AlertDialogContent className="tasks-theme"><AlertDialogHeader><AlertDialogTitle>Excluir este registro?</AlertDialogTitle><AlertDialogDescription>Remove o registro e seus vínculos próprios. Empresas e contatos são preservados.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={deleting} onClick={async e=>{e.preventDefault();if(lock.current)return;lock.current=true;setDeleting(true);try{await deleteLead(scope,lead);await refresh();navigate(back);}catch(err){setError((err as Error).message);setRemoving(false);}finally{lock.current=false;setDeleting(false);}}}>{deleting?"Excluindo...":"Excluir"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </div>;
}
