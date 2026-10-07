export interface Lead {
  id: string;
  name: string;
  company?: string;
  value: number;
  date: string;
  tags?: string[];
  contact?: string;
  email?: string;
  phone?: string;
  responsible?: string;
  tasksCount?: number;
  stage: string;
  pipeline: string;
}

export interface Contact {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  isCompany?: boolean;
}

export const pipelines = [
  {
    id: "atendimento-luisa",
    name: "Atendimento - Luísa",
    stages: ["Backlog", "Implantação", "Vigência", "Boas-Vindas", "Cadastro | Conta Azul", "Inclusão", "Exclusão"],
    stageColors: ["#fffeb2", "#fffd7f", "#fff000", "#ffeab2", "#f9deff", "#ffdc7f", "#ffce5a"],
  },
  {
    id: "projeto-pme",
    name: "Projeto PME",
    stages: ["Lista", "Leads", "Abordagem 01", "Abordagem 02", "Retomar ligação", "Proposta enviada", "Follow-up"],
    stageColors: ["#99ccff", "#ffff99", "#ffcc66", "#ffcccc", "#f9deff", "#f9deff", "#f9deff"],
  },
];

export const leads: Lead[] = [
  { id: "1", name: "Dênis Resende", value: 0, date: "Ontem 14:11", stage: "Backlog", pipeline: "atendimento-luisa" },
  { id: "2", name: "Rafael Nascimento", value: 0, date: "Ontem 13:49", stage: "Backlog", pipeline: "atendimento-luisa" },
  { id: "3", name: "Lucas legendario", company: "Lucas Legedario", value: 0, date: "31/03/2026", stage: "Backlog", pipeline: "atendimento-luisa" },
  { id: "4", name: "Joinvilense", company: "Joinvilense - beatriz", value: 0, date: "19/01/2026", stage: "Implantação", pipeline: "atendimento-luisa" },
  { id: "5", name: "Lorena Ferreira", company: "IASA TRANSPORTE E LOGISTICA LTDA", value: 0, date: "03/03/2026", stage: "Vigência", pipeline: "atendimento-luisa", tags: ["NDI"] },
];

export const contacts: Contact[] = [
  { id: "1", name: "60.264.747 WALLISON MENDES DA SILV", isCompany: false },
  { id: "2", name: "NADSTUR AGENCIA DE VIAGENS E TURI", isCompany: false },
  { id: "3", name: "Futura Service LTDA", isCompany: true },
  { id: "4", name: "Valeria", phone: "31 99604-1496" },
  { id: "5", name: "Gabriel", phone: "+55 31 88188-199" },
  { id: "6", name: "ESTRELA LOCACOES EIRELI", company: "ESTRELA LOCACOES EIRELI", phone: "3024-4050" },
  { id: "7", name: "RONALDO RESENDE ASSUNCAO", company: "RONALDO RESENDE ASSUNCAO", phone: "31 98894-3445" },
  { id: "8", name: "JUDSON DA ROCHA NASCIMENTO", company: "JUDSON DA ROCHA NASCIMENTO", phone: "31 99211-2159" },
  { id: "9", name: "WELLER DE CASTRO SILVA", company: "WELLER DE CASTRO SILVA", phone: "31 99756-8796" },
  { id: "10", name: "TARCISIO RODRIGUES TOMAZ FILHO", company: "TARCISIO RODRIGUES TOMAZ FILHO", phone: "31 99927-5642" },
  { id: "11", name: "HUGO MAGNO ROCHA DA SILVA", company: "HUGO MAGNO ROCHA DA SILVA", phone: "31 3383-2111" },
  { id: "12", name: "ANA PAULA ANDRADE LOPES", company: "ANA PAULA ANDRADE LOPES", phone: "31 99876-5432" },
  { id: "13", name: "THIAGO ALVARENGA DOLABELA", company: "THIAGO ALVARENGA DOLABELA", phone: "31 98765-4321" },
  { id: "14", name: "WELLINGTON NEVES RIBEIRO", company: "WELLINGTON NEVES RIBEIRO DE", phone: "31 99654-3210" },
];

export const insightsData = {
  messagesReceived: 601,
  currentConversations: 2,
  unansweredChats: 0,
  responseTime: "5m",
  longestWait: 0,
  leadsWon: 523,
  activeLeads: 594,
  messageSources: [
    { name: "WhatsApp Lite", count: 601 },
    { name: "WhatsApp Cloud API", count: 0 },
    { name: "Bate-papo online", count: 0 },
    { name: "Outros", count: 0 },
  ],
  conversationsDelta: -4,
  unansweredDelta: -4,
};
