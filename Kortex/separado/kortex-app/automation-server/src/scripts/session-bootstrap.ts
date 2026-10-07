import { loadConfig } from "../config.js";
import { AutomationError } from "../errors.js";
import { LocalSessionBootstrapper } from "../browser/LocalSessionBootstrapper.js";
import { KoaBrowserProfileManager } from "../browser/KoaBrowserProfileManager.js";
import type { PortalName } from "../types.js";

function readPortalArg(): PortalName {
  const arg = process.argv.find((item) => item.startsWith("--operator=") || item.startsWith("--portal="));
  const value = arg?.split("=")[1]?.trim().toLowerCase();
  if (value === "ndi") return "ndi";
  return "hapvida";
}

const config = loadConfig();
const portal = readPortalArg();
const manager = new KoaBrowserProfileManager(config);
const bootstrapper = new LocalSessionBootstrapper(config, manager);

try {
  const result = await bootstrapper.bootstrap(portal);
  console.log(`Sessao ${result.portal} copiada para o storageState do Koa.`);
  console.log(`Cookies copiados: ${result.cookieCount}`);
  console.log(`Validacao headless: ${result.validated ? "OK" : "NAO VALIDADA"}`);

  if (!result.validated) {
    process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof AutomationError) {
    console.error(`${error.code}: ${error.message}`);
    if (error.safeDetails) console.error(error.safeDetails);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
}
