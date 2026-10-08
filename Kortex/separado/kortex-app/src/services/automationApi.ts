import { supabase } from "@/integrations/supabase/client";
import { createOperationFallbackMonitor, type OperationConnectionState } from "./operationMonitoring";

export type AutomationOperationType =
  | "CARD_ISSUE"
  | "INCLUSION_HOLDER"
  | "INCLUSION_DEPENDENT"
  | "EXCLUSION_HOLDER"
  | "EXCLUSION_DEPENDENT";

export type AutomationOperationStatus =
  | "queued"
  | "starting"
  | "authenticating"
  | "accessing_portal"
  | "checking_active_users"
  | "checking_cns"
  | "checking_cpf"
  | "awaiting_authentication"
  | "awaiting_human_verification"
  | "generating_cpf_document"
  | "validating_documents"
  | "opening_inclusion"
  | "filling_registration"
  | "selecting_plan"
  | "uploading_documents"
  | "filling_health_questionnaire"
  | "processing"
  | "awaiting_confirmation"
  | "submitting"
  | "checking_movement_status"
  | "capturing_evidence"
  | "submission_confirmed"
  | "verifying"
  | "success"
  | "error"
  | "cancelling"
  | "cancelled"
  | "manual_review";

export interface AutomationOperationResponse {
  operationId: string;
  status: AutomationOperationStatus;
  type: AutomationOperationType;
  companyId: string;
  portal: "hapvida" | "ndi";
  currentStep?: string;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    safeDetails?: string;
    retryable?: boolean;
  };
  artifacts: Array<{
    id: string;
    fileName: string;
    mimeType?: string;
    kind: string;
    createdAt: string;
    url: string;
  }>;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface AutomationEvent {
  id?: number | string;
  operationId: string;
  type: string;
  status?: AutomationOperationStatus;
  step?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

type SupabaseOperationRow = {
  id: string;
  operation_type: AutomationOperationType;
  status: AutomationOperationStatus;
  company_id: string;
  operator: "hapvida" | "ndi";
  result: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  current_step: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

type SupabaseArtifactRow = {
  id: string;
  type: string;
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  created_at: string;
};

type SupabaseEventRow = {
  id: string;
  operation_id: string;
  event_type: string;
  step: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type SupabaseQueryResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

type SupabaseChannelLike = {
  on: (type: string, filter: Record<string, unknown>, callback: (payload: { new: Record<string, unknown> }) => void) => SupabaseChannelLike;
  subscribe: (callback?: (status: string) => void) => SupabaseChannelLike;
};

type SupabaseAny = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    select: (columns?: string) => {
      eq: (column: string, value: string) => unknown;
    };
  };
  channel: (topic: string) => SupabaseChannelLike;
  removeChannel: (channel: unknown) => Promise<unknown>;
};

const supabaseClient = supabase as unknown as SupabaseAny;
const explicitProvider = import.meta.env.VITE_AUTOMATION_PROVIDER as "local" | "supabase" | undefined;
const configuredLocalUrl = import.meta.env.VITE_AUTOMATION_API_URL as string | undefined;
const useLocalApi = explicitProvider === "local" || (!explicitProvider && Boolean(configuredLocalUrl));
const automationBaseUrl = configuredLocalUrl ?? "";
const automationToken = import.meta.env.VITE_AUTOMATION_API_TOKEN as string | undefined;

function hasSensitiveKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasSensitiveKey);

  return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
    if (/(password|senha|pass|pwd|authorization|cookie|token|storageState|secret|accessToken|refreshToken|rawCredential)/i.test(key)) {
      return true;
    }
    return hasSensitiveKey(item);
  });
}

function assertSafePayload(input: Record<string, unknown>) {
  if (hasSensitiveKey(input)) {
    throw new Error("O payload da automação contém chave sensível e foi bloqueado antes do envio.");
  }
}

async function sessionToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Não consegui verificar sua sessão do Kortex. Tente novamente.");
  if (!data.session?.access_token) {
    throw new Error("Entre no Kortex para enviar o pedido. Use o login do Kortex; a senha da Hapvida será solicitada somente durante a emissão.");
  }
  return data.session.access_token;
}

