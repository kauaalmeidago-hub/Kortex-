import type { BrowserManager } from "../browser/BrowserManager.js";
import type { AutomationConfig } from "../config.js";
import type { AutomationOperationRepository } from "../repositories/AutomationOperationRepository.js";
import type { SecretProvider } from "../secrets/SecretProvider.js";
import type { ArtifactStorage } from "../storage/ArtifactStorage.js";
import type { OperationEvent, OperationRecord, OperationStatus } from "../types.js";
import type { CredentialResolver } from "../credentials/CredentialResolver.js";

export interface WorkflowContext {
  config: AutomationConfig;
  repository: AutomationOperationRepository;
  browserManager: BrowserManager;
  secretProvider: SecretProvider;
  credentialResolver?: CredentialResolver;
  artifactStorage: ArtifactStorage;
  updateStatus: (status: OperationStatus, step: string, data?: Record<string, unknown>) => Promise<OperationRecord | undefined>;
  emitEvent: (event: Omit<OperationEvent, "createdAt"> & { createdAt?: string }) => Promise<OperationEvent | undefined>;
}

