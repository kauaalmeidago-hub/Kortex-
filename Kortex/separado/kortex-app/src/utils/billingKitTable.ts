export type Operator = "Hapvida" | "NDI";
export type BillingStatus = "available" | "pending" | "processing";
export type SortKey = "company" | "operator" | "competence" | "updatedAt";
export type BillingSort = { key: SortKey; direction: "asc" | "desc" };
export type BillingFilters = {
  operators: Operator[];
  month: string;
  year: string;
  status: "all" | BillingStatus;
};
export type BillingKitItem = {
  id: string;
  company: string;
  operator: Operator;
  competence: string;
  updatedAt: string;
  status: BillingStatus;
};

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}
function competenceValue(value: string) {
  const [month, year] = value.split("/").map(Number);
  return year * 12 + month;
}
function dateValue(value: string) {
  const [day, month, year] = value.split("/").map(Number);
  return new Date(year, month - 1, day).getTime();
}
export function filterBillingItems(
  items: BillingKitItem[],
  query: string,
  filters: BillingFilters,
  sort: BillingSort,
) {
  const normalized = normalizeSearch(query);
  return items
    .filter((item) => {
      const [month, year] = item.competence.split("/");
      return (
        normalizeSearch(item.company).includes(normalized) &&
        filters.operators.includes(item.operator) &&
        (filters.month === "all" || filters.month === month) &&
        (filters.year === "all" || filters.year === year) &&
        (filters.status === "all" || filters.status === item.status)
      );
    })
    .sort((a, b) => {
      let result = 0;
      if (sort.key === "company")
        result = a.company.localeCompare(b.company, "pt-BR");
      if (sort.key === "operator")
        result = a.operator.localeCompare(b.operator, "pt-BR");
      if (sort.key === "competence")
        result = competenceValue(a.competence) - competenceValue(b.competence);
      if (sort.key === "updatedAt")
        result = dateValue(a.updatedAt) - dateValue(b.updatedAt);
      return (
        (sort.direction === "asc" ? result : -result) ||
        a.id.localeCompare(b.id)
      );
    });
}
export function paginateBillingItems<T>(
  items: T[],
  requestedPage: number,
  pageSize: number,
) {
  const size = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.max(1, Math.min(requestedPage, totalPages));
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  return {
    page,
    totalPages,
    items: items.slice((page - 1) * size, page * size),
    first: items.length ? (page - 1) * size + 1 : 0,
    last: Math.min(page * size, items.length),
    pages: Array.from(
      { length: Math.min(5, totalPages) },
      (_, index) => start + index,
    ),
  };
}
