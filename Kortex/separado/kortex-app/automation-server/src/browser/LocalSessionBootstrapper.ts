import { chromium, type BrowserContext } from "playwright";
import type { AutomationConfig } from "../config.js";
import { AutomationError } from "../errors.js";
import { DomainAllowlist } from "../security/DomainAllowlist.js";
import type { PortalName } from "../types.js";
import { ExistingChromeBootstrapProvider } from "./ExistingChromeBootstrapProvider.js";
import type { KoaBrowserProfileManager } from "./KoaBrowserProfileManager.js";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

interface BootstrapResult {
  portal: PortalName;
  storageStatePath: string;
  cookieCount: number;
  validated: boolean;
}

function portalUrl(config: AutomationConfig, portal: PortalName) {
  if (portal === "hapvida") return config.hapvidaCardPortalUrl ?? config.hapvidaPortalUrl;
  if (portal === "ndi") return config.ndiCardPortalUrl;
  return undefined;
}

export class LocalSessionBootstrapper {
  private readonly allowlist: DomainAllowlist;
  private readonly existingChromeProvider: ExistingChromeBootstrapProvider;

  constructor(
    private readonly config: AutomationConfig,
    private readonly profileManager: KoaBrowserProfileManager,
  ) {
    this.allowlist = new DomainAllowlist(config.allowedAutomationHosts);
    this.existingChromeProvider = new ExistingChromeBootstrapProvider(config);
  }

  async bootstrap(portal: PortalName = "hapvida"): Promise<BootstrapResult> {
    const url = portalUrl(this.config, portal);
    if (!url) {
      throw new AutomationError("PORTAL_URL_NOT_CONFIGURED", "URL do portal nao configurada.", {
        safeDetails: `Configure a URL do portal ${portal}.`,
        retryable: false,
      });
    }

    this.allowlist.assertAllowed(url);

    if (!this.config.existingChromeCdpUrl) {
      throw new AutomationError("BOOTSTRAP_NOT_CONFIGURED", "Chrome autorizado para bootstrap nao configurado.", {
        safeDetails:
          "Defina KOA_EXISTING_CHROME_CDP_URL apontando para um Chrome iniciado manualmente com remote debugging somente durante o bootstrap.",
        retryable: true,
      });
    }

    if (!(await this.existingChromeProvider.isAvailable())) {
      throw new AutomationError("BOOTSTRAP_NOT_AVAILABLE", "Chrome autorizado para bootstrap nao esta disponivel.", {
        safeDetails:
          "Inicie o Chrome de Relacionamento com remote debugging local e confirme KOA_EXISTING_CHROME_CDP_URL antes de executar session:bootstrap.",
        retryable: true,
      });
    }

    const browser = await this.existingChromeProvider.connect();
    try {
      const context = browser.contexts()[0];
      if (!context) {
        throw new AutomationError("BOOTSTRAP_CONTEXT_NOT_FOUND", "Contexto do Chrome autorizado nao encontrado.", {
          safeDetails: "Abra o Chrome autorizado antes de executar session:bootstrap.",
          retryable: true,
        });
      }

      const cookies = await context.cookies(url);
      if (cookies.length === 0) {
        throw new AutomationError("REAUTH_REQUIRED", "Sessao do portal precisa de reautenticacao.", {
          safeDetails: "Nenhum cookie do portal permitido foi encontrado no Chrome autorizado.",
          retryable: true,
        });
      }

      const storageState: StorageState = { cookies, origins: [] };
      await this.profileManager.saveStorageState(portal, storageState);

      const validated = await this.validateStorageState(portal, url, storageState);
      await this.profileManager.writeStatus({
        initialized: true,
        ...(portal === "ndi" ? { ndiSessionValidated: validated } : { hapvidaSessionValidated: validated }),
        lastValidatedAt: validated ? new Date().toISOString() : undefined,
        lastValidationError: validated ? undefined : "Sessao copiada, mas nao validada em headless.",
      });

      return {
        portal,
        storageStatePath: this.profileManager.getProtectedAuthStatePath(portal),
        cookieCount: cookies.length,
        validated,
      };
    } finally {
      await this.existingChromeProvider.disconnect(browser).catch(() => undefined);
    }
  }

  private async validateStorageState(portal: PortalName, url: string, storageState: StorageState) {
    const browser = await chromium.launch({
      channel: this.config.browserChannel,
      headless: true,
    });

    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({
        storageState,
        viewport: { width: 1366, height: 900 },
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return await this.profileManager.validatePortalSession(portal, page);
    } catch {
      return false;
    } finally {
      await context?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }
}