let sessionRefresh: Promise<string> | undefined;
function refreshSessionToken() {
  if (!sessionRefresh) {
    sessionRefresh = (async () => {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session?.access_token) {
        throw new Error("Não foi possível renovar sua sessão do Kortex. Entre novamente no Kortex para continuar.");
      }
      return data.session.access_token;
    })().finally(() => { sessionRefresh = undefined; });
  }
  return sessionRefresh;
}

async function headers() {
  const result: HeadersInit = {
    "content-type": "application/json",
  };

  if (automationToken) {
    result["x-koa-automation-token"] = automationToken;
  } else {
    result.authorization = `Bearer ${await sessionToken()}`;
  }

  return result;
}

async function authTokenForSse() {
  if (automationToken) return automationToken;
  return sessionToken();
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (response.status === 401) throw new Error("Sua sessão do Kortex não foi aceita pelo worker. Entre novamente no Kortex; se continuar, confira se aplicativo e worker usam o mesmo projeto Supabase.");
    throw new Error(data?.message ?? data?.error ?? "Falha na API de automacao.");
  }
  return data as T;
}

async function workerFetch(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch {
    throw new Error("Não consegui conectar ao Koa Worker deste computador. Inicie o worker e tente novamente.");
  } finally {
    clearTimeout(timer);
  }
}

async function localFetch(url: string, options: RequestInit) {
  const response = await workerFetch(url, options);
  if (response.status !== 401 || automationToken) return response;
  // The worker rejects 401 requests in onRequest, before creating an operation or accepting a password.
  // Retry only that rejection, once. Never repeat a POST after an uncertain network/server failure.
  const requestHeaders = new Headers(options.headers);
  requestHeaders.set("authorization", `Bearer ${await refreshSessionToken()}`);
  return workerFetch(url, { ...options, headers: requestHeaders });
}

function assertOnlineOperationAllowed(type: AutomationOperationType) {
  if (type !== "CARD_ISSUE" && type !== "EXCLUSION_HOLDER" && type !== "INCLUSION_HOLDER") {
    throw new Error("Essa movimentação ainda não está liberada para automação real.");
  }
}

function createOperationRpcName(type: AutomationOperationType) {
  if (type === "CARD_ISSUE") return "create_koa_card_issue_operation";
  if (type === "INCLUSION_HOLDER") return "create_koa_inclusion_holder_preview_operation";
  if (type === "EXCLUSION_HOLDER") return "create_koa_exclusion_holder_preview_operation";
  throw new Error("Essa movimentação ainda não está liberada para automação real.");
}

async function signedArtifactUrl(artifact: SupabaseArtifactRow) {
  const { data, error } = await supabase.storage.from(artifact.bucket).createSignedUrl(artifact.storage_path, 5 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Não foi possível criar a URL temporária do arquivo.");
  }
  return data.signedUrl;
}

async function loadArtifacts(operationId: string) {
  const query = supabaseClient
    .from("automation_artifacts")
    .select("id,type,bucket,storage_path,file_name,mime_type,created_at")
    .eq("operation_id", operationId) as SupabaseQueryResult<SupabaseArtifactRow[]>;

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function mapSupabaseOperation(row: SupabaseOperationRow, artifacts?: SupabaseArtifactRow[]): Promise<AutomationOperationResponse> {
  const artifactRows = artifacts ?? (await loadArtifacts(row.id));
  const mappedArtifacts = await Promise.all(
    artifactRows.map(async (artifact) => ({
      id: artifact.id,
      fileName: artifact.file_name,
      mimeType: artifact.mime_type ?? undefined,
      kind: artifact.type,
      createdAt: artifact.created_at,
      url: "",
    })),
  );

  return {
    operationId: row.id,
    status: row.status,
    type: row.operation_type,
    companyId: row.company_id,
    portal: row.operator,
    currentStep: row.current_step ?? undefined,
    result: row.result ?? undefined,
    error: row.error_code
      ? {
          code: row.error_code,
          message: row.error_message ?? "Não foi possível concluir a movimentação.",
        }
      : undefined,
    artifacts: mappedArtifacts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? undefined,
  };
}

async function createLocalOperation(input: {
  type: AutomationOperationType;
  workspaceId?: string;
  companyId: string;
  requestedBy?: string;
  portal?: "hapvida" | "ndi";
  operator?: "hapvida" | "ndi";
  data: Record<string, unknown>;
}) {
  if (!automationBaseUrl) throw new Error("VITE_AUTOMATION_API_URL e obrigatorio quando VITE_AUTOMATION_PROVIDER=local.");

  const response = await localFetch(`${automationBaseUrl}/api/operations`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({
      type: input.type,
      workspaceId: input.workspaceId,
      companyId: input.companyId,
      requestedBy: input.requestedBy,
      portal: input.portal ?? "hapvida",
      operator: input.operator ?? "hapvida",
      input: input.data,
    }),
  });

  return parseResponse<AutomationOperationResponse>(response);
}

