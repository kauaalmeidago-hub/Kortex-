import type { BrowserContext, Page } from "playwright";
import type { KoaBrowserProfileManager } from "./KoaBrowserProfileManager.js";

export class SessionManager {
  constructor(private readonly profileManager: KoaBrowserProfileManager) {}

  getSession(portal: "hapvida") {
    return {
      portal,
      storageStatePath: this.profileManager.getAuthStatePath(portal),
      exists: this.profileManager.hasAuthState(portal),
    };
  }

  saveSession(context: BrowserContext, portal: "hapvida") {
    return this.profileManager.saveSession(context, portal);
  }

  validateSession(portal: "hapvida", page: Page) {
    return this.profileManager.validatePortalSession(portal, page);
  }

  invalidateSession(portal: "hapvida") {
    return this.profileManager.invalidateSession(portal);
  }
}
