import { loadConfig } from "../config.js";
import { chromium } from "playwright";
import { KoaBrowserProfileManager } from "../browser/KoaBrowserProfileManager.js";
import { DomainAllowlist } from "../security/DomainAllowlist.js";

const config = loadConfig();
const manager = new KoaBrowserProfileManager(config);
const portalUrl = config.hapvidaCardPortalUrl ?? config.hapvidaPortalUrl;

if (!portalUrl) {
  console.error("PORTAL_URL_NOT_CONFIGURED");
  process.exit(1);
}

new DomainAllowlist(config.allowedAutomationHosts).assertAllowed(portalUrl);

const storageState = await manager.readStorageState("hapvida");
if (!storageState) {
  console.error("SESSION_NOT_FOUND");
  process.exit(1);
}

const browser = await chromium.launch({
  channel: config.browserChannel,
  headless: true,
});

try {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(portalUrl, { waitUntil: "domcontentloaded" });
  const valid = await manager.validatePortalSession("hapvida", page);
  if (!valid) {
    console.error("SESSION_EXPIRED");
    process.exitCode = 1;
  } else {
    await manager.saveSession(context, "hapvida");
    console.log("SESSION_VALID");
  }
} finally {
  await browser.close().catch(() => undefined);
}
