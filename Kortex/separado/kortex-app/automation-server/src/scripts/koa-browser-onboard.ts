import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../config.js";
import { KoaBrowserProfileManager } from "../browser/KoaBrowserProfileManager.js";

const config = {
  ...loadConfig(),
  browserMode: "onboarding" as const,
  headless: false,
  browserDebug: true,
};

const manager = new KoaBrowserProfileManager(config);
const { context, lock } = await manager.launchPersistentContext({
  ownerId: "browser:onboard",
  headless: false,
});

try {
  await manager.writeStatus({ onboardingOpenedAt: new Date().toISOString() });
  const page = context.pages()[0] ?? (await context.newPage());
  if (config.hapvidaPortalUrl) {
    await page.goto(config.hapvidaPortalUrl, { waitUntil: "domcontentloaded" });
  }

  console.log("");
  console.log("Chrome exclusivo do Koa aberto.");
  console.log(`Perfil: ${manager.profileDir}`);
  console.log("Faça login manualmente na Conta Google de Relacionamento e/ou no portal Hapvida dentro desta janela.");
  console.log("O automation-server nao lê senhas do Chrome e nao acessa passwords.google.com.");
  console.log("");

  const rl = createInterface({ input, output });
  await rl.question("Depois que o portal estiver autenticado, pressione Enter para validar e salvar a sessão...");
  rl.close();

  const valid = await manager.validatePortalSession("hapvida", page).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    return false;
  });

  if (!valid) {
    console.error("Sessao Hapvida nao validada. Configure HAPVIDA_AUTHENTICATED_SELECTOR com um seletor autenticado real e tente novamente.");
    process.exitCode = 1;
  } else {
    await manager.saveSession(context, "hapvida");
    console.log("Sessao Hapvida validada e storageState salvo em automation/.auth/.");
  }
} finally {
  await manager.releasePersistentContext(context, lock, true);
}
