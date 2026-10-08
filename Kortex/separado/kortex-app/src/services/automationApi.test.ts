import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
const mock = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn(), signedUrl: vi.fn(), artifacts: vi.fn(), operation: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: mock.getSession, refreshSession: mock.refreshSession },
  storage: { from: () => ({ createSignedUrl: mock.signedUrl }) },
  from: (table: string) => ({ select: () => ({ eq: () => table === "automation_artifacts" ? mock.artifacts() : mock.operation() }) }),
} }));

describe("card file downloads from the chat", () => {
  const fileResponse = (body: string) => ({ ok: true, blob: async () => new NodeBlob([body]) });
  const fetchMock = vi.fn();
  const createObjectURL = vi.fn(() => "blob:download-test");
  let click: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_AUTOMATION_PROVIDER", "local");
    vi.stubEnv("VITE_AUTOMATION_API_URL", "http://127.0.0.1:4777");
    vi.stubEnv("VITE_AUTOMATION_API_TOKEN", "");
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mock.getSession.mockResolvedValue({ data: { session: { access_token: "current-user-jwt" } } });
    mock.refreshSession.mockResolvedValue({ data: { session: { access_token: "renewed-user-jwt" } } });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("downloads with the current JWT in production and a filename for the user's computer", async () => {
    fetchMock.mockResolvedValue(fileResponse("%PDF-1.7\n%%EOF"));
    const { downloadOperationArtifact } = await import("./automationApi");
    await downloadOperationArtifact("operation-1", "carteirinha.pdf");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4777/api/operations/operation-1/artifacts/carteirinha.pdf", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer current-user-jwt" }) }));
    expect(click.mock.instances[0]).toHaveProperty("download", "carteirinha.pdf");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(document.querySelector("a[download]")).toBeNull();
  });
  it("reports an unavailable worker rather than blaming the portal password", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { createOperation } = await import("./automationApi");
    await expect(createOperation({ type: "CARD_ISSUE", companyId: "company-1", data: { beneficiaryName: "Pessoa de teste", contractCode: "0NEW" } })).rejects.toThrow("Inicie o worker");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mock.refreshSession).not.toHaveBeenCalled();
  });
  it("does not send an unauthenticated order to the worker", async () => {
    mock.getSession.mockResolvedValue({ data: { session: null } });
    const { createOperation } = await import("./automationApi");
    await expect(createOperation({ type: "CARD_ISSUE", companyId: "company-1", data: {} })).rejects.toThrow("Entre no Kortex");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mock.refreshSession).not.toHaveBeenCalled();
  });
  it("uses the configured local worker token without requiring a Kortex session", async () => {
    vi.stubEnv("VITE_AUTOMATION_API_TOKEN", "local-worker-token");
    mock.getSession.mockResolvedValue({ data: { session: null } });
    fetchMock.mockResolvedValueOnce(new Response('{"operationId":"new-operation","status":"queued"}', { status: 202 }));
    const { createOperation } = await import("./automationApi");
    expect((await createOperation({ type: "CARD_ISSUE", companyId: "company-1", data: { contractCode: "0NEW" } })).operationId).toBe("new-operation");
    expect(mock.getSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("x-koa-automation-token")).toBe("local-worker-token");
    expect(headers.get("authorization")).toBeNull();
  });
  it("renews a rejected session and sends the same order once with the new JWT", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"operationId":"new-operation","status":"queued"}', { status: 202 }));
    const { createOperation } = await import("./automationApi");
    expect((await createOperation({ type: "CARD_ISSUE", companyId: "company-1", data: { contractCode: "0NEW" } })).operationId).toBe("new-operation");
    expect(mock.refreshSession).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = fetchMock.mock.calls[0][1];
    const retried = fetchMock.mock.calls[1][1];
    expect(first.body).toBe(retried.body);
    expect(retried.method).toBe("POST");
    expect(new Headers(retried.headers).get("authorization")).toBe("Bearer renewed-user-jwt");
    expect(new Headers(retried.headers).get("x-koa-automation-token")).toBeNull();
  });
  it("stops after one renewal if the worker still rejects the session", async () => {
    fetchMock.mockImplementation(async () => new Response('{"error":"unauthorized"}', { status: 401 }));
    const { createOperation } = await import("./automationApi");
    await expect(createOperation({ type: "CARD_ISSUE", companyId: "company-1", data: {} })).rejects.toThrow("mesmo projeto Supabase");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mock.refreshSession).toHaveBeenCalledOnce();
  });
  it("does not repeat an order when session renewal fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401 }));
    mock.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: "Invalid refresh token" } });
    const { createOperation } = await import("./automationApi");
    await expect(createOperation({ type: "CARD_ISSUE", companyId: "company-1", data: {} })).rejects.toThrow("Entre novamente no Kortex");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("does not renew or repeat a POST after a worker configuration or server failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"KORTEX_AUTH_NOT_CONFIGURED","message":"Configure o login do Kortex no worker"}', { status: 503 }));
    const { createOperation } = await import("./automationApi");
    await expect(createOperation({ type: "CARD_ISSUE", companyId: "company-1", data: {} })).rejects.toThrow("Configure o login do Kortex no worker");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mock.refreshSession).not.toHaveBeenCalled();
  });
  it("shares a session renewal between simultaneous rejected requests", async () => {
    let finish!: (value: { data: { session: { access_token: string } } }) => void;
    mock.refreshSession.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    fetchMock.mockImplementation(async (_url, options) => new Headers(options.headers).get("authorization") === "Bearer renewed-user-jwt"
      ? new Response('{"operationId":"operation-1","status":"queued"}')
      : new Response('{"error":"unauthorized"}', { status: 401 }));
    const { getOperation } = await import("./automationApi");
    const first = getOperation("operation-1"); const second = getOperation("operation-2");
    await vi.waitFor(() => expect(mock.refreshSession).toHaveBeenCalledOnce());
    finish({ data: { session: { access_token: "renewed-user-jwt" } } });
    await Promise.all([first, second]);
    expect(mock.refreshSession).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("recovers the PDF download with a renewed session", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401 }))
      .mockResolvedValueOnce(fileResponse("%PDF-1.7\n%%EOF"));
    const { downloadOperationArtifact } = await import("./automationApi");
    await downloadOperationArtifact("operation-1", "carteirinha.pdf");
    expect(mock.refreshSession).toHaveBeenCalledOnce();
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("authorization")).toBe("Bearer renewed-user-jwt");
    expect(click).toHaveBeenCalledOnce();
  });
  it("uses the current session on each event stream reconnection", async () => {
    vi.useFakeTimers();
    const streams: Array<{ url: string; close: ReturnType<typeof vi.fn>; onerror?: () => void }> = [];
    class TestEventSource {
      close = vi.fn(); onerror?: () => void;
      constructor(public url: string) { streams.push(this); }
    }
    vi.stubGlobal("EventSource", TestEventSource);
    fetchMock.mockImplementation(async () => new Response('{"operationId":"operation-1","status":"queued"}'));
    try {
      const { subscribeToOperation } = await import("./automationApi");
      const stop = await subscribeToOperation("operation-1", { onEvent: vi.fn() });
      expect(new URL(streams[0].url).searchParams.get("token")).toBe("current-user-jwt");
      mock.getSession.mockResolvedValue({ data: { session: { access_token: "renewed-user-jwt" } } });
      streams[0].onerror?.();
      await vi.advanceTimersByTimeAsync(5000);
      expect(new URL(streams[1].url).searchParams.get("token")).toBe("renewed-user-jwt");
      expect(streams[0].close).toHaveBeenCalled();
      stop();
      expect(streams[1].close).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("does not save an HTML error page with a PDF extension", async () => {
    fetchMock.mockResolvedValue(fileResponse("<html>Erro</html>"));
    const { downloadOperationArtifact } = await import("./automationApi");
    await expect(downloadOperationArtifact("operation-1", "carteirinha.pdf")).rejects.toThrow("PDF válido");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
  it("creates a fresh signed URL at each download, and status remains readable when signing fails", async () => {
    vi.stubEnv("VITE_AUTOMATION_PROVIDER", "supabase");
    const now = new Date().toISOString();
    mock.artifacts.mockResolvedValue({ data: [{ id: "artifact", file_name: "carteirinha.pdf", bucket: "koa-artifacts", storage_path: "operations/test/card.pdf", created_at: now, type: "card_pdf" }], error: null });
    mock.operation.mockResolvedValue({ data: [{ id: "operation-1", operation_type: "CARD_ISSUE", status: "success", company_id: "company-1", operator: "hapvida", created_at: now, updated_at: now }], error: null });
    mock.signedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://storage.test/fresh-1" }, error: null }).mockResolvedValueOnce({ data: { signedUrl: "https://storage.test/fresh-2" }, error: null });
    fetchMock.mockImplementation(async () => fileResponse("%PDF-1.7\n%%EOF"));
    const { getOperation, downloadOperationArtifact } = await import("./automationApi");
    expect((await getOperation("operation-1")).status).toBe("success");
    expect(mock.signedUrl).not.toHaveBeenCalled();
    await downloadOperationArtifact("operation-1", "carteirinha.pdf");
    await downloadOperationArtifact("operation-1", "carteirinha.pdf");
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["https://storage.test/fresh-1", "https://storage.test/fresh-2"]);
    mock.signedUrl.mockRejectedValue(new Error("signing unavailable"));
    expect((await getOperation("operation-1")).status).toBe("success");
  });
});