export async function createOperation(input: {
  type: AutomationOperationType;
  workspaceId?: string;
  companyId: string;
  requestedBy?: string;
  portal?: "hapvida" | "ndi";
  operator?: "hapvida" | "ndi";
  data: Record<string, unknown>;
}) {
  assertSafePayload(input.data);

  if (useLocalApi) return createLocalOperation(input);

  assertOnlineOperationAllowed(input.type);
  if (!input.workspaceId) throw new Error("Workspace ativo é obrigatório para criar operação online.");

  const { data, error } = await supabaseClient.rpc(createOperationRpcName(input.type), {
    _workspace_id: input.workspaceId,
    _company_id: input.companyId,
    _operator: input.operator ?? input.portal ?? "hapvida",
    _payload: input.data,
  });

  if (error) throw new Error(error.message);
  return mapSupabaseOperation(data as SupabaseOperationRow, []);
}

export async function getOperation(operationId: string) {
  if (useLocalApi) {
    if (!automationBaseUrl) throw new Error("VITE_AUTOMATION_API_URL e obrigatorio quando VITE_AUTOMATION_PROVIDER=local.");
    const response = await localFetch(`${automationBaseUrl}/api/operations/${operationId}`, {
      headers: await headers(),
    });
    return parseResponse<AutomationOperationResponse>(response);
  }

  const query = supabaseClient
    .from("automation_operations")
    .select("id,operation_type,status,company_id,operator,result,error_code,error_message,current_step,created_at,updated_at,finished_at")
    .eq("id", operationId) as SupabaseQueryResult<SupabaseOperationRow[]>;

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) throw new Error("operation_not_found");

  return mapSupabaseOperation(row);
}

export async function cancelOperation(operationId: string) {
  if (useLocalApi) {
    if (!automationBaseUrl) throw new Error("VITE_AUTOMATION_API_URL e obrigatorio quando VITE_AUTOMATION_PROVIDER=local.");
    const response = await localFetch(`${automationBaseUrl}/api/operations/${operationId}/cancel`, {
      method: "POST",
      headers: await headers(),
    });
    return parseResponse<AutomationOperationResponse>(response);
  }

  const { data, error } = await supabaseClient.rpc("request_koa_operation_cancel", {
    _operation_id: operationId,
  });

  if (error) throw new Error(error.message);
  return mapSupabaseOperation(data as SupabaseOperationRow);
}

export async function submitOperationAuthentication(input: {
  operationId: string;
  companyCode?: string;
  password: string;
  rememberOnDevice: boolean;
}) {
  if (!useLocalApi) {
    throw new Error("A reautenticação segura precisa ser enviada diretamente ao Koa Worker local.");
  }

  if (!automationBaseUrl) throw new Error("VITE_AUTOMATION_API_URL e obrigatorio quando VITE_AUTOMATION_PROVIDER=local.");

  const body: { companyCode?: string; password: string; rememberOnDevice: boolean } = {
    password: input.password,
    rememberOnDevice: input.rememberOnDevice,
  };
  if (input.companyCode?.trim()) body.companyCode = input.companyCode.trim();

  const response = await localFetch(`${automationBaseUrl}/api/operations/${input.operationId}/reauth`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(body),
  });

  return parseResponse<{
    ok: boolean;
    status?: "queued" | "authenticated";
    error?: "AUTHENTICATION_FAILED" | "COMPANY_CODE_REQUIRED" | "DATABASE_OPERATION_UPDATE_FAILED" | string;
    operationId?: string;
    operation?: AutomationOperationResponse;
  }>(response);
}

export function getArtifactUrl(operationId: string, fileName: string) {
  if (!useLocalApi) return "";
  const url = new URL(`${automationBaseUrl}/api/operations/${operationId}/artifacts/${encodeURIComponent(fileName)}`);
  return url.toString();
}

