import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AutomationError } from "../errors.js";
import { unprotectWithDpapi } from "../security/DpapiProtector.js";
import type { PortalCredential } from "../types.js";
import type { SecretProvider } from "./SecretProvider.js";

function safeFileName(ref: string) {
  return Buffer.from(ref, "utf8").toString("base64url");
}

export class DpapiSecretProvider implements SecretProvider {
  constructor(private readonly secretsDir: string) {}

  async get(ref: string): Promise<PortalCredential> {
    const filePath = path.join(this.secretsDir, `${safeFileName(ref)}.credential.dpapi`);
    if (!existsSync(filePath)) {
      throw new AutomationError("CREDENTIAL_NOT_FOUND", "Credencial do portal nao encontrada.", {
        safeDetails: `Cadastre a credencial local para credentialRef "${ref}" antes de executar a automacao.`,
        retryable: false,
      });
    }

    const encryptedPayload = readFileSync(filePath, "utf8").trim();
    const plaintext = await unprotectWithDpapi(encryptedPayload);
    const parsed = JSON.parse(plaintext) as Partial<PortalCredential>;

    if (!parsed.username || !parsed.password) {
      throw new AutomationError("INVALID_CREDENTIAL", "Credencial local invalida.", {
        safeDetails: "O arquivo DPAPI nao contem username/password validos.",
        retryable: false,
      });
    }

    return {
      username: parsed.username,
      password: parsed.password,
      metadata: parsed.metadata,
    };
  }
}
