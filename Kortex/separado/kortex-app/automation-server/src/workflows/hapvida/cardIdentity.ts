import type { CardBeneficiary } from "./cardPreview.js";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f\u00ad\u200b-\u200d\ufeff]/g, "")
  .replace(/\s+/g, " ").trim().toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const boundedName = (pattern: string) => `(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`;

// Build serializable patterns once; the preview and capture must use the same identity rules.
export function cardTextMatchPatterns(input: CardBeneficiary) {
  const name = normalize(input.beneficiaryName), words = name.split(" ");
  const prefix = words.slice(0, 2).join(" ");
  const significant = words.filter(word => !/^(?:de|da|do|das|dos|e)$/.test(word));
  const initials = significant.length >= 2 ? [escape(significant[0]!), ...significant.slice(1)
    .map(word => `(?:${escape(word)}|${escape(word[0]!)}\\.?)`)]
    .join("\\s+(?:(?:de|da|do|das|dos|d|e)\\s+)*") : undefined;
  const shortened = [prefix.includes(" ") ? escape(prefix) : undefined, initials].filter(Boolean);
  const validId = (value: string) => value.replace(/\D/g, "").length >= 6 && /[1-9]/.test(value);
  const cards = (input.cardIdentifiers ?? []).filter(validId);
  const values = cards.length ? cards : (input.cpf && validId(input.cpf) ? [input.cpf] : []);
  const identifiers = [...new Set(values.map(value => normalize(value).replace(/[\s.\/-]/g, "")))]
    .filter(value => /^[a-z0-9]+$/.test(value))
    .map(value => boundedName(value.split("").map(escape).join("[\\s.\\/-]*")));
  return { fullName: boundedName(escape(name)), shortenedName: shortened.length ? boundedName(`(?:${shortened.join("|")})`) : undefined,
    identifiers, requireIdentifier: input.requireIdentifier === true };
}
