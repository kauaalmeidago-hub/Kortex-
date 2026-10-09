import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../config.js";
import { AutomationError, createReauthRequiredError } from "../errors.js";
import { KoaBrowserProfileManager } from "../browser/KoaBrowserProfileManager.js";
import { DomainAllowlist } from "../security/DomainAllowlist.js";
import { portalBrowserOptions } from "./portalBrowserOptions.js";

export async function runPortalOnboarding(args = process.argv.slice(2)) {
  const config = { ...loadConfig(), browserMode: "onboarding" as const, headless: false, browserDebug: true };
  const { portal, label, url } = portalBrowserOptions(config, args);
  new DomainAllowlist(config.allowedAutomationHosts).assertAllowed(url);
  const manager = new KoaBrowserProfileManager(config);
  const { context, lock } = await manager.launchPersistentContext({ ownerId: `browser:onboard:${portal}`, headless: false });
  try {
    await manager.writeStatus({ onboardingOpenedAt: new Date().toISOString() });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    console.log(`Chrome exclusivo do Koa aberto para ${label}.`);
    console.log(`Perfil: ${manager.profileDir}`);
    console.log(`Faca login manualmente no portal ${label} dentro desta janela.`);
    const rl = createInterface({ input, output });
    try {
      await rl.question("Depois que o portal estiver autenticado, pressione Enter para validar e salvar a sessao...");
    } finally { rl.close(); }
    if (!(await manager.validatePortalSession(portal, page))) {
      throw createReauthRequiredError(`A sessao ${label} nao foi confirmada; conclua o login no portal e tente novamente.`);
    }
    await manager.saveSession(context, portal);
    await manager.markSessionValidated(portal);
    console.log(`Sessao ${label} validada e salva de forma protegida neste computador.`);
    console.log("SESSION_VALID");
  } finally {
    // Save only after validation above; a failed NDI login must never overwrite Hapvida state.
    await manager.releasePersistentContext(context, lock, false, portal);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPortalOnboarding().catch(error => {
    console.error(error instanceof AutomationError ? error.code : "SESSION_ONBOARDING_FAILED");
    process.exitCode = 1;
  });
}
