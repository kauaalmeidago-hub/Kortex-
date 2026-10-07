export interface ResolvedCredential {
  credentialId?: string;
  credentialRef: string;
}

export interface CredentialResolver {
  resolve(input: { companyId: string; operator: string; credentialRef?: string }): Promise<ResolvedCredential>;
}

export class ExplicitCredentialResolver implements CredentialResolver {
  async resolve(input: { companyId: string; operator: string; credentialRef?: string }) {
    return { credentialRef: input.credentialRef ?? `${input.operator}:${input.companyId}` };
  }
}
