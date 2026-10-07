import type { PortalCredential } from "../types.js";

export interface SecretProvider {
  get(ref: string): Promise<PortalCredential>;
}
