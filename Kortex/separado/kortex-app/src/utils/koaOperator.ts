export type KoaOperator = "hapvida" | "ndi";

export function normalizeCompanyCode(value: string | undefined) {
  return value?.replace(/[^a-zA-Z0-9]/g, "").trim().toUpperCase() ?? "";
}

function normalizePrefixes(prefixes: string[] | undefined) {
  return (prefixes ?? [])
    .map((prefix) => normalizeCompanyCode(prefix))
    .filter(Boolean);
}

export function inferCardOperatorFromContractCode(
  contractCode: string | undefined,
  options: { hapvidaPrefixes?: string[]; ndiPrefixes?: string[] } = {},
): KoaOperator {
  const code = normalizeCompanyCode(contractCode);
  const hapvidaPrefixes = normalizePrefixes(options.hapvidaPrefixes);
  const ndiPrefixes = normalizePrefixes(options.ndiPrefixes);

  if (ndiPrefixes.some((prefix) => code.startsWith(prefix))) return "ndi";
  if (hapvidaPrefixes.some((prefix) => code.startsWith(prefix))) return "hapvida";

  // Operational convention observed in the Relacionamento credentials:
  // NDI accesses can be alphabetic or use the 0F prefix; Hapvida commonly
  // uses the remaining numeric-prefixed access codes.
  if (/^[A-Z]/.test(code) || code.startsWith("0F")) return "ndi";
  return "hapvida";
}
