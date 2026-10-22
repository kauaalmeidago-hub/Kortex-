// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createSalesAssistantHandler, parseSalesRequest, SalesAssistantError } from "../../../supabase/functions/_shared/salesAssistant";
import { createSalesDraft, type SalesClient } from "./salesProposal";

const client: SalesClient = { conversationId: "a", name: "Cliente A", company: "Empresa A", city: "BH", state: "MG",
  messages: [{ id: "m1", text: "Preciso de uma proposta", fromMe: false }] };
const input = { workspaceId: "12345678-1234-1234-1234-123456789abc", client, draft: createSalesDraft(client), action: "analyze", question: "" };
const analysis = { summary: "Cliente A", missingInformation: ["Idades"], salesApproach: "Confirmar idades", suggestedMessage: "Quais são as idades?", proposalOutline: "Aguardar cotação" };
const post = (body: unknown = input, authenticated = true) => new Request("https://example.test/assistant", { method: "POST",
  headers: authenticated ? { Authorization: "Bearer user-session" } : {}, body: JSON.stringify(body) });

describe("backend do KOA Comercial", () => {
  it("exige sessão antes de chamar a IA", async () => {
    const authorize = vi.fn(); const generate = vi.fn();
    const response = await createSalesAssistantHandler({ authorize, generate })(post(input, false));
    expect(response.status).toBe(401);
    expect(authorize).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("não chama a IA quando a equipe ou oportunidade não está autorizada", async () => {
    const generate = vi.fn();
    const response = await createSalesAssistantHandler({
      authorize: async () => { throw new SalesAssistantError(403, "WORKSPACE_FORBIDDEN"); }, generate,
    })(post());
    expect(response.status).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });

  it("envia apenas os campos permitidos do cliente atual", async () => {
    const parsed = parseSalesRequest({ ...input, secret: "not-forwarded", client: { ...client, password: "not-forwarded" } });
    expect(parsed).not.toHaveProperty("secret");
    expect(parsed.client).not.toHaveProperty("password");
    const generate = vi.fn().mockResolvedValue(analysis);
    const response = await createSalesAssistantHandler({ authorize: async () => ({ title: "Negócio A" }), generate })(post());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversationId: "a", analysis });
    expect(generate.mock.calls[0][0].client.messages).toEqual(client.messages);
    expect(generate.mock.calls[0][1]).toEqual({ title: "Negócio A" });
  });

  it("rejeita contexto fora dos limites antes de autorizar ou gerar", async () => {
    const authorize = vi.fn(); const generate = vi.fn();
    const handler = createSalesAssistantHandler({ authorize, generate });
    expect((await handler(post({ ...input, client: { ...client, messages: [{ id: "a", text: "x".repeat(1501), fromMe: false }] } }))).status).toBe(400);
    expect((await handler(post("x".repeat(65001)))).status).toBe(413);
    expect(authorize).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("não retorna resposta parcial nem detalhes internos do provedor", async () => {
    const handler = createSalesAssistantHandler({ authorize: async () => null,
      generate: async () => ({ ...analysis, internalSecret: "never-return" }) });
    const response = await handler(post());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("never-return");
  });
});
