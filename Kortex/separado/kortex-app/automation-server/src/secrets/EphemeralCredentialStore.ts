import type { PortalCredential } from "../types.js";
import type { SecretProvider } from "./SecretProvider.js";

interface EphemeralCredentialEntry {
  credential: PortalCredential;
  expiresAt: number;
}

export class EphemeralCredentialStore {
  private readonly entries = new Map<string, EphemeralCredentialEntry>();

  put(operationId: string, ref: string, credential: PortalCredential, ttlMs: number) {
    this.pruneExpired();
    this.entries.set(this.key(operationId, ref), {
      credential: {
        username: credential.username,
        password: credential.password,
        metadata: credential.metadata,
      },
      expiresAt: Date.now() + ttlMs,
    });
  }

  get(operationId: string, ref: string) {
    const key = this.key(operationId, ref);
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return {
      username: entry.credential.username,
      password: entry.credential.password,
      metadata: entry.credential.metadata,
    };
  }

  clear(operationId: string) {
    const prefix = `${operationId}:`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
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
  ) {}

  async get(ref: string) {
    return this.ephemeralCredentials.get(this.operationId, ref) ?? this.fallback.get(ref);
  }
}
