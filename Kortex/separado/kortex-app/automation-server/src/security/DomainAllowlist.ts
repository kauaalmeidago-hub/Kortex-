import type { OperationType } from "../types.js";
import { AutomationError } from "../errors.js";

const INTERNAL_SCHEMES = new Set(["about:", "data:", "blob:"]);
const BLOCKED_AUTOMATION_HOSTS = new Set([
  "accounts.google.com",
  "mail.google.com",
  "passwords.google.com",
  "myaccount.google.com",
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
}
