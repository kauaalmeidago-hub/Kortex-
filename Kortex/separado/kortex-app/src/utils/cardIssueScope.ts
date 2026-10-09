export function isAllCardBeneficiaries(name: string) {
  return /^tod[oa]s(?:\s+(?:os|as))?(?:\s+beneficiarios)?(?:\s+da\s+empresa)?$/i.test(
    name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(),
  );
}
