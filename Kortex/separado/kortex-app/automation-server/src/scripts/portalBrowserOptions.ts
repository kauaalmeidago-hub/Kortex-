import type { AutomationConfig } from "../config.js";
import { AutomationError } from "../errors.js";
import type { PortalName } from "../types.js";

export function readBrowserArg(args: string[], name: string) {
  const inline = args.find(arg => arg.startsWith(`--${name}=`));
  const index = args.indexOf(`--${name}`);
  if (!inline && index < 0) return undefined;
  const value = (inline ? inline.slice(name.length + 3) : args[index + 1])?.trim();
  if (!value || value.startsWith("--")) {
    throw new AutomationError("INVALID_BROWSER_ARGUMENT", `Informe um valor para --${name}.`);
  }
  return value;
}

export function portalBrowserOptions(config: AutomationConfig, args: string[]) {
  const value = readBrowserArg(args, "operator")?.toLowerCase() ?? "hapvida";
  if (value !== "hapvida" && value !== "ndi") {
    throw new AutomationError("PORTAL_NOT_SUPPORTED", "Portal nao suportado por este comando.", {
      safeDetails: "Use --operator=hapvida ou --operator=ndi.",
    });
  }
  const portal: PortalName = value;
  const label = portal === "ndi" ? "NDI" : "Hapvida";
  const url = portal === "ndi" ? config.ndiCardPortalUrl : config.hapvidaCardPortalUrl ?? config.hapvidaPortalUrl;
  if (!url) {
    throw new AutomationError("PORTAL_URL_NOT_CONFIGURED", `URL do portal ${label} nao configurada.`);
  }
  return { portal, label, url, companyId: readBrowserArg(args, "company-id"), companyCode: readBrowserArg(args, "company-code") };
}
