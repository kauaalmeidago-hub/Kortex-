import type { OperationType, PortalName } from "../types.js";
import { AutomationError } from "../errors.js";

const INTERNAL_SCHEMES = new Set(["about:", "data:", "blob:"]);
const BLOCKED_AUTOMATION_HOSTS = new Set([
  "accounts.google.com",
  "mail.google.com",
  "passwords.google.com",
  "myaccount.google.com",
]);
// Required by the portal's own login handler. These are resource origins,
// not additional destinations for top-level browser navigation.
const RECAPTCHA_RESOURCE_HOSTS = new Set([
  "www.google.com",
  "www.gstatic.com",
  "recaptcha.google.com",
  "www.recaptcha.net",
]);

export class DomainAllowlist {
  private readonly hosts: Set<string>;

  constructor(hosts: string[]) {
    this.hosts = new Set(hosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  }

  isAllowed(rawUrl: string) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }

    if (INTERNAL_SCHEMES.has(parsed.protocol)) return true;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_AUTOMATION_HOSTS.has(host)) return false;

    return this.hosts.has(host);
  }

  assertAllowed(rawUrl: string, operationType?: OperationType) {
    if (this.isAllowed(rawUrl)) return;

    throw new AutomationError("DOMAIN_NOT_ALLOWED", "Dominio bloqueado para automacao do Koa.", {
      safeDetails: `A navegacao foi bloqueada pela allowlist local${operationType ? ` para ${operationType}` : ""}.`,
      step: "domain_allowlist",
      retryable: false,
    });
  }

  isAllowedCardRecaptchaResource(rawUrl: string, pageUrl: string, portal?: PortalName) {
    try {
      const resource = new URL(rawUrl);
      const page = new URL(pageUrl);
      return (
        page.protocol === "https:" &&
        ["webhap.hapvida.com.br", "sigo.sh.srv.br"].includes(page.hostname) &&
        (!portal || page.hostname === (portal === "ndi" ? "sigo.sh.srv.br" : "webhap.hapvida.com.br")) &&
        this.isAllowed(pageUrl) &&
        resource.protocol === "https:" &&
        !resource.username && !resource.password && !resource.port &&
        RECAPTCHA_RESOURCE_HOSTS.has(resource.hostname) &&
        resource.pathname.startsWith("/recaptcha/")
      );
    } catch {
      return false;
    }
  }
}

