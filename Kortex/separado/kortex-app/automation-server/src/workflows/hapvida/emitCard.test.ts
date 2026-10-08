import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page, BrowserContext } from "playwright";
import type { AutomationConfig } from "../../config.js";
import type { WorkflowContext } from "../WorkflowContext.js";
import type { OperationEvent, OperationRecord } from "../../types.js";

const mocks = vi.hoisted(() => ({
  open: vi.fn(), ready: vi.fn(), login: vi.fn(), passwordVisible: vi.fn(), invalid: vi.fn(),
  periodForm: vi.fn(), fillPeriod: vi.fn(), submitPeriod: vi.fn(), selectBeneficiary: vi.fn(),
  requestCards: vi.fn(), preview: vi.fn(), remember: vi.fn(), loginPages: [] as unknown[], cardPages: [] as unknown[],
}));
vi.mock("./pageObjects/HapvidaLoginPage.js", () => ({ HapvidaLoginPage: class {
  constructor(page: unknown) { mocks.loginPages.push(page); }
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
  const page = { pdf: vi.fn(async () => Buffer.from("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF")) } as unknown as Page;
  const browserContext = {} as BrowserContext;
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
    mocks.loginPages.length = 0; mocks.cardPages.length = 0;
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
});
