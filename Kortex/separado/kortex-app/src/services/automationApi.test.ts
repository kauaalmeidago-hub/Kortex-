import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
const mock = vi.hoisted(() => ({ getSession: vi.fn(), signedUrl: vi.fn(), artifacts: vi.fn(), operation: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: mock.getSession },
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
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mock.getSession.mockResolvedValue({ data: { session: { access_token: "current-user-jwt" } } });
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
