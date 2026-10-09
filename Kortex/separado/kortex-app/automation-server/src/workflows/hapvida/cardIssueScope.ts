export function isAllBeneficiariesRequest(input: Record<string, unknown>) {
  if (input.beneficiaryScope === "all") return true;
  const name = typeof input.beneficiaryName === "string" ? input.beneficiaryName : "";
  return /^tod[oa]s(?:\s+(?:os|as))?(?:\s+beneficiarios)?(?:\s+da\s+empresa)?$/i.test(
    name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(),
  );
}
