import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { chromium } from "playwright";
import { loadConfig } from "../config.js";
import { AutomationError, createReauthRequiredError } from "../errors.js";
import { KoaBrowserProfileManager } from "../browser/KoaBrowserProfileManager.js";
import { refreshPortalSessionWithCredential, validateSavedPortalSession } from "../browser/PortalSessionCheck.js";
import { DomainAllowlist } from "../security/DomainAllowlist.js";
import { createSecretProvider } from "../secrets/createSecretProvider.js";
import { PostgresCredentialResolver } from "../credentials/PostgresCredentialResolver.js";
import type { PortalName } from "../types.js";
import { portalBrowserOptions } from "./portalBrowserOptions.js";

const { Pool } = pg;

export async function resolveCompanyId(databaseUrl: string, portal: PortalName, companyCode?: string, explicitCompanyId?: string) {
  if (explicitCompanyId) return explicitCompanyId;
  const label = portal === "ndi" ? "NDI" : "Hapvida";
  const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "kortex-browser-check" });
  try {
    const result = await pool.query<{ company_id: string }>(
      `SELECT DISTINCT company_id
       FROM public.automation_credentials
       WHERE operator = $1
         AND status IN ('active', 'needs_verification')
         AND ($2::text IS NULL OR metadata->>'portalLoginCode' = $2::text)
       ORDER BY company_id
       LIMIT 2`,
      [portal, companyCode ?? null],
    );
    if (result.rows.length === 1) return result.rows[0]!.company_id;
    if (result.rows.length > 1) {
      throw new AutomationError("COMPANY_REQUIRED_FOR_SESSION_REFRESH", `Informe a empresa para validar a sessao ${label}.`, {
        safeDetails: "Use --company-id e, quando houver varios codigos, --company-code.", retryable: true,
      });
    }
    throw createReauthRequiredError(`Nenhuma credencial ${label} elegivel foi encontrada. Informe o acesso no formulario do chat e use Salvar acesso para as proximas emissoes.`);
  } finally { await pool.end(); }
}

export async function runPortalBrowserCheck(args = process.argv.slice(2)) {
  const config = loadConfig();
  const { portal, label, url, companyId: explicitCompanyId, companyCode } = portalBrowserOptions(config, args);
  new DomainAllowlist(config.allowedAutomationHosts).assertAllowed(url);
  const manager = new KoaBrowserProfileManager(config);
  const browser = await chromium.launch({ channel: config.browserChannel, headless: true });
  try {
    // A general saved session does not prove access to a specifically requested company/code.
    if (!explicitCompanyId && !companyCode && await validateSavedPortalSession(config, browser, manager, portal, url)) {
      console.log("SESSION_VALID");
      return;
    }
    if (!explicitCompanyId && !companyCode) await manager.invalidateSession(portal);
    if (!config.databaseUrl) {
      throw createReauthRequiredError(`A sessao ${label} nao esta validada e falta DATABASE_URL para localizar a credencial segura.`);
    }
    const companyId = await resolveCompanyId(config.databaseUrl, portal, companyCode, explicitCompanyId);
    const secrets = createSecretProvider(config);
    let resolver: PostgresCredentialResolver | undefined;
    try {
      resolver = new PostgresCredentialResolver(config.databaseUrl);
      const resolved = await resolver.resolve({ companyId, operator: portal, portalLoginCode: companyCode });
      const credential = await secrets.get(resolved.credentialRef).catch(error => {
        if (error instanceof AutomationError && error.code === "CREDENTIAL_NOT_FOUND") {
          throw createReauthRequiredError(`Cadastre o acesso ${label} no formulario do chat com Salvar acesso, ou valide a sessao com browser:onboard -- --operator=${portal}.`);
        }
        throw error;
      });
      if (companyCode && credential.username.trim() !== companyCode) {
        throw createReauthRequiredError(`A credencial ${label} salva pertence a outro codigo de empresa.`);
      }
      await refreshPortalSessionWithCredential(config, browser, manager, portal, url, credential);
      console.log("SESSION_REFRESHED");
      console.log("SESSION_VALID");
    } finally { try { await resolver?.close(); } finally { await secrets.close?.(); } }
  } finally { await browser.close().catch(() => undefined); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPortalBrowserCheck().catch(error => {
    console.error(error instanceof AutomationError ? error.code : "SESSION_CHECK_FAILED");
    process.exitCode = 1;
  });
}
