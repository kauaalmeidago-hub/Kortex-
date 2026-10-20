import { supabase } from "@/integrations/supabase/client";
import { taskFailure } from "./service";
export type TaskAiConnection = {
  configured: boolean;
  model: string | null;
  updated_at: string | null;
};
export async function taskAiStatus(
  workspace: string,
): Promise<TaskAiConnection> {
  const result = await supabase.rpc("task_ai_status", {
    p_workspace: workspace,
  });
  if (result.error) taskFailure(result.error);
  return result.data as TaskAiConnection;
}
async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("task-ai", { body });
  if (error) {
    // The function returns only sanitized messages, never upstream provider errors.
    const response =
      error.context instanceof Response
        ? await error.context.json().catch(() => null)
        : null;
    throw new Error(
      response?.message ||
        "Não foi possível acessar a conexão OpenAI. Confira sua sessão e tente novamente.",
    );
  }
  return data;
}
export async function connectTaskAi(
  workspace: string,
  apiKey: string,
  model: string,
) {
  return (
    await invoke({
      action: "connect",
      workspace_id: workspace,
      api_key: apiKey,
      model,
    })
  ).connection as TaskAiConnection;
}
export async function disconnectTaskAi(workspace: string) {
  return (await invoke({ action: "disconnect", workspace_id: workspace }))
    .connection as TaskAiConnection;
}
export async function interpretTaskMessage(messageId: string) {
  return (await invoke({ action: "interpret", message_id: messageId })) as {
    draft_ids: string[];
    reused: boolean;
  };
}
