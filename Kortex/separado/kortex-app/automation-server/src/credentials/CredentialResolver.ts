import { credentialRefForLogin } from "./credentialIdentity.js";

export interface ResolvedCredential {
  credentialId?: string;
  credentialRef: string;
}

export interface CredentialResolver {
  resolve(input: { companyId: string; operator: string; credentialRef?: string; portalLoginCode?: string }): Promise<ResolvedCredential>;
}

export class ExplicitCredentialResolver implements CredentialResolver {
  async resolve(input: { companyId: string; operator: string; credentialRef?: string; portalLoginCode?: string }) {
    return { credentialRef: input.credentialRef ?? credentialRefForLogin(input.companyId, input.operator, input.portalLoginCode) };
  }
}

