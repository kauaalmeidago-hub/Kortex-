export type BillingOperator = "Hapvida" | "NDI";
export type KitAvailability = "download" | "request" | "track";
export type KitFilters = {
  operators: BillingOperator[];
  month: string;
  year: string;
  availability: "all" | KitAvailability;
};
export const emptyKitFilters = (): KitFilters => ({ operators: ["Hapvida", "NDI"], month: "all", year: "all", availability: "all" });

export type BillingKitItem = {
  id: string;
  company: string;
  operator: BillingOperator;
  competence: string;
  pendingAction: string;
  updatedAt: string;
  action: KitAvailability;
};

export const billingItems: BillingKitItem[] = [
  {
    id: "1",
    company: "RM Books",
    operator: "Hapvida",
    competence: "09/2026",
    pendingAction: "Kit faturamento completo disponível para download.",
    updatedAt: "17/06/2025",
    action: "download",
  },
  {
    id: "2",
    company: "Cafeteria Noroeste",
    operator: "NDI",
    competence: "09/2026",
    pendingAction: "Solicitar boleto mensal ao atendimento da operadora.",
    updatedAt: "16/06/2025",
    action: "request",
  },
  {
    id: "3",
    company: "Confins Transportes",
    operator: "Hapvida",
    competence: "08/2026",
    pendingAction: "Relatório de coparticipação disponível.",
    updatedAt: "15/06/2025",
    action: "download",
  },
  {
    id: "4",
    company: "Clínica Horizonte",
    operator: "NDI",
    competence: "08/2026",
    pendingAction: "Pedido manual enviado, aguardando retorno da operadora.",
    updatedAt: "15/06/2025",
    action: "track",
  },
  {
    id: "5",
    company: "Dantas Almeida",
    operator: "Hapvida",
    competence: "08/2026",
    pendingAction: "NFS pendente de solicitação.",
    updatedAt: "14/06/2025",
    action: "request",
  },
  {
    id: "6",
    company: "ERC Logística",
    operator: "Hapvida",
    competence: "07/2026",
    pendingAction: "Boleto mensal disponível para download.",
    updatedAt: "13/06/2025",
    action: "download",
  },
  {
    id: "7",
    company: "Mercado Central Saúde",
    operator: "NDI",
    competence: "07/2026",
    pendingAction: "Kit completo em processamento pela equipe.",
    updatedAt: "12/06/2025",
    action: "track",
  },
  {
    id: "8",
    company: "Prime Odonto Empresarial",
    operator: "NDI",
    competence: "07/2026",
    pendingAction: "Solicitar relatório de coparticipação.",
    updatedAt: "11/06/2025",
    action: "request",
  },
  {
    id: "9",
    company: "Scuzatec Comercial",
    operator: "Hapvida",
    competence: "07/2026",
    pendingAction: "Kit faturamento completo disponível.",
    updatedAt: "10/06/2025",
    action: "download",
  },
  {
    id: "10",
    company: "Horizonte Benefícios",
    operator: "Hapvida",
    competence: "07/2026",
    pendingAction: "Visualizar acompanhamento da solicitação.",
    updatedAt: "09/06/2025",
    action: "track",
  },
];
