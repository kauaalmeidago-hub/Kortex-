import pg from "pg";
import type { CredentialResolver } from "./CredentialResolver.js";

const { Pool } = pg;

export class PostgresCredentialResolver implements CredentialResolver {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      application_name: "kortex-credential-resolver",
    });
  }

  async close() {
    await this.pool.end();
  }

  async resolve(input: { companyId: string; operator: string }) {
    const result = await this.pool.query<{
      id: string;
      credential_ref: string;
    }>(
      `SELECT id, credential_ref
       FROM public.automation_credentials
       WHERE company_id = $1
         AND operator = $2
         AND status = 'active'
       ORDER BY last_verified_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [input.companyId, input.operator],
    );

    const credential = result.rows[0];
    if (!credential) {
      return {
        credentialRef: `${input.operator}:${input.companyId}`,
      };
    }

    return {
      credentialId: credential.id,
      credentialRef: credential.credential_ref,
    };
  }
}
