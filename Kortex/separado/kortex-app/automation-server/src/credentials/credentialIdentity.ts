export function portalLoginCode(input: Record<string, unknown>) {
  for (const key of ["contractCode", "companyCode"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function credentialRefForLogin(companyId: string, operator: string, companyCode?: string) {
  const base = `${operator}:${companyId}`;
  return companyCode?.trim() ? `${base}:login:${encodeURIComponent(companyCode.trim())}` : base;
}
