import type { PortalCredential } from "../types.js";
import type { SecretProvider } from "./SecretProvider.js";

interface EphemeralCredentialEntry {
  credential: PortalCredential;
  expiresAt: number;
  generation: number;
}

export class EphemeralCredentialStore {
  private readonly entries = new Map<string, EphemeralCredentialEntry>();
  private generation = 0;

  snapshotGeneration() {
    return this.generation;
  }

  put(operationId: string, ref: string, credential: PortalCredential, ttlMs: number) {
    this.pruneExpired();
    const generation = ++this.generation;
    this.entries.set(this.key(operationId, ref), {
      credential: {
        username: credential.username,
        password: credential.password,
        metadata: credential.metadata ? { ...credential.metadata } : undefined,
      },
      expiresAt: Date.now() + ttlMs,
      generation,
    });
    return generation;
  }

  get(operationId: string, ref: string, throughGeneration = Number.POSITIVE_INFINITY) {
    const key = this.key(operationId, ref);
    const entry = this.entries.get(key);
    if (!entry || entry.generation > throughGeneration) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return {
      username: entry.credential.username,
      password: entry.credential.password,
      metadata: entry.credential.metadata ? { ...entry.credential.metadata } : undefined,
    };
  }

  consume(operationId: string, ref: string, throughGeneration = Number.POSITIVE_INFINITY) {
    const credential = this.get(operationId, ref, throughGeneration);
    if (credential) this.entries.delete(this.key(operationId, ref));
    return credential;
  }

  clear(operationId: string, throughGeneration = Number.POSITIVE_INFINITY) {
    const prefix = `${operationId}:`;
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix) && entry.generation <= throughGeneration) this.entries.delete(key);
    }
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private key(operationId: string, ref: string) {
    return `${operationId}:${ref}`;
  }
}

export class OperationScopedSecretProvider implements SecretProvider {
  constructor(
    private readonly operationId: string,
    private readonly ephemeralCredentials: EphemeralCredentialStore,
    private readonly fallback: SecretProvider,
    private readonly generation = ephemeralCredentials.snapshotGeneration(),
  ) {}

  async get(ref: string) {
    return this.ephemeralCredentials.consume(this.operationId, ref, this.generation) ?? this.fallback.get(ref);
  }

  takeAutomaticSearchCredential(ref: string) {
    const credential = this.ephemeralCredentials.get(this.operationId, ref, this.generation);
    if (credential?.metadata?.autoPortalCredential !== true) return undefined;
    return this.ephemeralCredentials.consume(this.operationId, ref, this.generation);
  }
}

