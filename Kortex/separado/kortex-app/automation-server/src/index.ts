import { loadConfig } from "./config.js";
import { BrowserManager } from "./browser/BrowserManager.js";
import { OperationRepository } from "./db/OperationRepository.js";
import { PostgresOperationRepository } from "./repositories/PostgresOperationRepository.js";
import { OperationEventBus } from "./events/EventBus.js";
import { OperationQueue } from "./queue/OperationQueue.js";
import { DpapiSecretProvider } from "./secrets/DpapiSecretProvider.js";
import { RemoteSecretProvider } from "./secrets/RemoteSecretProvider.js";
import { createServer } from "./server.js";
import { ExplicitCredentialResolver } from "./credentials/CredentialResolver.js";
import { PostgresCredentialResolver } from "./credentials/PostgresCredentialResolver.js";
import type { AutomationOperationRepository } from "./repositories/AutomationOperationRepository.js";
import type { PersistentAutomationQueueRepository } from "./repositories/AutomationOperationRepository.js";
import type { SecretProvider } from "./secrets/SecretProvider.js";
import type { CredentialResolver } from "./credentials/CredentialResolver.js";
import { PersistentWorker } from "./worker/PersistentWorker.js";
import { LocalArtifactStorage } from "./storage/LocalArtifactStorage.js";
import { SupabaseArtifactStorage } from "./storage/SupabaseArtifactStorage.js";
import type { ArtifactStorage } from "./storage/ArtifactStorage.js";
import { EphemeralCredentialStore } from "./secrets/EphemeralCredentialStore.js";

const config = loadConfig();
const repository: AutomationOperationRepository =
  config.repositoryMode === "postgres" && config.databaseUrl
    ? new PostgresOperationRepository(config.databaseUrl)
    : new OperationRepository(config.databasePath);
const eventBus = new OperationEventBus();
const browserManager = new BrowserManager(config);
const ephemeralCredentialStore = new EphemeralCredentialStore();
const secretProvider: SecretProvider =
  config.secretProviderMode === "remote" ? new RemoteSecretProvider() : new DpapiSecretProvider(config.secretsDir);
const artifactStorage: ArtifactStorage =
  config.supabaseUrl && config.supabaseSecretKey
    ? new SupabaseArtifactStorage(config.supabaseUrl, config.supabaseSecretKey, config.artifactBucket)
    : new LocalArtifactStorage(config.artifactsDir);
const credentialResolver: CredentialResolver =
  config.repositoryMode === "postgres" && config.databaseUrl
    ? new PostgresCredentialResolver(config.databaseUrl)
    : new ExplicitCredentialResolver();
const queue = new OperationQueue({
  config,
  repository,
  eventBus,
  browserManager,
  secretProvider,
  ephemeralCredentialStore,
  artifactStorage,
});

let persistentWorker: PersistentWorker | undefined;

if (config.repositoryMode === "postgres" && config.automationMode !== "api") {
  persistentWorker = new PersistentWorker({
    config,
    repository: repository as PersistentAutomationQueueRepository,
    eventBus,
    browserManager,
    secretProvider,
    ephemeralCredentialStore,
    artifactStorage,
  });
  void persistentWorker.run();
}

const server = await createServer({
  config,
  repository,
  eventBus,
  queue,
  credentialResolver,
  ephemeralCredentialStore,
});

const close = async () => {
  persistentWorker?.stop();
  await server.close().catch(() => undefined);
  await repository.close?.();
  await (credentialResolver as { close?: () => Promise<void> }).close?.();
};

process.once("SIGINT", () => void close().then(() => process.exit(0)));
process.once("SIGTERM", () => void close().then(() => process.exit(0)));

await server.listen({ host: config.host, port: config.port });

console.log(`Koa automation-server listening on http://${config.host}:${config.port}`);
console.log(`API token source: ${process.env.KOA_AUTOMATION_TOKEN ? "KOA_AUTOMATION_TOKEN" : "automation/secrets/local-api-token.txt"}`);
