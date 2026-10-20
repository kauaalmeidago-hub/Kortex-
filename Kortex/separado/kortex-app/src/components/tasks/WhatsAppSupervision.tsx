import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessAccess } from "@/features/access/BusinessAccess";

export type WhatsAppSupervisionStatus = {
 id: string; group_name: string; conversations_enabled: boolean; tasks_enabled: boolean;
 tasks_mode?: 'on_request'; tasks_activated_at?: string | null; destinations?: {sector:string;email:string}[];
 participant_policy: string; connection_state: string; phone_suffix: string | null;
 heartbeat_at: string | null; last_event_at: string | null; last_reply_at: string | null;
 received_count: number; reply_count: number; last_error_code: string | null;
};
const time = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR") : "Ainda não recebido";
export default function WhatsAppSupervision() {
 const access=useBusinessAccess(),scope=access.selected("tasks"),client=useQueryClient();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const key=access.key("tasks","koa-whatsapp-status");
 const query=useQuery({queryKey:key,enabled:Boolean(scope?.can_dispatch),retry:false,refetchInterval:15000,
  queryFn:async()=>{const r=await supabase.rpc("koa_whatsapp_status",{p_board:scope!.board_id});if(r.error)throw Error("Não foi possível consultar o WhatsApp.");return r.data as WhatsAppSupervisionStatus|null;}});
 const status=query.data;
 if(!scope?.can_dispatch||!status)return null;
 const online=Boolean(status.heartbeat_at&&Date.now()-Date.parse(status.heartbeat_at)<60000);
 const connected=online&&status.connection_state==="open";
 async function toggle(){setBusy(true);setError("");try{const r=await supabase.rpc("koa_whatsapp_conversations",{p_board:scope!.board_id,p_enabled:!status!.conversations_enabled});if(r.error)throw Error("Não foi possível atualizar as conversas. Atualize e tente novamente.");await client.invalidateQueries({queryKey:key});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function toggleTasks(){setBusy(true);setError("");try{const r=await supabase.rpc("koa_whatsapp_tasks",{p_board:scope!.board_id,p_enabled:!status!.tasks_enabled});if(r.error)throw Error("Não foi possível atualizar a criação de tarefas. Confira os destinos e tente novamente.");await client.invalidateQueries({queryKey:key});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <><button type="button" className="task-button" onClick={()=>setOpen(true)}><MessageCircle size={16}/>WhatsApp / Supervisão</button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
  <DialogTitle>WhatsApp / Supervisão</DialogTitle><DialogDescription>Acompanhe o KOA no grupo autorizado e controle as conversas.</DialogDescription>
  <div className="space-y-4 text-sm">
   <p role="status" className="rounded-xl bg-muted p-3 font-semibold">{connected?"WhatsApp conectado":online?"WhatsApp desconectado":"Serviço local sem atualização recente"}{status.phone_suffix?` · final ${status.phone_suffix}`:""}</p>
   <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2"><dt className="text-muted-foreground">Grupo</dt><dd>{status.group_name}</dd><dt className="text-muted-foreground">Participantes</dt><dd>Todos os membros desse grupo</dd><dt className="text-muted-foreground">Conversas</dt><dd>{status.conversations_enabled?"Habilitadas":"Pausadas"}</dd><dt className="text-muted-foreground">Criação de tarefas</dt><dd>{status.tasks_enabled?"Ativada — somente quando solicitada":"Desativada"}</dd><dt className="text-muted-foreground">Última mensagem</dt><dd>{time(status.last_event_at)}</dd><dt className="text-muted-foreground">Última resposta</dt><dd>{time(status.last_reply_at)}</dd><dt className="text-muted-foreground">Respostas enviadas</dt><dd>{status.reply_count}</dd></dl>
   {Boolean(status.destinations?.length)&&<dl className="space-y-2">{status.destinations!.map(d=><div key={d.sector}><dt className="font-medium">{d.sector==="comercial"?"Comercial":"Relacionamento"}</dt><dd className="break-all text-muted-foreground">{d.email}</dd></div>)}</dl>}
   <p>Chame <strong>KOA</strong> no grupo ou responda a uma mensagem dele. {status.tasks_enabled?"Ele registra pedidos claros de tarefas para Comercial ou Relacionamento. Dúvidas e conversas não geram tarefas.":"Ele conversa e orienta. A criação de tarefas está pausada."} Alterações e conclusões de tarefas continuam na plataforma.</p>
   <p className="text-muted-foreground">O serviço funciona neste computador. Mantenha o computador e o Docker Desktop ligados durante os testes.</p>
   {status.last_error_code&&<p role="alert" className="text-destructive">{status.last_error_code==="SEND_RESULT_UNKNOWN"?"Uma resposta ficou com envio incerto e não será reenviada automaticamente.":"O serviço encontrou uma falha. Consulte novamente antes de repetir o teste."}</p>}
   {(error||query.error)&&<p role="alert" className="text-destructive">{error||query.error?.message}</p>}
   <button type="button" className="task-button" disabled={busy} onClick={()=>void toggle()}>{busy&&<Loader2 className="animate-spin" size={16}/>} {status.conversations_enabled?"Pausar conversas":"Retomar conversas"}</button>
   <button type="button" className="task-button" disabled={busy||(!status.tasks_enabled&&status.destinations?.length!==2)} onClick={()=>void toggleTasks()}>{status.tasks_enabled?"Pausar criação de tarefas":"Ativar criação sob pedido"}</button>
  </div>
 </DialogContent></Dialog></>;
}
