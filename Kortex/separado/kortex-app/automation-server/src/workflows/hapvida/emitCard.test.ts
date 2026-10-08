import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page, BrowserContext } from "playwright";
import type { AutomationConfig } from "../../config.js";
import type { WorkflowContext } from "../WorkflowContext.js";
import type { OperationEvent, OperationRecord } from "../../types.js";

const mocks = vi.hoisted(() => ({
  open: vi.fn(), ready: vi.fn(), login: vi.fn(), passwordVisible: vi.fn(), invalid: vi.fn(),
  periodForm: vi.fn(), fillPeriod: vi.fn(), submitPeriod: vi.fn(), selectBeneficiary: vi.fn(),
  requestCards: vi.fn(), preview: vi.fn(), remember: vi.fn(), loginPages: [] as unknown[], cardPages: [] as unknown[], loginOptions: [] as unknown[],
}));
vi.mock("./pageObjects/HapvidaLoginPage.js", () => ({ HapvidaLoginPage: class {
  constructor(page: unknown, url: unknown, _timeout: unknown, label: unknown) { mocks.loginPages.push(page); mocks.loginOptions.push({ url, label }); }
  open = mocks.open; waitForReady = mocks.ready; login = mocks.login; passwordStillVisible = mocks.passwordVisible;
  invalidIdentificationMessage() { return { isVisible: mocks.invalid }; }
} }));
vi.mock("./pageObjects/HapvidaCardPage.js", () => ({ HapvidaCardPage: class {
  constructor(page: unknown) { mocks.cardPages.push(page); }
  waitForPeriodForm = mocks.periodForm; fillPeriod = mocks.fillPeriod; submitPeriod = mocks.submitPeriod;
  selectBeneficiary = mocks.selectBeneficiary; requestSelectedCards = mocks.requestCards; waitForCardPreview = mocks.preview;
} }));
vi.mock("../../authentication/RememberedCredentialService.js", () => ({ RememberedCredentialService: class {
  saveValidatedCredential = mocks.remember;
} }));
import { emitCard } from "./emitCard.js";
import { AutomationError } from "../../errors.js";

