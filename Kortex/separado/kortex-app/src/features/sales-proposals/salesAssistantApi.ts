import { supabase } from "@/integrations/supabase/client";
import { parseSalesAnalysis, type SalesAssistantRequest } from "../../../supabase/functions/_shared/salesAssistant";

export interface SalesOpportunity { id: string; title: string; pipeline: string; stage: string }

export async function listSalesOpportunities(workspaceId: string, userId: string): Promise<SalesOpportunity[]> {
  const { data, error } = await supabase.from("leads")
    .select("id,title,pipelines(name),stages(name)")
    .eq("workspace_id", workspaceId)
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .order("updated_at", { ascending: false }).limit(100);
  if (error) throw new Error("Não foi possível carregar suas oportunidades. Tente novamente.");
  return (data ?? []).map(lead => ({ id: lead.id, title: lead.title,
    pipeline: lead.pipelines?.name ?? "Sem funil", stage: lead.stages?.name ?? "Sem etapa" }));
}

const errorMessages: Record<string, string> = {
  SESSION_REQUIRED: "Entre na sua conta para usar a IA comercial.",
  WORKSPACE_FORBIDDEN: "Você não tem acesso a esta equipe.",
  OPPORTUNITY_FORBIDDEN: "Esta oportunidade não está disponível para o seu usuário.",
  AI_NOT_CONFIGURED: "A IA comercial ainda precisa ser ativada pela administração.",
  AUTH_NOT_CONFIGURED: "A autenticação da IA comercial ainda precisa ser configurada.",
  AI_RATE_LIMITED: "A IA está com limite de uso no momento. Tente novamente em instantes.",
  AI_TIMEOUT: "A análise demorou mais que o esperado. Tente novamente.",
  AI_REFUSED: "Não foi possível analisar este pedido. Reformule a orientação.",
  INVALID_REQUEST: "Revise os dados do pedido e tente novamente.",
  REQUEST_TOO_LARGE: "O contexto está muito extenso. Reduza as observações e tente novamente.",
};

export async function askSalesAssistant(input: SalesAssistantRequest, signal?: AbortSignal) {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error(errorMessages.SESSION_REQUIRED);
  const { data, error } = await supabase.functions.invoke("koa-sales-assistant", { body: input, signal });
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  if (error) {
    let code = "AI_UNAVAILABLE";
    if (error.context instanceof Response) {
      try { code = (await error.context.json()).code ?? code; } catch { /* Keep safe fallback. */ }
    }
    throw new Error(errorMessages[code] ?? "Não foi possível consultar a IA comercial. Verifique a conexão e a ativação do serviço.");
  }
  if (data?.conversationId !== input.client.conversationId) throw new Error("A análise não corresponde ao cliente aberto. Solicite novamente.");
  return parseSalesAnalysis(data.analysis);
}
