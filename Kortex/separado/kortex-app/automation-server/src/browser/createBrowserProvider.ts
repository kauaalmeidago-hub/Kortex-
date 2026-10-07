import type { AutomationConfig } from "../config.js";
import type { BrowserProvider } from "./BrowserProvider.js";
import { HeadlessChromiumBrowserProvider } from "./HeadlessChromiumBrowserProvider.js";
import { HeadlessLocalBrowserProvider } from "./HeadlessLocalBrowserProvider.js";
import type { KoaBrowserProfileManager } from "./KoaBrowserProfileManager.js";
import { PersistentChromeBrowserProvider } from "./PersistentChromeBrowserProvider.js";

export function createBrowserProvider(config: AutomationConfig, profileManager: KoaBrowserProfileManager): BrowserProvider {
  if (config.browserMode === "background" && config.browserProvider === "persistent-chrome") {
    throw new Error("KOA_BROWSER_MODE=background exige BROWSER_PROVIDER=headless-local ou headless-chromium.");
  }

  if (config.browserProvider === "headless-local") {
    return new HeadlessLocalBrowserProvider(config, profileManager);
  }

  if (config.browserProvider === "headless-chromium") {
    return new HeadlessChromiumBrowserProvider(config, profileManager);
  }

  return new PersistentChromeBrowserProvider(config, profileManager);
}
