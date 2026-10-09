import type { Browser, BrowserContext } from "playwright";
import type { AutomationConfig } from "../config.js";
import { AutomationError } from "../errors.js";
import type { PortalCredential, PortalName } from "../types.js";
import { HapvidaLoginPage } from "../workflows/hapvida/pageObjects/HapvidaLoginPage.js";
import type { KoaBrowserProfileManager } from "./KoaBrowserProfileManager.js";

function configureContext(context: BrowserContext, config: AutomationConfig) {
  context.setDefaultTimeout(config.actionTimeoutMs);
  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
}

export async function validateSavedPortalSession(
  config: AutomationConfig, browser: Browser, manager: KoaBrowserProfileManager, portal: PortalName, portalUrl: string,
) {
  const storageState = await manager.readStorageState(portal);
  if (!storageState) return false;

  const context = await browser.newContext({ storageState, viewport: { width: 1366, height: 900 } });
  try {
    configureContext(context, config);
    const page = await context.newPage();
    await page.goto(portalUrl, { waitUntil: "domcontentloaded" }).catch(() => {
      throw new AutomationError("PORTAL_AUTH_UNAVAILABLE", "O portal nao abriu para verificar a sessao salva.", {
        step: "check_portal_session", retryable: true,
      });
    });
    if (new URL(page.url()).hostname !== new URL(portalUrl).hostname ||
        !(await manager.validatePortalSession(portal, page))) return false;
    await manager.saveSession(context, portal);
    await manager.markSessionValidated(portal);
    return true;
  } finally { await context.close().catch(() => undefined); }
}

export async function refreshPortalSessionWithCredential(
  config: AutomationConfig, browser: Browser, manager: KoaBrowserProfileManager,
  portal: PortalName, portalUrl: string, credential: PortalCredential,
) {
  const label = portal === "ndi" ? "NDI" : "Hapvida";
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  try {
    configureContext(context, config);
    const page = await context.newPage();
    const loginPage = new HapvidaLoginPage(page, portalUrl, config.authTimeoutMs, label);
    await loginPage.open();
    await loginPage.login(credential);
    const valid = new URL(page.url()).hostname === new URL(portalUrl).hostname &&
      await manager.validatePortalSession(portal, page);
    if (!valid) {
      if (await loginPage.invalidIdentificationMessage().isVisible().catch(() => false)) {
        throw new AutomationError("AUTHENTICATION_FAILED", `Credencial ${label} nao aceita pelo portal.`, {
          safeDetails: "O portal retornou Identificacao invalida.", step: "authenticate",
        });
      }
      throw new AutomationError("PORTAL_AUTH_UNAVAILABLE", `O portal ${label} nao confirmou o acesso.`, {
        safeDetails: "O login nao apresentou a area autenticada esperada nem uma rejeicao de credencial reconhecida.",
        step: "authenticate", retryable: true,
      });
    }
    await manager.saveSession(context, portal);
    await manager.markSessionValidated(portal);
    return true;
  } finally { await context.close().catch(() => undefined); }
}
