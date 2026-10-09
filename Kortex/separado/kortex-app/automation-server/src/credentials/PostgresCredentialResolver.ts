import pg from "pg";
import type { CredentialResolver } from "./CredentialResolver.js";
import { credentialRefForLogin } from "./credentialIdentity.js";
import type { PortalName } from "../types.js";
import { AutomationError } from "../errors.js";

const { Pool } = pg;

export class PostgresCredentialResolver implements CredentialResolver {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      connectionTimeoutMillis: 10_000,
      query_timeout: 15_000,
      application_name: "kortex-credential-resolver",
    });
    this.pool.on("error", () => { console.warn("Koa: conexao de credenciais interrompida; reconexao automatica ativa."); });
  }

  async close() {
    await this.pool.end();
  }

  async preferredCardPortal(input: { companyId: string; portalLoginCode: string }): Promise<PortalName | undefined> {
    if (!input.portalLoginCode.trim()) return undefined;
    const result = await this.pool.query<{ operator: string }>(
      `SELECT operator
       FROM public.automation_credentials
       WHERE company_id = $1
         AND metadata->>'portalLoginCode' = $2
         AND operator IN ('hapvida', 'ndi')
         AND status = 'active'
         AND last_verified_at IS NOT NULL
       ORDER BY last_verified_at DESC, created_at DESC
       LIMIT 1`,
      [input.companyId, input.portalLoginCode.trim()],
    ).catch(() => {
      throw new AutomationError("CREDENTIAL_STORE_UNAVAILABLE", "Nao foi possivel consultar os acessos validados da empresa.", {
        step: "load_credential", retryable: true,
      });
    });
    const operator = result.rows[0]?.operator;
    return operator === "hapvida" || operator === "ndi" ? operator : undefined;
  }

  async resolve(input: { companyId: string; operator: string; portalLoginCode?: string }) {
    const result = await this.pool.query<{
      id: string;
      credential_ref: string;
    }>(
      `SELECT id, credential_ref
       FROM public.automation_credentials
       WHERE company_id = $1
         AND operator = $2
         AND ($3::text IS NULL OR metadata->>'portalLoginCode' = $3::text)
         AND status IN ('active', 'needs_verification')
       ORDER BY (status = 'active') DESC, last_verified_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [input.companyId, input.operator, input.portalLoginCode?.trim() || null],
    );

    const credential = result.rows[0];
    if (!credential) {
      return {
        credentialRef: credentialRefForLogin(input.companyId, input.operator, input.portalLoginCode),
      };
    }

    return {
      credentialId: credential.id,
      credentialRef: credential.credential_ref,
    };
  }
}

