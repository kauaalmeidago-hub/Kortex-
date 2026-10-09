import pg from "pg";
import { AutomationError } from "../errors.js";
import type { OperationRecord, PortalCredential } from "../types.js";
import type { SecretProvider } from "./SecretProvider.js";

const { Pool } = pg;
const eligible = new Set(["active", "needs_verification"]);
const vaultName = (id: string) => `koa-portal:${id}`;

function secureConnectionString(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid protocol");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) url.searchParams.set("sslmode", "verify-full");
    return url.toString();
  } catch {
    throw new AutomationError("CREDENTIAL_STORE_NOT_CONFIGURED", "A conexao do cofre nao esta configurada corretamente.");
  }
}

export class VaultCredentialStore implements SecretProvider {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string, private readonly localFallback?: SecretProvider) {
    this.pool = new Pool({ connectionString: secureConnectionString(databaseUrl), max: 2, connectionTimeoutMillis: 10000, query_timeout: 15000,
      application_name: "kortex-worker-credential-vault" });
    this.pool.on("error", () => { console.warn("Koa: conexao do cofre interrompida; nova tentativa disponivel."); });
  }
  async close() { await this.pool.end(); }

  async get(ref: string): Promise<PortalCredential> {
    const result = await this.pool.query<{ id: string; status: string; portal_login_code: string | null;
      vault_secret_id: string | null; name: string | null; decrypted_secret: string | null }>(
      `SELECT c.id, c.status, c.metadata->>'portalLoginCode' AS portal_login_code,
              s.vault_secret_id, v.name, v.decrypted_secret
       FROM public.automation_credentials c
       LEFT JOIN koa_private.automation_credential_secrets s ON s.credential_id = c.id
       LEFT JOIN vault.decrypted_secrets v ON v.id = s.vault_secret_id AND c.status IN ('active', 'needs_verification')
       WHERE c.credential_ref = $1`, [ref],
    ).catch(() => {
      throw new AutomationError("CREDENTIAL_STORE_UNAVAILABLE", "Nao foi possivel consultar o cofre de credenciais.", {
        step: "load_credentials", retryable: true,
      });
    });
    const row = result.rows[0];
    if (row && !eligible.has(row.status)) {
      throw new AutomationError("CREDENTIAL_NOT_VALIDATED", "O acesso salvo esta desativado ou precisa de revisao.");
    }
    if (!row?.vault_secret_id) {
      if (this.localFallback) return this.localFallback.get(ref);
      throw new AutomationError("CREDENTIAL_NOT_FOUND", "Credencial do portal nao encontrada no cofre.");
    }
    try {
      if (row.name !== vaultName(row.id) || !row.decrypted_secret) throw new Error("Invalid vault mapping");
      const parsed = JSON.parse(row.decrypted_secret) as Partial<PortalCredential>;
      if (typeof parsed.username !== "string" || !parsed.username.trim() ||
          typeof parsed.password !== "string" || !parsed.password ||
          (row.portal_login_code && parsed.username.trim() !== row.portal_login_code)) throw new Error("Invalid credential payload");
      return { username: parsed.username, password: parsed.password };
    } catch {
      throw new AutomationError("INVALID_CREDENTIAL", "A credencial protegida nao corresponde ao cadastro solicitado.");
    }
  }

  // The caller invokes this only after a validated portal login in the worker's context.
  async saveValidated(operation: OperationRecord, credential: PortalCredential) {
    if (operation.type !== "CARD_ISSUE" || credential.metadata?.rememberOnDevice !== true) {
      throw new AutomationError("CREDENTIAL_PERSISTENCE_NOT_AUTHORIZED", "O acesso nao foi autorizado para armazenamento.");
    }
    if (!operation.workspaceId || !operation.credentialRef || !credential.username.trim() || !credential.password) {
      throw new AutomationError("CREDENTIAL_SCOPE_INVALID", "Faltam dados para associar o acesso a empresa e operadora.");
    }
    const payload = JSON.stringify({ username: credential.username.trim(), password: credential.password });
    const metadata = { source: "validated_portal_login", store: "supabase_vault", portalLoginCode: credential.username.trim(),
      registeredVia: "koa_chat_reauth", lastValidatedAt: new Date().toISOString() };
    const client = await this.pool.connect().catch(() => {
      throw new AutomationError("CREDENTIAL_DATABASE_SAVE_FAILED", "Nao foi possivel salvar o acesso no cofre.");
    });
    try {
      await client.query("BEGIN");
      const company = await client.query("SELECT id FROM public.companies WHERE id = $1 AND workspace_id = $2", [operation.companyId, operation.workspaceId]);
      if (!company.rows.length) throw new AutomationError("CREDENTIAL_SCOPE_INVALID", "A empresa nao pertence ao workspace do pedido.");
      const registration = await client.query<{ id: string }>(
        `INSERT INTO public.automation_credentials (workspace_id, company_id, operator, credential_ref, label, username_hint, status, last_verified_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', now(), $7::jsonb)
         ON CONFLICT (credential_ref) DO UPDATE SET
           label = EXCLUDED.label, username_hint = EXCLUDED.username_hint,
           status = 'active'::public.automation_credential_status, last_verified_at = now(),
           metadata = public.automation_credentials.metadata || EXCLUDED.metadata, updated_at = now()
         WHERE public.automation_credentials.workspace_id = EXCLUDED.workspace_id
           AND public.automation_credentials.company_id = EXCLUDED.company_id
           AND public.automation_credentials.operator = EXCLUDED.operator
         RETURNING id`,
        [operation.workspaceId, operation.companyId, operation.portal, operation.credentialRef,
          `${operation.portal === "ndi" ? "NDI" : "Hapvida"} - ${operation.companyId}`,
          credential.username.trim().length <= 4 ? "***" : `${credential.username.trim().slice(0, 2)}***${credential.username.trim().slice(-2)}`,
          JSON.stringify(metadata)],
      );
      const id = registration.rows[0]?.id;
      if (!id) throw new AutomationError("CREDENTIAL_SCOPE_INVALID", "A referencia ja pertence a outro cadastro.");
      // The public upsert holds the credential row lock until COMMIT, serializing changes for this reference.
      const existing = await client.query<{ vault_secret_id: string }>(
        "SELECT vault_secret_id FROM koa_private.automation_credential_secrets WHERE credential_id = $1 FOR UPDATE", [id]);
      const secretId = existing.rows[0]?.vault_secret_id;
      if (secretId) {
        await client.query("SELECT vault.update_secret($1::uuid, $2::text, $3::text)", [secretId, payload, vaultName(id)]);
        await client.query("UPDATE koa_private.automation_credential_secrets SET updated_at = now() WHERE credential_id = $1", [id]);
      } else {
        const created = await client.query<{ id: string }>("SELECT vault.create_secret($1::text, $2::text, $3::text) AS id",
          [payload, vaultName(id), "Acesso de portal validado pelo worker Koa"]);
        if (!created.rows[0]?.id) throw new Error("Vault did not create a secret");
        await client.query("INSERT INTO koa_private.automation_credential_secrets (credential_id, vault_secret_id) VALUES ($1, $2)", [id, created.rows[0].id]);
      }
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof AutomationError) throw error;
      throw new AutomationError("CREDENTIAL_DATABASE_SAVE_FAILED", "Nao foi possivel salvar o acesso no cofre.");
    } finally { client.release(); }
  }
}
