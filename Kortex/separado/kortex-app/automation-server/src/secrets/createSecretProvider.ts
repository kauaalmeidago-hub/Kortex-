import type { AutomationConfig } from "../config.js";
import { DpapiSecretProvider } from "./DpapiSecretProvider.js";
import { RemoteSecretProvider } from "./RemoteSecretProvider.js";
import type { SecretProvider } from "./SecretProvider.js";
import { VaultCredentialStore } from "./VaultCredentialStore.js";

export function createSecretProvider(config: AutomationConfig): SecretProvider & { close?: () => Promise<void> } {
  const local = new DpapiSecretProvider(config.secretsDir);
  if (config.databaseUrl && config.secretProviderMode !== "mock") {
    return new VaultCredentialStore(config.databaseUrl, config.secretProviderMode === "remote" ? undefined : local);
  }
  return config.secretProviderMode === "remote" ? new RemoteSecretProvider() : local;
}
