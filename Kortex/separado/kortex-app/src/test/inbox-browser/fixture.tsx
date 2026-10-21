import { useSyncExternalStore } from "react";

type Scope = { workspaceId: string; sectorId: string };
type Message = { id: string; provider_id: string; body: string; kind: string; sent_at: string; from_me: boolean; status_rank: number; media_name?: string; quoted_id?: string };
type Conversation = { case_id: string; case_version: number; can_claim: boolean; can_manage: boolean; can_send: boolean; assigned_to?: string; claimed_by?: string; assignee_name?: string; summary?: string; request_type?: string; sector_name?: string; channel_label?: string; triage_state?: string; id: string; connection_id: string; remote_jid: string; name: string; preview: string; last_message_at: string; unread_count: number; status: "triage" | "active" | "pending" | "resolved" };
type SendCall = { conversationId: string; text: string; fileName?: string; quotedId?: string; scope: string; confirmed: boolean };
type State = { version: number; user: string; scope: string; activeId: string; connected: boolean; failNext: boolean; holdSend: boolean; dataError?: string; calls: SendCall[]; requests: string[]; conversations: Conversation[]; messages: Record<string, Message[]> };

const stamp = (minute: number) => `2026-10-21T18:${minute}:00.000Z`;
const message = (id: string, body: string, minute: number, from_me = false, extra: Partial<Message> = {}): Message => ({ id, provider_id: `provider-${id}`, body, kind: "text", sent_at: stamp(minute), from_me, status_rank: from_me ? 3 : 0, ...extra });
const conversation = (id: string, name: string, minute: number, preview: string, status: Conversation["status"]): Conversation => ({ id, connection_id: "qa-connection", remote_jid: `551190000000${id.slice(-1)}@s.whatsapp.net`, name, preview, last_message_at: stamp(minute), unread_count: 0, status, case_id: `case-${id}`, case_version: 1, can_manage: true, can_claim: status !== "active", can_send: status === "active", claimed_by: status === "active" ? "qa-user-a" : undefined, sector_name: "Relacionamento", channel_label: "Luísa", triage_state: "manual" });
const initialState = (): State => ({
  version: 0, user: "qa-user-a", scope: "qa-context-a", activeId: "qa-conv-1", connected: true, failNext: false, holdSend: false, calls: [], requests: [],
  conversations: [
    conversation("qa-conv-1", "Paulo", 36, "Precisamos de cobertura nacional se possível.", "active"),
    conversation("qa-conv-2", "Thiago", 20, "Não consegui entrar em contato com o responsável.", "pending"),
    conversation("qa-conv-3", "Dpto. Operações VNR", 15, "Sabe o plano que você cotou anteriormente?", "triage"),
    conversation("qa-conv-4", "Fernanda", 10, "Na região de Conselheiro Lafaiete, o atendimento cobre?", "resolved"),
  ],
  messages: {
    "qa-conv-1": [
      message("qa-m1", "Boa tarde, preciso de plano de saúde para minha empresa. Temos 12 funcionários em BH.", 30),
      message("qa-m2", "Boa tarde Paulo! Vou verificar as melhores opções para vocês. O CNAE da empresa é qual?", 32, true),
      message("qa-m3", "É transporte rodoviário de carga, CNAE 4930-2/02.", 34),
      message("qa-m4", "Precisamos de cobertura nacional se possível.", 36),
    ],
    "qa-conv-2": [message("qa-thiago-m1", "Não consegui entrar em contato com o responsável.", 20)],
    "qa-conv-3": [message("qa-vnr-m1", "Sabe o plano que você cotou anteriormente?", 15)],
    "qa-conv-4": [message("qa-fernanda-m1", "Na região de Conselheiro Lafaiete, o atendimento cobre?", 10)],
  },
});
let state = initialState();
const listeners = new Set<() => void>();
const publish = () => { state = { ...state, version: state.version + 1 }; listeners.forEach(listener => listener()); };
const useFixture = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
const scopeSignature = () => JSON.stringify([state.user, state.scope]);

export const localAuthBypass = false;
export const fullModules = false;
export const appEnvironment = "production";
export const environmentKey = "isolated-inbox-browser-test";

export function useAuth() {
  const snapshot = useFixture();
  return { user: { id: snapshot.user }, workspace: { id: snapshot.scope, name: "Equipe de teste" }, loading: false };
}

