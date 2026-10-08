import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { chromium, type BrowserContext } from "playwright";
import type { AutomationConfig } from "../config.js";
import { AutomationError } from "../errors.js";
import type { OperationRecord, PortalCredential } from "../types.js";
import { KoaBrowserProfileManager } from "../browser/KoaBrowserProfileManager.js";
import { DomainAllowlist } from "../security/DomainAllowlist.js";
import { protectWithDpapi } from "../security/DpapiProtector.js";
import type { EphemeralCredentialStore } from "../secrets/EphemeralCredentialStore.js";
import { HapvidaLoginPage } from "../workflows/hapvida/pageObjects/HapvidaLoginPage.js";

const { Pool } = pg;

export interface OperationAuthenticationInput {
  companyCode?: string;
  password: string;
  rememberOnDevice: boolean;
}

export interface OperationAuthenticationResult {
  rememberedOnDevice: boolean;
}

function safeFileName(ref: string) {
  return Buffer.from(ref, "utf8").toString("base64url");
}

function maskUsername(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "***";
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function companyCodeFor(operation: OperationRecord, input: OperationAuthenticationInput) {
  return input.companyCode?.trim() || readString(operation.input.contractCode) || readString(operation.input.companyCode);
}

export class OperationAuthenticationService {
  private readonly profileManager: KoaBrowserProfileManager;
  private readonly allowlist: DomainAllowlist;

  constructor(
    private readonly config: AutomationConfig,
    private readonly ephemeralCredentials?: EphemeralCredentialStore,
  ) {
    this.profileManager = new KoaBrowserProfileManager(config);
    this.allowlist = new DomainAllowlist(config.allowedAutomationHosts);
  }

  async authenticateCardIssue(operation: OperationRecord, input: OperationAuthenticationInput): Promise<OperationAuthenticationResult> {
    if (operation.type !== "CARD_ISSUE" || operation.portal !== "hapvida") {
      throw new AutomationError("AUTHENTICATION_NOT_SUPPORTED", "Reautenticacao indisponivel para esta operacao.", {
        retryable: false,
      });
    }

    const companyCode = companyCodeFor(operation, input);
    if (!companyCode) {
      throw new AutomationError("COMPANY_CODE_REQUIRED", "Codigo da empresa e necessario para autenticar.", {
        safeDetails: "Informe o codigo da empresa para autenticar o acesso Hapvida.",
        retryable: true,
      });
    }

    const portalUrl = this.config.hapvidaCardPortalUrl ?? this.config.hapvidaPortalUrl;
    if (!portalUrl) {
      throw new AutomationError("PORTAL_URL_NOT_CONFIGURED", "URL do portal Hapvida nao configurada.", {
        retryable: false,
      });
    }

    this.allowlist.assertAllowed(portalUrl, operation.type);

    const credential: PortalCredential = {
      username: companyCode,
      password: input.password,
    };

    const browser = await chromium.launch({
      channel: this.config.browserChannel,
      headless: true,
    });

    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await context.newPage();
      const loginPage = new HapvidaLoginPage(page, portalUrl);

      await loginPage.open();
      await loginPage.login(credential);

      const valid = await this.profileManager.validatePortalSession("hapvida", page);
      if (!valid) {
        await this.throwAuthenticationFailed(loginPage);
      }

      await this.profileManager.saveSession(context, "hapvida");
      await this.profileManager.markSessionValidated("hapvida");
      this.ephemeralCredentials?.put(
        operation.id,
        this.credentialRefFor(operation),
        credential,
        this.config.authChallengeTtlMinutes * 60 * 1000,
      );

      if (input.rememberOnDevice) {
        await this.saveCredential(operation, companyCode, input.password);
      }

      return { rememberedOnDevice: input.rememberOnDevice };
    } finally {
      await context?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  private async throwAuthenticationFailed(loginPage: HapvidaLoginPage): Promise<never> {
    if (await loginPage.invalidIdentificationMessage().isVisible().catch(() => false)) {
      throw new AutomationError("AUTHENTICATION_FAILED", "Nao foi possivel autenticar o acesso Hapvida.", {
        safeDetails: "O portal retornou Identificacao invalida.",
        step: "authenticate",
        retryable: true,
      });
    }

    if (await loginPage.passwordStillVisible()) {
      throw new AutomationError("AUTHENTICATION_FAILED", "Nao foi possivel autenticar o acesso Hapvida.", {
        safeDetails: "O portal permaneceu na tela de login.",
        step: "authenticate",
        retryable: true,
      });
    }

    throw new AutomationError("AUTHENTICATION_FAILED", "Nao foi possivel autenticar o acesso Hapvida.", {
      safeDetails: "O portal nao confirmou o estado autenticado esperado.",
      step: "authenticate",
      retryable: true,
    });
  }

  private credentialRefFor(operation: OperationRecord) {
    return operation.credentialRef || `hapvida:${operation.companyId}`;
  }

  private async saveCredential(operation: OperationRecord, companyCode: string, password: string) {
    const credentialRef = this.credentialRefFor(operation);
    const payload = JSON.stringify({ username: companyCode, password });
    const encrypted = await protectWithDpapi(payload);

    await mkdir(this.config.secretsDir, { recursive: true });
    await writeFile(path.join(this.config.secretsDir, `${safeFileName(credentialRef)}.credential.dpapi`), encrypted, "utf8");

    if (!this.config.databaseUrl || !operation.workspaceId) return;

    const pool = new Pool({
      connectionString: this.config.databaseUrl,
      max: 1,
      application_name: "kortex-reauth-credential-save",
    });

    try {
      const metadata = {
        source: "local_dpapi",
        store: "worker_local",
        portalLoginCode: companyCode,
        registeredVia: "koa_chat_reauth",
        lastValidatedAt: new Date().toISOString(),
      };

      await pool.query(
        `INSERT INTO public.automation_credentials (
           workspace_id,
           company_id,
           operator,
           credential_ref,
           label,
           username_hint,
           status,
           last_verified_at,
           metadata
         )
         VALUES ($1, $2, 'hapvida', $3, $4, $5, 'active', now(), $6::jsonb)
         ON CONFLICT (credential_ref)
         DO UPDATE SET
           workspace_id = EXCLUDED.workspace_id,
           company_id = EXCLUDED.company_id,
           operator = EXCLUDED.operator,
           label = EXCLUDED.label,
           username_hint = EXCLUDED.username_hint,
           status = 'active'::public.automation_credential_status,
           last_verified_at = now(),
           metadata = public.automation_credentials.metadata || EXCLUDED.metadata,
           updated_at = now()`,
        [
          operation.workspaceId,
          operation.companyId,
          credentialRef,
          `Hapvida - ${operation.companyId}`,
          maskUsername(companyCode),
          JSON.stringify(metadata),
        ],
      );
    } finally {
      await pool.end();
    }
  }
}
