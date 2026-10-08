import pg from "pg";
import { chromium, type BrowserContext } from "playwright";
import { loadConfig } from "../config.js";
import { AutomationError, createReauthRequiredError } from "../errors.js";
import { KoaBrowserProfileManager } from "../browser/KoaBrowserProfileManager.js";
import { DomainAllowlist } from "../security/DomainAllowlist.js";
import { DpapiSecretProvider } from "../secrets/DpapiSecretProvider.js";
import { PostgresCredentialResolver } from "../credentials/PostgresCredentialResolver.js";
import { HapvidaLoginPage } from "../workflows/hapvida/pageObjects/HapvidaLoginPage.js";

const { Pool } = pg;

function readArg(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.slice(2).find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || undefined;

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1]?.trim() || undefined;
  return undefined;
}

async function resolveCompanyId(databaseUrl: string, explicitCompanyId?: string) {
  if (explicitCompanyId) return explicitCompanyId;

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    application_name: "kortex-browser-check",
  });

  try {
    const result = await pool.query<{ company_id: string }>(
      `SELECT DISTINCT company_id
       FROM public.automation_credentials
       WHERE operator = 'hapvida'
         AND status IN ('active', 'needs_verification')
       ORDER BY company_id
       LIMIT 2`,
    );

    if (result.rows.length === 1) return result.rows[0]!.company_id;
    if (result.rows.length > 1) {
      throw new AutomationError(
        "COMPANY_REQUIRED_FOR_SESSION_REFRESH",
        "Informe a empresa para validar a sessao Hapvida.",
        {
          safeDetails: "Existe mais de uma credencial Hapvida elegivel para renovacao da sessao.",
          retryable: true,
        },
      );
    }

    throw createReauthRequiredError("Nenhuma credencial Hapvida ativa foi encontrada para renovar a sessao.");
  } finally {
    await pool.end();
  }
}

async function validateSavedSession(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  manager: KoaBrowserProfileManager,
  portalUrl: string,
) {
  const storageState = await manager.readStorageState("hapvida");
  if (!storageState) return false;

  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      storageState,
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(portalUrl, { waitUntil: "domcontentloaded" });

    const valid = await manager.validatePortalSession("hapvida", page);
    if (!valid) return false;

    await manager.saveSession(context, "hapvida");
    await manager.markSessionValidated("hapvida");
    return true;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

async function refreshWithSecureCredential(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  manager: KoaBrowserProfileManager,
  portalUrl: string,
  companyId: string,
) {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw createReauthRequiredError("DATABASE_URL e necessaria para localizar a credencial Hapvida segura.");
  }

  const resolver = new PostgresCredentialResolver(config.databaseUrl);
  try {
    const resolved = await resolver.resolve({ companyId, operator: "hapvida" });
    const secretProvider = new DpapiSecretProvider(config.secretsDir);
    const credential = await secretProvider.get(resolved.credentialRef);

    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await context.newPage();
      const loginPage = new HapvidaLoginPage(page, portalUrl);

      await loginPage.open();
      await loginPage.login(credential);

      const valid = await manager.validatePortalSession("hapvida", page);
      if (!valid) {
        if (await loginPage.invalidIdentificationMessage().isVisible().catch(() => false)) {
          throw new AutomationError("AUTHENTICATION_FAILED", "Credencial Hapvida nao aceita pelo portal.", {
            safeDetails: "O portal retornou Identificacao invalida.",
            step: "authenticate",
            retryable: false,
          });
        }

        if (await loginPage.passwordStillVisible()) {
          throw new AutomationError("AUTHENTICATION_FAILED", "Credencial Hapvida nao confirmou acesso ao portal.", {
            safeDetails: "O portal permaneceu na tela de login apos a autenticacao.",
            step: "authenticate",
            retryable: false,
          });
        }

        throw new AutomationError("SESSION_REFRESH_FAILED", "Nao foi possivel renovar a sessao Hapvida.", {
          safeDetails: "O login foi executado, mas o portal nao confirmou o estado autenticado esperado.",
          step: "authenticate",
          retryable: true,
        });
      }

      await manager.saveSession(context, "hapvida");
      await manager.markSessionValidated("hapvida");
      return true;
    } finally {
      await context?.close().catch(() => undefined);
    }
  } finally {
    await resolver.close();
  }
}

async function main() {
  const operator = readArg("operator") ?? "hapvida";
  if (operator !== "hapvida") {
    throw new AutomationError("PORTAL_NOT_SUPPORTED", "Portal nao suportado por este check.", {
      safeDetails: "Use --operator=hapvida.",
      retryable: false,
    });
  }

  const config = loadConfig();
  const manager = new KoaBrowserProfileManager(config);
  const portalUrl = config.hapvidaCardPortalUrl ?? config.hapvidaPortalUrl;

  if (!portalUrl) {
    throw new AutomationError("PORTAL_URL_NOT_CONFIGURED", "URL do portal Hapvida nao configurada.", {
      retryable: false,
    });
  }

  new DomainAllowlist(config.allowedAutomationHosts).assertAllowed(portalUrl);

  const browser = await chromium.launch({
    channel: config.browserChannel,
    headless: true,
  });

  try {
    if (await validateSavedSession(browser, manager, portalUrl)) {
      console.log("SESSION_VALID");
      return;
    }

    await manager.invalidateSession("hapvida");

    if (!config.databaseUrl) {
      throw createReauthRequiredError("Sessao expirada e DATABASE_URL nao esta configurada para renovar pela credencial segura.");
    }

    const companyId = await resolveCompanyId(config.databaseUrl, readArg("company-id"));
    await refreshWithSecureCredential(browser, manager, portalUrl, companyId);

    console.log("SESSION_REFRESHED");
    console.log("SESSION_VALID");
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  if (error instanceof AutomationError) {
    console.error(error.code);
  } else {
    console.error("SESSION_CHECK_FAILED");
  }
  process.exitCode = 1;
});
