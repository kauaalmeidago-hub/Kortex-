import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AutomationConfig } from "../config.js";
import { AutomationError } from "../errors.js";
import type { OperationRecord, PortalCredential } from "../types.js";
import { protectWithDpapi } from "../security/DpapiProtector.js";
import { VaultCredentialStore } from "../secrets/VaultCredentialStore.js";

// Called only after the CARD_ISSUE worker has validated the actual portal session.
export class RememberedCredentialService {
  constructor(private readonly config: AutomationConfig) {}

  async saveValidatedCredential(operation: OperationRecord, credential: PortalCredential) {
    if (credential.metadata?.rememberOnDevice !== true) {
      return { rememberedOnDevice: false, metadataRegistered: false, storedInDatabase: false };
    }
    if (operation.type !== "CARD_ISSUE") {
      throw new AutomationError("AUTHENTICATION_NOT_SUPPORTED", "Persistencia de credencial indisponivel para esta operacao.");
    }
    let storedInDatabase = false;
    if (this.config.databaseUrl && operation.workspaceId) {
      let store: VaultCredentialStore | undefined;
      try {
        store = new VaultCredentialStore(this.config.databaseUrl);
        storedInDatabase = await store.saveValidated(operation, credential);
      }
      catch (error) {
        // An ownership mismatch must never overwrite another access's local backup.
        if (error instanceof AutomationError && error.code === "CREDENTIAL_SCOPE_INVALID") throw error;
        // Report a database failure without leaking the original error or password.
      }
      finally { await store?.close().catch(() => undefined); }
    }
    const payload = JSON.stringify({ username: credential.username, password: credential.password });
    let rememberedOnDevice = false;
    try {
      const encrypted = await protectWithDpapi(payload);
      await mkdir(this.config.secretsDir, { recursive: true, mode: 0o700 });
      const fileName = Buffer.from(operation.credentialRef, "utf8").toString("base64url") + ".credential.dpapi";
      await writeFile(path.join(this.config.secretsDir, fileName), encrypted, { encoding: "utf8", mode: 0o600 });
      rememberedOnDevice = true;
    } catch {
      // Vault can retain validated access even when local DPAPI is unavailable.
    }
    if (!rememberedOnDevice && !storedInDatabase) {
      throw new AutomationError("CREDENTIAL_SAVE_FAILED", "Nao foi possivel salvar o acesso para as proximas emissoes.", {
        step: "remember_credentials", retryable: false,
      });
    }
    return { rememberedOnDevice, metadataRegistered: storedInDatabase, storedInDatabase };
  }
}