export async function downloadOperationArtifact(operationId: string, fileName: string) {
  let response: Response;
  if (useLocalApi) {
    response = await localFetch(getArtifactUrl(operationId, fileName), { headers: await headers() });
  } else {
    const artifact = (await loadArtifacts(operationId)).find((item) => item.file_name === fileName);
    if (!artifact) throw new Error("O arquivo desta operação não foi encontrado.");
    // Sign only when the user requests the file, so an old chat entry remains downloadable.
    const signedUrl = await signedArtifactUrl(artifact);
    try {
      response = await fetch(signedUrl);
    } catch {
      throw new Error("Não foi possível baixar o arquivo. Confira sua conexão e tente novamente.");
    }
  }
  if (!response.ok) {
    await parseResponse(response);
    throw new Error("Não foi possível baixar o arquivo. Tente novamente.");
  }
  const blob = await response.blob();
  if (!blob.size || (/\.pdf$/i.test(fileName) && new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer()) !== "%PDF-")) {
    throw new Error("O download não retornou um PDF válido. Tente baixar novamente.");
  }
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function subscribeToOperation(operationId: string, handlers: {
  onEvent: (event: AutomationEvent) => void;
  onError?: (error: Event) => void;
  onConnectionState?: (state: OperationConnectionState) => void;
}) {
  if (useLocalApi) {
    if (!automationBaseUrl) throw new Error("VITE_AUTOMATION_API_URL e obrigatorio quando VITE_AUTOMATION_PROVIDER=local.");
    let closed = false;
    let connecting = false;
    let source: EventSource | null = null;

    const connect = () => {
      if (closed || connecting) return;
      connecting = true;
      source?.close();
      return authTokenForSse().then((token) => {
        if (closed) return;
        const url = new URL(`${automationBaseUrl}/api/operations/${operationId}/events`);
        url.searchParams.set("token", token);
        source = new EventSource(url.toString());
        source.onopen = () => fallback.stopFallback();
        source.onmessage = (event) => {
          try {
            fallback.stopFallback();
            handlers.onEvent(JSON.parse(event.data) as AutomationEvent);
          } catch {
            fallback.startFallback();
          }
        };
        source.onerror = () => fallback.startFallback();
      }).catch(() => fallback.startFallback()).finally(() => { connecting = false; });
    };

    const fallback = createOperationFallbackMonitor({
      operationId,
      pollOperation: getOperation,
      onEvent: handlers.onEvent,
      onConnectionState: handlers.onConnectionState,
      reconnect: connect,
    });

    await connect();

    return () => {
      closed = true;
      fallback.stop();
      source?.close();
    };
  }

  let closed = false;
  let channel: SupabaseChannelLike | null = null;

  const removeCurrentChannel = () => {
    if (!channel) return;
    const current = channel;
    channel = null;
    void supabaseClient.removeChannel(current);
  };

  const connect = () => {
    if (closed) return;
    removeCurrentChannel();
    channel = supabaseClient
      .channel(`koa-operation-${operationId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "automation_operations", filter: `id=eq.${operationId}` },
        (payload) => {
          const row = payload.new as SupabaseOperationRow;
          fallback.stopFallback();
          handlers.onEvent({
            id: `${row.id}:${row.updated_at}`,
            operationId: row.id,
            type: row.status === "success" ? "operation.success" : row.status === "error" ? "operation.error" : "operation.status",
            status: row.status,
            step: row.current_step ?? undefined,
            data: row.result ?? undefined,
            createdAt: row.updated_at,
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "automation_events", filter: `operation_id=eq.${operationId}` },
        (payload) => {
          const row = payload.new as SupabaseEventRow;
          fallback.stopFallback();
          handlers.onEvent({
            id: row.id,
            operationId: row.operation_id,
            type: row.event_type,
            step: row.step ?? undefined,
            data: row.payload ?? undefined,
            createdAt: row.created_at,
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          fallback.stopFallback();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          fallback.startFallback();
        }
      });
  };

  const fallback = createOperationFallbackMonitor({
    operationId,
    pollOperation: getOperation,
    onEvent: handlers.onEvent,
    onConnectionState: handlers.onConnectionState,
    reconnect: connect,
  });

  connect();

  return () => {
    closed = true;
    fallback.stop();
    removeCurrentChannel();
  };
}
