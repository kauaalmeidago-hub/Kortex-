import type { Database } from "@/integrations/supabase/types";

export type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
export type Company = CompanyRow & { avatarUrl: string | null;mediaWarning?:string };
export type CompanyContact = Database["public"]["Tables"]["contacts"]["Row"] & { can_edit?: boolean };
export type CompanyNote = Database["public"]["Tables"]["notes"]["Row"];
export type CompanyFile = Database["public"]["Tables"]["company_files"]["Row"];
export type Offering = { product: string; operator: string };
export type CompanyValues = {
  name: string;
  cnpj: string;
  phone: string;
  email: string;
  city: string;
  project: string;
  responsible_name: string;
  industry: string;
  website: string;
  address: string;
  notes: string;
  offerings: Offering[];
};
export const projectOptions = ["PF", "PME", "CCT"];
export const productOptions = ["Saúde", "Saúde Empresarial", "Odonto", "Vida"];
export const operatorOptions = ["Hapvida", "NDI", "Unimed", "SulAmérica"];
export const emptyOffering = (): Offering => ({ product: "", operator: "" });
export function parseOfferings(value: unknown): Offering[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Offering =>
        !!item &&
        typeof item === "object" &&
        typeof item.product === "string" &&
        typeof item.operator === "string",
    )
    .map(({ product, operator }) => ({ product, operator }));
}
export function companyValues(company?: Company): CompanyValues {
  const offerings = parseOfferings(company?.offerings);
  return {
    name: company?.name ?? "",
    cnpj: formatCnpj(company?.cnpj),
    phone: company?.phone ?? "",
    email: company?.email ?? "",
    city: company?.city ?? "",
    project: company?.project ?? "",
    responsible_name: company?.responsible_name ?? "",
    industry: company?.industry ?? "",
    website: company?.website ?? "",
    address: company?.address ?? "",
    notes: company?.notes ?? "",
    offerings: offerings.length ? offerings : [emptyOffering()],
  };
}
export const digits = (value: string) => value.replace(/\D/g, "");
export function formatCnpj(value?: string | null) {
  const text = value ?? "";
  return /^\d{14}$/.test(text)
    ? text.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : text;
}
export function formatPhone(value?: string | null) {
  const text = value ?? "";
  return /^\d{10,11}$/.test(text)
    ? text.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3")
    : text;
}
export function validCnpj(value: string) {
  if (/[^\d./\-\s]/.test(value)) return false;
  const n = digits(value);
  if (n.length !== 14 || /^(\d)\1{13}$/.test(n)) return false;
  const check = (length: number) => {
    let weight = length - 7;
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(n[i]) * weight--;
      if (weight < 2) weight = 9;
    }
    const remainder = sum % 11;
    return Number(n[length]) === (remainder < 2 ? 0 : 11 - remainder);
  };
  return check(12) && check(13);
}
export function validateCompany(values: CompanyValues): string | null {
  if (!values.name.trim()) return "Informe o nome da empresa.";
  if (values.cnpj.trim() && !validCnpj(values.cnpj))
    return "Informe um CNPJ válido, com 14 dígitos.";
  if (
    values.email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())
  )
    return "Informe um e-mail válido.";
  if (values.phone.trim() && !/^\d{10,13}$/.test(digits(values.phone)))
    return "Informe um telefone válido, incluindo DDD.";
  if (values.website.trim()) {
    try {
      const url = new URL(values.website);
      if (!["http:", "https:"].includes(url.protocol))
        return "Informe um site iniciado por https:// ou http://.";
    } catch {
      return "Informe um site iniciado por https:// ou http://.";
    }
  }
  if (
    values.offerings.some(
      (o) => Boolean(o.product.trim()) !== Boolean(o.operator.trim()),
    )
  )
    return "Informe produto e operadora em cada vínculo ou remova o vínculo incompleto.";
  return null;
}
export const distinct = (values: string[]) => [
  ...new Set(values.filter(Boolean)),
];
export function offeringSummary(company: Company, key: keyof Offering) {
  return distinct(parseOfferings(company.offerings).map((o) => o[key])).join(
    " + ",
  );
}
export function matchesCompany(
  company: Company,
  query: string,
  project: string,
  product: string,
  operator: string,
) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const cnpjQuery = /^[\d./\-\s]+$/.test(normalized) ? digits(normalized) : "";
  const offerings = parseOfferings(company.offerings);
  return (
    (!normalized ||
      company.name.toLocaleLowerCase("pt-BR").includes(normalized) ||
      Boolean(cnpjQuery && company.cnpj?.includes(cnpjQuery))) &&
    (!project || company.project === project) &&
    ((!product && !operator) ||
      offerings.some(
        (o) =>
          (!product || o.product === product) &&
          (!operator || o.operator === operator),
      ))
  );
}