export function useWhatsAppScope() {
  const snapshot = useFixture();
  const current = { workspace_id: snapshot.scope, sector_id: "qa-sector", workspace_name: "Equipe de teste", sector_name: "Relacionamento" };
  return { current, options: [current], loading: false, error: undefined, scope: { workspaceId: snapshot.scope, sectorId: "qa-sector" }, retry: () => {}, select: () => { throw new Error("O chat de teste não deve selecionar setores."); } };
}

export function useInbox(_scope?: Scope) {
  const snapshot = useFixture();
  return {
    scopeKey: scopeSignature(),
    activeId: snapshot.activeId,
    canSend: snapshot.connected && snapshot.conversations.find(row => row.id === snapshot.activeId)?.can_send,
    dataError: snapshot.dataError,
    connection: { data: { id: "qa-connection", state: snapshot.connected ? "connected" : "disconnected" }, isError: false },
    conversations: { data: snapshot.conversations, isLoading: false },
    rows: snapshot.messages[snapshot.activeId] ?? [],
    messages: { fetchNextPage: async () => {}, hasNextPage: false, isFetching: false, error: undefined },
    select: (id: string) => { state.activeId = id; publish(); },
    refresh: async () => { publish(); },
    send: async (conversationId: string, text: string, file?: File, quotedId?: string) => {
      const call: SendCall = { conversationId, text, fileName: file?.name, quotedId, scope: scopeSignature(), confirmed: false };
      state.calls.push(call); publish();
      await new Promise(resolve => setTimeout(resolve, state.holdSend ? 350 : 30));
      if (state.failNext) { state.failNext = false; publish(); throw new Error("Falha simulada de confirmação."); }
      call.confirmed = true;
      state.messages[conversationId] = [...(state.messages[conversationId] ?? []), message(`qa-sent-${state.calls.length}`, text || file?.name || "", 45, true, { quoted_id: quotedId })];
      publish();
    },
  };
}

export async function waRequest(action: string, options?: { body?: Record<string, unknown>; query?: Record<string, string> }) {
  state.requests.push(action); publish();
  if (action === "case-history") return [];
  if (action === "case-destinations") return [{ userId: "qa-fernando", name: "Fernando", sectorId: "qa-sector", sector: "Comercial", channelId: "qa-connection", channelOwner: "Luísa", connected: true }];
  if (action === "case-action") {
    state.conversations = state.conversations.map(row => row.case_id === options?.body?.caseId ? { ...row,
      status: ({ claim: "active", pending: "pending", resolve: "resolved", triage: "triage", reopen: "triage", transfer: "triage" } as Record<string, Conversation["status"]>)[String(options.body.action)],
      case_version: row.case_version + 1, can_claim: options.body.action !== "claim", can_send: options.body.action === "claim",
      assignee_name: options.body.action === "transfer" ? "Fernando" : "Atendente de teste", summary: String(options.body.summary || row.summary || ""),
    } : row);
    publish(); return { saved: true };
  }
  if (action === "media") return { url: "data:text/plain,Anexo%20isolado%20de%20teste" };
  if (action === "conversation-status") {
    state.conversations = state.conversations.map(row => row.id === options?.body?.conversationId ? { ...row, status: options.body.status as Conversation["status"] } : row);
    publish(); return { ok: true };
  }
  throw new Error(`Transporte externo não permitido no teste: ${action}`);
}

const controls = {
  snapshot: () => ({ calls: state.calls, requests: state.requests, scope: scopeSignature() }),
  reset: () => { state = initialState(); publish(); },
  failNext: () => { state.failNext = true; },
  holdSend: (value: boolean) => { state.holdSend = value; },
  setScope: (scope: string) => { state.scope = scope; publish(); },
  setUser: (user: string) => { state.user = user; publish(); },
  setConnected: (connected: boolean) => { state.connected = connected; publish(); },
  setError: (dataError?: string) => { state.dataError = dataError; publish(); },
  addControls: () => {
    state.messages["qa-conv-1"] = [...state.messages["qa-conv-1"],
      message("qa-link", "Consulte https://example.invalid/proposta para os detalhes.", 37),
      message("qa-document", "", 38, false, { kind: "document", media_name: "proposta-teste.pdf" }),
      message("qa-audio", "", 39, false, { kind: "audio", media_name: "audio-teste.ogg" }),
      message("qa-long", Array(40).fill("Texto longo de teste para limitar a prévia.").join(" "), 40),
    ]; publish();
  },
};
declare global { interface Window { __inboxQa: typeof controls; } }
window.__inboxQa = controls;
