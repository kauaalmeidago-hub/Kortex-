import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page, BrowserContext } from "playwright";
import type { AutomationConfig } from "../../config.js";
import type { WorkflowContext } from "../WorkflowContext.js";
import type { OperationEvent, OperationRecord } from "../../types.js";

const mocks = vi.hoisted(() => ({
  open: vi.fn(), ready: vi.fn(), login: vi.fn(), passwordVisible: vi.fn(), invalid: vi.fn(),
  periodForm: vi.fn(), fillPeriod: vi.fn(), submitPeriod: vi.fn(), selectBeneficiary: vi.fn(),
  requestCards: vi.fn(), preview: vi.fn(), selectAll: vi.fn(), previews: vi.fn(), inspectCandidates: vi.fn(), inspectFamily: vi.fn(), selectMany: vi.fn(), capture: vi.fn(), describeDelivery: vi.fn(), remember: vi.fn(), loginPages: [] as unknown[], cardPages: [] as unknown[], loginOptions: [] as unknown[],
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
  selectAllBeneficiaries = mocks.selectAll; waitForCardPreviews = mocks.previews;
  inspectBeneficiaryFamily = mocks.inspectFamily; selectBeneficiaries = mocks.selectMany;
  inspectBeneficiaryCandidates = mocks.inspectCandidates;
  describeSelectedBeneficiaries = mocks.describeDelivery;
} }));
vi.mock("../../authentication/RememberedCredentialService.js", () => ({ RememberedCredentialService: class {
  saveValidatedCredential = mocks.remember;
} }));
vi.mock("./brandedCardDelivery.js", () => ({ createBrandedCardDelivery: mocks.capture }));
import { emitCard } from "./emitCard.js";
import { AutomationError } from "../../errors.js";
import { pendingCardDependents } from "./cardDependents.js";

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
  mocks.capture.mockImplementation(async (_page, _frames, members) => ({ bytes: await page.pdf({ printBackground: true }), pageCount: Math.ceil(members.length / 2), deliveryVersion: 1, template: members.length === 1 ? "single" : "first" }));
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
    mocks.describeDelivery.mockImplementation(async members => members.map((member, index) => ({ ...member, id: `member-${index}`, role: "beneficiary" })));
    mocks.inspectFamily.mockImplementation(async beneficiary => ({ beneficiary, dependents: [] }));
    mocks.inspectCandidates.mockResolvedValue([]);
    mocks.selectBeneficiary.mockImplementation(async beneficiary => beneficiary);
    mocks.selectMany.mockImplementation(async beneficiaries => beneficiaries);
    mocks.previews.mockResolvedValue([]);
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
      fileName: "beneficiario-de-teste.pdf",
    }));
    expect(mocks.capture).toHaveBeenCalledWith(f.page, [], expect.arrayContaining([expect.objectContaining({ beneficiaryName: "Beneficiario de teste" })]), [], "beneficiario de teste", expect.any(AbortSignal));
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
    expect(f.validate).not.toHaveBeenCalled();
  });

  it("confirms database storage after a validated login even without a local DPAPI copy", async () => {
    const f = fixture(true);
    mocks.remember.mockResolvedValue({ rememberedOnDevice: false, metadataRegistered: true, storedInDatabase: true });
    await emitCard(f.operation, new AbortController().signal, f.context);
    expect(f.events.filter(event => event.type === "authentication.saved_in_database")).toEqual([
      expect.objectContaining({ data: { operator: "hapvida", storedInDatabase: true } }),
    ]);
    expect(f.events.some(event => event.type === "authentication.saved_on_device")).toBe(false);
    expect(mocks.remember.mock.invocationCallOrder[0]).toBeGreaterThan(f.validate.mock.invocationCallOrder[1]!);
    expect(f.operation.status).toBe("success");
    expect(JSON.stringify(f.events)).not.toContain("synthetic-password");
  });

  it("does not request another password or attempt portal login during a credential database outage", async () => {
    const f = fixture(false);
    f.getSecret.mockRejectedValue(new AutomationError("CREDENTIAL_STORE_UNAVAILABLE", "Cofre indisponivel.", { retryable: true }));
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code: "CREDENTIAL_STORE_UNAVAILABLE" });
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(f.artifactSave).not.toHaveBeenCalled();
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

  it("does not store or deliver an interrupted PDF even when its header and page exist", async () => {
    const f = fixture(false);
    vi.mocked(f.page.pdf).mockResolvedValue(Buffer.from("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n"));
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code: "PDF_VALIDATION_FAILED" });
    expect(f.artifactSave).not.toHaveBeenCalled();
    expect(f.operation.artifacts).toEqual([]);
    expect(f.operation.status).not.toBe("success");
    expect(f.events.some(event => event.type === "artifact.created" || event.type === "operation.success")).toBe(false);
  });

  it("pauses before selecting or printing when the portal identifies dependents", async () => {
    const f = fixture(false);
    const family = { beneficiary: { beneficiaryName: "Beneficiario de teste" }, dependents: [{ beneficiaryName: "DEPENDENTE DE TESTE" }] };
    mocks.inspectFamily.mockResolvedValue(family);
    const retained = vi.fn(); f.context.retainCardConfirmationCredential = retained;
    await emitCard(f.operation, new AbortController().signal, f.context);
    expect(f.operation.status).toBe("awaiting_confirmation");
    expect(f.operation.result?.cardDependentConfirmation).toMatchObject({ beneficiaryName: family.beneficiary.beneficiaryName, dependentNames: ["DEPENDENTE DE TESTE"] });
    expect(mocks.selectBeneficiary).not.toHaveBeenCalled();
    expect(mocks.requestCards).not.toHaveBeenCalled();
    expect(f.artifactSave).not.toHaveBeenCalled();
    expect(retained).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.operation)).not.toContain("synthetic-password");
  });

  it.each(["with", "without"] as const)("resumes the same operation with its authorized %s choice", async decision => {
    const f = fixture(false);
    const family = { beneficiary: { beneficiaryName: "Beneficiario de teste" }, dependents: [{ beneficiaryName: "DEPENDENTE DE TESTE" }] };
    mocks.inspectFamily.mockResolvedValue(family);
    f.operation.result = { cardDependentConfirmation: { ...pendingCardDependents(f.operation, family.beneficiary, family.dependents), decision, approvedBy: "user-1" } };
    await emitCard(f.operation, new AbortController().signal, f.context);
    expect(f.operation.status).toBe("success");
    expect(f.operation.result?.beneficiaryCount).toBe(decision === "with" ? 2 : 1);
    expect(mocks.requestCards).toHaveBeenCalledWith(decision === "with" ? [family.beneficiary, ...family.dependents] : [family.beneficiary], false, expect.any(Function));
    if (decision === "without") {
      expect(mocks.preview).toHaveBeenCalledWith(family.beneficiary);
      expect(mocks.selectBeneficiary).toHaveBeenCalledWith(family.beneficiary, family.dependents);
      expect(mocks.capture).toHaveBeenCalledWith(f.page, [], [expect.objectContaining(family.beneficiary)], family.dependents, "beneficiario de teste", expect.any(AbortSignal));
    }
    else expect(mocks.previews).toHaveBeenCalledWith([family.beneficiary, ...family.dependents]);
  });

  it("does not fall back to delivering the family PDF when individual capture fails", async () => {
    const f = fixture(false);
    mocks.capture.mockRejectedValue(new AutomationError("CARD_CAPTURE_FAILED", "Cartao ambiguo."));
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code: "CARD_CAPTURE_FAILED" });
    expect(f.page.pdf).not.toHaveBeenCalled();
    expect(f.artifactSave).not.toHaveBeenCalled();
    expect(f.operation.artifacts).toEqual([]);
    expect(f.operation.status).not.toBe("success");
  });

  it("does not store or announce a raw card when the branded delivery fails", async () => {
    const f = fixture(false);
    mocks.capture.mockRejectedValue(new AutomationError("CARD_DELIVERY_FAILED", "Moldura indisponivel."));
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code: "CARD_DELIVERY_FAILED" });
    expect(f.artifactSave).not.toHaveBeenCalled();
    expect(f.operation.artifacts).toEqual([]);
    expect(f.operation.status).not.toBe("success");
  });

  it("requires a new choice if the dependent identity changed while awaiting approval", async () => {
    const f = fixture(false);
    const beneficiary = { beneficiaryName: "Beneficiario de teste" }, dependent = { beneficiaryName: "DEPENDENTE DE TESTE", cardIdentifiers: ["900001"] };
    f.operation.result = { cardDependentConfirmation: { ...pendingCardDependents(f.operation, beneficiary, [dependent]), decision: "with" } };
    mocks.inspectFamily.mockResolvedValue({ beneficiary, dependents: [{ ...dependent, cardIdentifiers: ["900002"] }] });
    await emitCard(f.operation, new AbortController().signal, f.context);
    expect(f.operation.status).toBe("awaiting_confirmation");
    expect(mocks.requestCards).not.toHaveBeenCalled();
    expect(f.artifactSave).not.toHaveBeenCalled();
  });

  it("issues all returned NDI beneficiaries in one PDF after verifying every selection", async () => {
    const f = fixture(false);
    f.operation.portal = "ndi";
    f.operation.input = { ...f.operation.input, beneficiaryName: "TODOS", contractCode: "0ABC" };
    f.validate.mockReset().mockResolvedValue(true);
    const selected = [{ beneficiaryName: "PESSOA DE TESTE UM" }, { beneficiaryName: "PESSOA DE TESTE DOIS" }];
    mocks.selectAll.mockResolvedValue(selected);
    await emitCard(f.operation, new AbortController().signal, f.context);
    expect(mocks.selectBeneficiary).not.toHaveBeenCalled();
    expect(mocks.selectAll).toHaveBeenCalledOnce();
    expect(mocks.previews).toHaveBeenCalledWith(selected);
    expect(f.operation.result).toMatchObject({ operator: "ndi", beneficiaryScope: "all", beneficiaryCount: 2 });
    expect(f.artifactSave).toHaveBeenCalledWith(expect.objectContaining({ fileName: "carteirinhas-empresa-0abc.pdf" }));
    expect(mocks.capture).toHaveBeenCalledWith(f.page, [], expect.arrayContaining(selected.map(member => expect.objectContaining(member))), [], "carteirinhas da empresa 0abc", expect.any(AbortSignal));
    expect(f.operation.status).toBe("success");
  });

  it("does not print or report a complete batch when one selected person's preview is missing", async () => {
    const f = fixture(false);
    f.operation.input = { ...f.operation.input, beneficiaryName: "todos", contractCode: "0ABC" };
    f.validate.mockReset().mockResolvedValue(true);
    mocks.selectAll.mockResolvedValue([{ beneficiaryName: "PESSOA DE TESTE UM" }, { beneficiaryName: "PESSOA DE TESTE DOIS" }]);
    mocks.previews.mockRejectedValue(new AutomationError("CARD_VALIDATION_FAILED", "Falta um beneficiario no documento."));
    await expect(emitCard(f.operation, new AbortController().signal, f.context)).rejects.toMatchObject({ code: "CARD_VALIDATION_FAILED" });
    expect(f.page.pdf).not.toHaveBeenCalled(); expect(f.artifactSave).not.toHaveBeenCalled();
    expect(f.operation.artifacts).toEqual([]);
  });
});
