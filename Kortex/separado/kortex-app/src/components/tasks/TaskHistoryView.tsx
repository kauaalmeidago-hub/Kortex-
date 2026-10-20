import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBusinessAccess } from "@/features/access/BusinessAccess";
import { readTaskHistory } from "@/features/tasks/service";
import { formatTaskDate, taskValues, type Task } from "@/features/tasks/model";
import type { TaskDraft, TaskMessage, TaskHistoryRequest } from "@/integrations/supabase/taskTypes";

export default function TaskHistoryView({conversation,request,busy,onResume,onRevise}:{conversation:string;request:TaskHistoryRequest;busy:boolean;onResume:(d:TaskDraft)=>Promise<void>;onRevise:(t:Task,trigger:HTMLElement)=>Promise<void>}){
  const access=useBusinessAccess(),[closed,setClosed]=useState(false),[error,setError]=useState("");
  const records=useQuery({queryKey:[...access.key("tasks","task-history"),conversation,request.kind,...request.ids],queryFn:()=>readTaskHistory(conversation,request),enabled:!closed,retry:false});
  if(closed)return null;
  const run=async(fn:()=>Promise<void>)=>{setError("");try{await fn();setClosed(true);}catch(e){setError((e as Error).message);void records.refetch();}};
  return <section className="task-history-result" aria-label="Consulta solicitada">
    <header><h3>{request.kind==="drafts"?"Rascunhos consultados":request.kind==="tasks"?"Tarefas consultadas":"Mensagens consultadas"}</h3><button className="task-link" onClick={()=>setClosed(true)}>Fechar consulta</button></header>
    {records.isLoading&&<p role="status">Consultando registros autorizados...</p>}
    {(error||records.error)&&<p role="alert">{error||records.error?.message}</p>}
    {records.data?.length===0&&<p>Nenhum registro disponível para esta consulta.</p>}
    {records.data?.map(row=>request.kind==="messages"?<article key={row.id}><p>{(row as TaskMessage).content}</p></article>:request.kind==="drafts"?(()=>{const d=row as TaskDraft,v=taskValues(d.payload as never);return <article key={d.id}><strong>{v.title||"Rascunho a preencher"}</strong><p>{d.confirmed_task_id?"Já encaminhado. Consulte a tarefa existente.":"Pendente de revisão"} · {formatTaskDate(v.due_date)}</p>{!d.confirmed_task_id&&request.intent==="resume"&&<button className="task-button" disabled={busy} onClick={()=>void run(()=>onResume(d))}>Retomar rascunho</button>}</article>;})():(()=>{const t=row as Task;return <article key={t.id}><strong>{t.title}</strong><p>{t.description}</p><small>{formatTaskDate(t.due_date)} · {t.status}</small>{t.can_edit&&<button className="task-button" disabled={busy} onClick={e=>{const trigger=e.currentTarget;void run(()=>onRevise(t,trigger));}}>Revisar alteração</button>}</article>;})())}
  </section>;
}
