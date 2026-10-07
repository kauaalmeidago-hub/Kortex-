import { AutomationError } from "../errors.js";
import type { PortalCredential } from "../types.js";
import type { SecretProvider } from "./SecretProvider.js";

export class RemoteSecretProvider implements SecretProvider {
  async get(_ref: string): Promise<PortalCredential> {
    throw new AutomationError("REMOTE_SECRET_PROVIDER_NOT_CONFIGURED", "SecretProvider remoto nao configurado.", {
      safeDetails: "Configure Supabase Vault ou outro secret manager antes de executar automacoes cloud.",
      retryable: false,
    });
  }
}
