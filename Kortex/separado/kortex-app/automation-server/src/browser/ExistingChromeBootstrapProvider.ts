import { chromium, type Browser } from "playwright";
import type { AutomationConfig } from "../config.js";

export class ExistingChromeBootstrapProvider {
  constructor(private readonly config: AutomationConfig) {}

  get cdpUrl() {
    return this.config.existingChromeCdpUrl;
  }

  async isAvailable() {
    if (!this.cdpUrl) return false;

    try {
      const response = await fetch(new URL("/json/version", this.cdpUrl), {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async connect() {
    if (!this.cdpUrl) {
      throw new Error("KOA_EXISTING_CHROME_CDP_URL nao configurado.");
    }

    return chromium.connectOverCDP(this.cdpUrl);
  }

  async disconnect(_browser: Browser) {
    // Playwright does not expose a public CDP-only disconnect here. Do not call
    // browser.close(), because this provider is attached to Chrome Trabalho.
  }
}
