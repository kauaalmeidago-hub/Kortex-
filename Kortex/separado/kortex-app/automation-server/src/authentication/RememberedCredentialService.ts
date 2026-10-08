import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { AutomationConfig } from "../config.js";
import { AutomationError } from "../errors.js";
import type { OperationRecord, PortalCredential } from "../types.js";
import { protectWithDpapi } from "../security/DpapiProtector.js";

const { Pool } = pg;

function safeFileName(ref: string) {
  return Buffer.from(ref, "utf8").toString("base64url");
}

function maskUsername(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "***";
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

// Called by the CARD_ISSUE worker only after validating the portal session in its execution context.
export class RememberedCredentialService {
  constructor(private readonly config: AutomationConfig) {}

  async saveValidatedCredential(operation: OperationRecord, credential: PortalCredential) {
    if (credential.metadata?.rememberOnDevice !== true) {
      return { rememberedOnDevice: false, metadataRegistered: false };
    }
    if (operation.type !== "CARD_ISSUE" || operation.portal !== "hapvida") {
      throw new AutomationError("AUTHENTICATION_NOT_SUPPORTED", "Persistencia de credencial indisponivel para esta operacao.");
    }
    const companyCode = credential.username;
    const password = credential.password;
    const credentialRef = operation.credentialRef || `hapvida:${operation.companyId}`;
    const payload = JSON.stringify({ username: companyCode, password });
    try {
      const encrypted = await protectWithDpapi(payload);
      await mkdir(this.config.secretsDir, { recursive: true, mode: 0o700 });
      await writeFile(path.join(this.config.secretsDir, `${safeFileName(credentialRef)}.credential.dpapi`), encrypted, { encoding: "utf8", mode: 0o600 });
    } catch {
      throw new AutomationError("CREDENTIAL_SAVE_FAILED", "Nao foi possivel salvar a credencial neste dispositivo.", {
        step: "remember_credentials",
        retryable: false,
      });
    }

    if (!this.config.databaseUrl || !operation.workspaceId) {
      return { rememberedOnDevice: true, metadataRegistered: false };
    }

    const pool = new Pool({
      connectionString: this.config.databaseUrl,
      max: 1,
      application_name: "kortex-worker-credential-save",
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
      return { rememberedOnDevice: true, metadataRegistered: true };
    } catch {
      // The encrypted local credential remains usable even when metadata registration is unavailable.
      return { rememberedOnDevice: true, metadataRegistered: false };
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
}