function fixture(remember: boolean) {
  const now = new Date().toISOString();
  const operation: OperationRecord = { id: "operation-1", type: "CARD_ISSUE", status: "starting", companyId: "company-1",
    portal: "hapvida", credentialRef: "hapvida:company-1",
    input: { beneficiaryName: "Beneficiario de teste", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
    artifacts: [], createdAt: now, updatedAt: now };
  const events: OperationEvent[] = [];
  const page = {
    evaluate: vi.fn(async () => ({ width: 640, height: 420 })),
    pdf: vi.fn(async () => Buffer.from("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF")),
  } as unknown as Page;
  const browserContext = { clearCookies: vi.fn(async () => undefined) } as unknown as BrowserContext;
  mocks.requestCards.mockResolvedValue(page);
  const validate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const saveSession = vi.fn(async () => undefined);
  const withContext = vi.fn(async (_op, _signal, callback) => callback(browserContext, page));
  const credential = { username: "0ABC", password: "synthetic-password", metadata: { rememberOnDevice: remember } };
  const getSecret = vi.fn(async () => credential);
  const artifactSave = vi.fn(async (input) => ({ storageProvider: "test", bucket: "test", storagePath: input.fileName,
    fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.bytes.length, checksum: "test-checksum" }));
  const context = {
    config: { hapvidaCardPortalUrl: "https://portal.test", features: { cardIssueActiveUsersPreflight: false } } as AutomationConfig,
    browserManager: { withContext, validatePortalSession: validate, saveSession, invalidateSession: vi.fn(async () => undefined), validateAllowedUrl: vi.fn() },
    secretProvider: { get: getSecret }, artifactStorage: { save: artifactSave },
    repository: { get: async () => operation, update: async (_id, patch) => Object.assign(operation, patch) },
    updateStatus: async (status, step) => Object.assign(operation, { status, currentStep: step }),
    emitEvent: async (event) => { events.push({ ...event, createdAt: now }); return event; },
  } as unknown as WorkflowContext;
  return { operation, context, events, page, browserContext, validate, withContext, saveSession, getSecret, artifactSave };
}

describe("CARD_ISSUE authentication in the execution context", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.loginPages.length = 0; mocks.cardPages.length = 0; mocks.loginOptions.length = 0;
    mocks.passwordVisible.mockResolvedValue(false); mocks.invalid.mockResolvedValue(false);
    mocks.remember.mockResolvedValue({ rememberedOnDevice: true, metadataRegistered: true });
  });

  it.each([false, true])("logs in once, continues to PDF in the same context and respects remember=%s", async (remember) => {
    const f = fixture(remember);
    await emitCard(f.operation, new AbortController().signal, f.context);
    expect(f.withContext).toHaveBeenCalledOnce();
    expect(mocks.login).toHaveBeenCalledOnce();
    expect(f.getSecret).toHaveBeenCalledOnce();
    expect(mocks.loginPages).toEqual([f.page]);
    expect(mocks.cardPages).toEqual([f.page, f.page]);
    expect(f.operation.status).toBe("success");
    expect(f.artifactSave).toHaveBeenCalledOnce();
    expect(f.artifactSave).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "carteirinha-beneficiario-de-teste.pdf",
    }));
    expect(f.page.pdf).toHaveBeenCalledWith(expect.objectContaining({ width: "640px", height: "420px" }));
    const authenticated = f.events.filter((event) => event.type === "authentication.succeeded");
    expect(authenticated).toHaveLength(1);
    expect(authenticated[0]?.data).toEqual({ source: "worker" });
    if (remember) {
      expect(mocks.remember).toHaveBeenCalledOnce();
      expect(mocks.remember.mock.invocationCallOrder[0]).toBeGreaterThan(f.validate.mock.invocationCallOrder[1]!);
      expect(mocks.periodForm.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.remember.mock.invocationCallOrder[0]!);
      expect(f.events.some((event) => event.type === "authentication.saved_on_device")).toBe(true);
    } else {
      expect(mocks.remember).not.toHaveBeenCalled();
      expect(f.events.some((event) => event.type === "authentication.saved_on_device")).toBe(false);
    }
    expect(JSON.stringify(f.events)).not.toContain("synthetic-password");
  });

  it("reopens the card portal once when authentication is transiently unavailable", async () => {
    const f = fixture(false);
    f.validate.mockReset()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mocks.login
      .mockRejectedValueOnce(new AutomationError("PORTAL_AUTH_UNAVAILABLE", "Portal indisponivel.", {
        safeDetails: "Falha temporaria do portal.",
        step: "authenticate",
        retryable: true,
      }))
      .mockResolvedValueOnce(undefined);

    await emitCard(f.operation, new AbortController().signal, f.context);

    expect(f.withContext).toHaveBeenCalledTimes(2);
    expect(mocks.login).toHaveBeenCalledTimes(2);
    expect(f.getSecret).toHaveBeenCalledOnce();
    expect(f.events.some((event) => event.type === "authentication.started" && event.step === "portal_auth_retrying")).toBe(true);
    expect(f.operation.status).toBe("success");
    expect(JSON.stringify(f.events)).not.toContain("synthetic-password");
  });

  it("issues through NDI using its URL and session, without Hapvida movement preflight", async () => {
    const f = fixture(true);
    f.operation.portal = "ndi"; f.operation.credentialRef = "ndi:company-1";
    f.context.config.ndiCardPortalUrl = "https://sigo.sh.srv.br/pls/webmin/pk_carteira_provisoria.login_empresa_form";
    f.context.config.features.cardIssueActiveUsersPreflight = true;
    f.operation.result = { cardPortalSearch: { notFound: ["hapvida"], visited: ["hapvida", "ndi"] } };
    await emitCard(f.operation, new AbortController().signal, f.context);
    expect(mocks.loginOptions).toEqual([{ url: f.context.config.ndiCardPortalUrl, label: "NDI" }]);
    expect(f.validate).toHaveBeenCalledWith("ndi", f.page);
    expect(f.saveSession).toHaveBeenCalledWith(f.browserContext, "ndi");
    expect(f.operation.result).toMatchObject({ operator: "ndi", cardPortalSearch: { notFound: ["hapvida"] } });
    expect(f.artifactSave).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ operator: "ndi" }) }));
    expect(mocks.remember).toHaveBeenCalledWith(expect.objectContaining({ portal: "ndi", credentialRef: "ndi:company-1" }), expect.any(Object));
    expect(f.operation.status).toBe("success");
  });

  it("does not save the password or announce success when portal authentication fails", async () => {
    const f = fixture(true);
    f.validate.mockReset().mockResolvedValue(false);
    mocks.passwordVisible.mockResolvedValue(true);
    mocks.invalid.mockResolvedValue(true);
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(f.artifactSave).not.toHaveBeenCalled();
    expect(f.events.some((event) => event.type === "authentication.succeeded")).toBe(false);
  });

  it("uses the requested code instead of an earlier valid portal session", async () => {
    const f = fixture(true);
    f.operation.input.contractCode = "0NEW";
    f.validate.mockReset().mockResolvedValue(true);
    f.getSecret.mockResolvedValue({ username: "0NEW", password: "new-password", metadata: { rememberOnDevice: true } });
    await emitCard(f.operation, new AbortController().signal, f.context);
    expect(f.browserContext.clearCookies).toHaveBeenCalledOnce();
    expect(mocks.login).toHaveBeenCalledWith(expect.objectContaining({ username: "0NEW", password: "new-password" }));
    expect(mocks.remember).toHaveBeenCalledOnce();
    expect(f.operation.status).toBe("success");
  });

  it("asks for the requested access without submitting another code's saved password", async () => {
    const f = fixture(false);
    f.operation.input.contractCode = "0NEW";
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(f.artifactSave).not.toHaveBeenCalled();
  });

  it("checks portal verification before requesting or consuming a password", async () => {
    const f = fixture(true);
    mocks.ready.mockRejectedValue(new AutomationError("PORTAL_AUTH_UNAVAILABLE", "Verificacao indisponivel."));
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code: "PORTAL_AUTH_UNAVAILABLE" });
    expect(f.getSecret).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(f.artifactSave).not.toHaveBeenCalled();
  });

  it("does not wait for an old session when the login form is visibly open", async () => {
    const f = fixture(false);
    f.validate.mockReset().mockResolvedValue(true);
    mocks.passwordVisible.mockResolvedValue(true);
    await emitCard(f.operation, new AbortController().signal, f.context);
    expect(f.validate).toHaveBeenCalledOnce();
    expect(mocks.login).toHaveBeenCalledOnce();
    expect(f.operation.status).toBe("success");
  });

  it("does not request another password when an unrecognized page follows login", async () => {
    const f = fixture(false);
    f.validate.mockReset().mockResolvedValue(false);
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code: "PORTAL_AUTH_UNAVAILABLE" });
    expect(f.events.some((event) => event.type === "authentication.succeeded")).toBe(false);
    expect(f.artifactSave).not.toHaveBeenCalled();
  });

  it("does not classify a silent return to the login form as a rejected password", async () => {
    const f = fixture(false);
    f.validate.mockReset().mockResolvedValue(false);
    mocks.passwordVisible.mockResolvedValue(true);
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code: "PORTAL_AUTH_UNAVAILABLE" });
    expect(f.events.some((event) => event.type === "authentication.succeeded")).toBe(false);
    expect(f.artifactSave).not.toHaveBeenCalled();
  });

  it.each(["CARD_PREVIEW_NOT_FOUND", "CARD_VALIDATION_FAILED"])("does not print, store or announce a PDF after %s", async (code) => {
    const f = fixture(false);
    mocks.preview.mockRejectedValue(new AutomationError(code, "Previa nao confirmada.", { step: "validate_card_preview" }));
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code });
    expect(f.page.pdf).not.toHaveBeenCalled();
    expect(f.artifactSave).not.toHaveBeenCalled();
    expect(f.operation.artifacts).toEqual([]);
    expect(f.events.some((event) => event.type === "artifact.created" || event.type === "operation.success")).toBe(false);
    expect(f.operation.status).toBe("verifying");
  });

  it("does not store a PDF when printing returns invalid bytes", async () => {
    const f = fixture(false);
    vi.mocked(f.page.pdf).mockResolvedValue(Buffer.from("<html>Erro do portal</html>"));
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code: "PDF_VALIDATION_FAILED" });
    expect(f.artifactSave).not.toHaveBeenCalled();
    expect(f.events.some((event) => event.type === "artifact.created" || event.type === "operation.success")).toBe(false);
  });
});
