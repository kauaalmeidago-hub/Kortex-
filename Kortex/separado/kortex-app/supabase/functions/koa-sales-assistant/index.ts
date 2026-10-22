import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  createSalesAssistantHandler, SalesAssistantError, SALES_ANALYSIS_SCHEMA, SALES_SYSTEM_PROMPT,
} from "../_shared/salesAssistant.ts";

Deno.serve(createSalesAssistantHandler({
  async authorize(authorization, input) {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !key) throw new SalesAssistantError(503, "AUTH_NOT_CONFIGURED");
    // Caller-scoped client; no administrative key and no RLS bypass.
    const db = createClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: identity, error: authError } = await db.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
    if (authError || !identity.user) throw new SalesAssistantError(401, "SESSION_REQUIRED");
    const { data: membership, error } = await db.from("workspace_members").select("role")
      .eq("workspace_id", input.workspaceId).eq("user_id", identity.user.id).maybeSingle();
    if (error || !membership) throw new SalesAssistantError(403, "WORKSPACE_FORBIDDEN");
    if (!input.draft.leadId) return null;
    const { data: lead, error: leadError } = await db.from("leads")
      .select("id,title,description,workspace_id,assigned_to,created_by,pipelines(name),stages(name)")
      .eq("id", input.draft.leadId).eq("workspace_id", input.workspaceId).maybeSingle();
    if (leadError || !lead || (membership.role !== "admin" &&
        lead.assigned_to !== identity.user.id && lead.created_by !== identity.user.id)) {
      throw new SalesAssistantError(403, "OPPORTUNITY_FORBIDDEN");
    }
    return { id: lead.id, title: lead.title, description: lead.description, pipeline: lead.pipelines, stage: lead.stages };
  },
  async generate(input, opportunity, signal) {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const model = Deno.env.get("OPENAI_SALES_MODEL");
    if (!apiKey || !model) throw new SalesAssistantError(503, "AI_NOT_CONFIGURED");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, store: false, max_output_tokens: 4000,
        instructions: SALES_SYSTEM_PROMPT,
        input: JSON.stringify({ today: new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" }).format(new Date()),
          action: input.action, question: input.question, client: input.client,
          draft: input.draft, opportunity }),
        text: { format: { type: "json_schema", name: "koa_sales_analysis", strict: true, schema: SALES_ANALYSIS_SCHEMA } },
      }),
    });
    if (response.status === 429) throw new SalesAssistantError(429, "AI_RATE_LIMITED");
    if (!response.ok) throw new SalesAssistantError(502, "AI_UNAVAILABLE");
    const result = await response.json();
    if (result.status !== "completed") throw new SalesAssistantError(502, "AI_INCOMPLETE");
    const content = (result.output ?? []).flatMap((item: { content?: Array<{ type: string; text?: string }> }) => item.content ?? []);
    if (content.some((item: { type: string }) => item.type === "refusal")) throw new SalesAssistantError(422, "AI_REFUSED");
    const text = content.filter((item: { type: string }) => item.type === "output_text")
      .map((item: { text?: string }) => item.text ?? "").join("");
    return JSON.parse(text);
  },
}));
