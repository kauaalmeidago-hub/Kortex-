import type { PortalCredential } from "../types.js";

export interface SecretProvider {
  get(ref: string): Promise<PortalCredential>;
  takeAutomaticSearchCredential?(ref: string): PortalCredential | undefined;
}

