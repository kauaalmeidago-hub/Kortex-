import { credentialRefForLogin } from "./credentialIdentity.js";
import type { PortalName } from "../types.js";

export interface ResolvedCredential {
  credentialId?: string;
  credentialRef: string;
}

export interface CredentialResolver {
  resolve(input: { companyId: string; operator: string; credentialRef?: string; portalLoginCode?: string }): Promise<ResolvedCredential>;
  preferredCardPortal?(input: { companyId: string; portalLoginCode: string }): Promise<PortalName | undefined>;
}

export class ExplicitCredentialResolver implements CredentialResolver {
  async resolve(input: { companyId: string; operator: string; credentialRef?: string; portalLoginCode?: string }) {
    return { credentialRef: input.portalLoginCode?.trim()
      ? credentialRefForLogin(input.companyId, input.operator, input.portalLoginCode)
      : input.credentialRef ?? credentialRefForLogin(input.companyId, input.operator) };
  }
}

