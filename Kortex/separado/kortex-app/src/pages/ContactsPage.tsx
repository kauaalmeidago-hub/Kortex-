import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Filter,
  Flag,
  Loader2,
  Mail,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  Save,
  Search,
  Trash2,
  UploadCloud,
  User,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];
type ContactUpdate = Database["public"]["Tables"]["contacts"]["Update"];
type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
type CompanyInsert = Database["public"]["Tables"]["companies"]["Insert"];
type NoteInsert = Database["public"]["Tables"]["notes"]["Insert"];

type ContactWithCompany = ContactRow & {
  company: Pick<CompanyRow, "id" | "name"> | null;
};

type ContactFormValues = {
  fullName: string;
  jobTitle: string;
  companyName: string;
  phone: string;
  email: string;
  observations: string;
};

type ContactSubmitPayload = {
  values: ContactFormValues;
  quickNotes: string[];
  selectedFilesCount: number;
};

type ContactSubmitResult = {
  ok: boolean;
  error?: string;
};

type ContactImportRow = ContactFormValues & {
  rowNumber: number;
};

type ContactImportRejected = {
  row: number;
  reason: string;
};

type ContactImportResult = {
  imported: number;
  rejected: ContactImportRejected[];
  total: number;
};

type ContactFilters = {
  hasEmail: boolean;
  hasPhone: boolean;
  hasCompany: boolean;
};

const emptyFilters: ContactFilters = {
  hasEmail: false,
  hasPhone: false,
  hasCompany: false,
};

const emptyForm: ContactFormValues = {
  fullName: "",
  jobTitle: "",
  companyName: "",
  phone: "",
  email: "",
  observations: "",
};

type ContactDraft = {
  form: ContactFormValues;
  quickNote: string;
  quickNotes: string[];
  savedAt: string;
};

const pageSizeOptions = [10, 25, 50];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function contactDraftKey(contactId?: string | null) {
  return contactId ? `kortex-contact-draft:${contactId}` : "kortex-contact-draft:new";
}

function readContactDraft(key: string): ContactDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as ContactDraft) : null;
  } catch {
    return null;
  }
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function whatsappHref(phone?: string | null) {
  const digits = phone?.replace(/\D/g, "");
  return digits ? `https://wa.me/55${digits}` : undefined;
}

function formatDate(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo selecionado."));
    reader.readAsText(file, "utf-8");
  });
}

function countSeparatorOutsideQuotes(line: string, separator: "," | ";") {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === separator && !quoted) {
      count += 1;
    }
  }
  return count;
}

function detectCsvSeparator(text: string): "," | ";" {
  const sampleLines = text.split(/\r?\n/).slice(0, 8);
  const semicolons = sampleLines.reduce((total, line) => total + countSeparatorOutsideQuotes(line, ";"), 0);
  const commas = sampleLines.reduce((total, line) => total + countSeparatorOutsideQuotes(line, ","), 0);
  return semicolons > commas ? ";" : ",";
}

function parseCsv(text: string) {
  const separator = detectCsvSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"' && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === separator && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

type ContactImportField = keyof ContactFormValues;

const contactImportHeaders: Record<ContactImportField, string[]> = {
  fullName: ["nome", "nomedocontato", "contato", "fullname", "name"],
  jobTitle: ["cargo", "funcao", "função", "jobtitle", "position"],
  companyName: ["empresa", "empresaoucliente", "company", "companyname", "cliente"],
  phone: ["telefone", "celular", "whatsapp", "phone"],
  email: ["email", "e-mail", "mail"],
  observations: ["observacoes", "observações", "notas", "notes", "observations"],
};

function normalizeHeader(value: string) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function resolveHeaderIndexes(headers: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader);
  return Object.fromEntries(
    Object.entries(contactImportHeaders).map(([field, aliases]) => [
      field,
      normalizedHeaders.findIndex((header) => aliases.map(normalizeHeader).includes(header)),
    ]),
  ) as Record<ContactImportField, number>;
}

function contactCell(values: string[], index: number) {
  return index >= 0 ? values[index]?.trim() || "" : "";
}

function parseContactsImport(text: string): { rows: ContactImportRow[]; rejected: ContactImportRejected[] } {
  const table = parseCsv(text);
  if (table.length < 2) {
    return {
      rows: [],
      rejected: [{ row: 0, reason: "O arquivo CSV precisa ter cabeçalho e pelo menos uma linha de contato." }],
    };
  }

  const indexes = resolveHeaderIndexes(table[0]);
  if (indexes.fullName < 0) {
    return {
      rows: [],
      rejected: [{ row: 1, reason: "Cabeçalho obrigatório não encontrado: Nome." }],
    };
  }

  const rows: ContactImportRow[] = [];
  const rejected: ContactImportRejected[] = [];

  table.slice(1).forEach((values, index) => {
    const rowNumber = index + 2;
    const fullName = contactCell(values, indexes.fullName);
    const email = contactCell(values, indexes.email);

    if (!values.some((value) => value.trim())) return;
    if (!fullName) {
      rejected.push({ row: rowNumber, reason: "Nome do contato não informado." });
      return;
    }
    if (email && !emailPattern.test(email)) {
      rejected.push({ row: rowNumber, reason: "E-mail inválido." });
      return;
    }

    rows.push({
      rowNumber,
      fullName,
      jobTitle: contactCell(values, indexes.jobTitle),
      companyName: contactCell(values, indexes.companyName),
      phone: contactCell(values, indexes.phone),
      email,
      observations: contactCell(values, indexes.observations),
    });
  });

  return { rows, rejected };
}

function getCompanyName(contact: ContactWithCompany) {
  return contact.company?.name || "";
}

function formFromContact(contact: ContactWithCompany | null): ContactFormValues {
  if (!contact) return emptyForm;
  return {
    fullName: contact.full_name,
    jobTitle: contact.job_title || "",
    companyName: contact.company?.name || "",
    phone: contact.phone || "",
    email: contact.email || "",
    observations: contact.notes || "",
  };
}

function localContactFromValues(values: ContactFormValues, existing?: ContactWithCompany | null): ContactWithCompany {
  const now = new Date().toISOString();
  const companyName = values.companyName.trim();
  const companyId = existing?.company_id || (companyName ? `local-company:${normalize(companyName)}` : null);

  return {
    id: existing?.id || crypto.randomUUID(),
    workspace_id: existing?.workspace_id || "frontend-workspace",
    created_by: existing?.created_by || null,
    created_at: existing?.created_at || now,
    updated_at: now,
    full_name: values.fullName.trim(),
    job_title: values.jobTitle.trim() || null,
    email: values.email.trim() || null,
    phone: values.phone.trim() || null,
    notes: values.observations.trim() || null,
    company_id: companyId,
    company: companyName && companyId ? { id: companyId, name: companyName } : null,
  };
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1 text-[13px] font-semibold text-foreground">
      <span>
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      {children}
      {error && (
        <span className="flex items-center gap-1 text-xs font-semibold text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </span>
      )}
    </label>
  );
}

function IconInput({
  icon: Icon,
  className,
  inputRef,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { icon: React.ElementType; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        {...props}
        className={cn(
          "h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10",
          className,
        )}
      />
    </div>
  );
}

export default function ContactsPage() {
  const { user, workspace } = useAuth();
  const [contacts, setContacts] = useState<ContactWithCompany[]>([]);
  const [companies, setCompanies] = useState<Pick<CompanyRow, "id" | "name">[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [notice, setNotice] = useState<{ type: "success" | "warning"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ContactFilters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactWithCompany | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);

  const loadContacts = useCallback(async () => {
    setLoadError("");
    setOperationError("");
    setNotice(null);

    if (!workspace?.id) {
      setContacts([]);
      setCompanies([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [contactsResult, companiesResult] = await Promise.all([
      supabase
        .from("contacts")
        .select("*, company:companies(id, name)")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("companies")
        .select("id, name")
        .eq("workspace_id", workspace.id)
        .order("name", { ascending: true }),
    ]);

    if (contactsResult.error) {
      setLoadError(contactsResult.error.message);
      setContacts([]);
    } else {
      setContacts((contactsResult.data || []) as unknown as ContactWithCompany[]);
    }

    if (companiesResult.error) {
      setOperationError(`Empresas não carregadas: ${companiesResult.error.message}`);
      setCompanies([]);
    } else {
      setCompanies(companiesResult.data || []);
    }

    setLoading(false);
  }, [workspace?.id]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!showActionsMenu) return undefined;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!actionsMenuRef.current?.contains(event.target as Node)) setShowActionsMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowActionsMenu(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showActionsMenu]);

  const filteredContacts = useMemo(() => {
    const term = normalize(query.trim());
    const digits = query.replace(/\D/g, "");

    return contacts.filter((contact) => {
      const companyName = getCompanyName(contact);
      const matchesSearch =
        !term ||
        normalize(contact.full_name).includes(term) ||
        normalize(contact.email || "").includes(term) ||
        normalize(contact.phone || "").includes(term) ||
        normalize(contact.job_title || "").includes(term) ||
        normalize(companyName).includes(term) ||
        (Boolean(digits) && (contact.phone || "").replace(/\D/g, "").includes(digits));

      const matchesFilters =
        (!filters.hasEmail || Boolean(contact.email)) &&
        (!filters.hasPhone || Boolean(contact.phone)) &&
        (!filters.hasCompany || Boolean(contact.company_id));

      return matchesSearch && matchesFilters;
    });
  }, [contacts, filters, query]);

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / pageSize));
  const pageContacts = filteredContacts.slice((page - 1) * pageSize, page * pageSize);
  const selectedVisible = pageContacts.length > 0 && pageContacts.every((contact) => selected.has(contact.id));
  const selectedContacts = filteredContacts.filter((contact) => selected.has(contact.id));
  const hasFilters = filters.hasEmail || filters.hasPhone || filters.hasCompany;

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setSelected((current) => {
      const validIds = new Set(contacts.map((contact) => contact.id));
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [contacts]);

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (selectedVisible) pageContacts.forEach((contact) => next.delete(contact.id));
      else pageContacts.forEach((contact) => next.add(contact.id));
      return next;
    });
  };

  const clearFilters = () => {
    setQuery("");
    setFilters(emptyFilters);
    setPage(1);
  };

  const openNewContact = () => {
    setEditingContact(null);
    setOperationError("");
    setNotice(null);
    setModalOpen(true);
  };

  const openEditContact = (contact: ContactWithCompany) => {
    setEditingContact(contact);
    setOperationError("");
    setNotice(null);
    setModalOpen(true);
  };

  const closeContactModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingContact(null);
  };

  const resolveCompanyId = async (companyName: string) => {
    const trimmed = companyName.trim();
    if (!trimmed || !workspace?.id) return null;

    const existing = companies.find((company) => normalize(company.name) === normalize(trimmed));
    if (existing) return existing.id;

    const payload: CompanyInsert = {
      workspace_id: workspace.id,
      name: trimmed,
      created_by: user?.id || null,
    };

    const { data, error } = await supabase
      .from("companies")
      .insert(payload)
      .select("id, name")
      .single();

    if (error) throw new Error(`Não foi possível criar a empresa informada: ${error.message}`);
    if (data) setCompanies((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));

    return data?.id || null;
  };

  const handleSubmitContact = async ({ values, quickNotes, selectedFilesCount }: ContactSubmitPayload): Promise<ContactSubmitResult> => {
    setSaving(true);
    setOperationError("");
    setNotice(null);

    try {
      if (!workspace?.id) {
        const localContact = localContactFromValues(values, editingContact);
        setContacts((current) => {
          const exists = current.some((contact) => contact.id === localContact.id);
          if (exists) return current.map((contact) => (contact.id === localContact.id ? localContact : contact));
          return [localContact, ...current];
        });
        setPage(1);
        setNotice({
          type: "success",
          text: editingContact ? "Contato atualizado nesta sessão." : "Contato criado nesta sessão.",
        });
        return { ok: true };
      }

      const companyId = await resolveCompanyId(values.companyName);
      const basePayload = {
        full_name: values.fullName.trim(),
        job_title: values.jobTitle.trim() || null,
        email: values.email.trim() || null,
        phone: values.phone.trim() || null,
        notes: values.observations.trim() || null,
        company_id: companyId,
        updated_at: new Date().toISOString(),
      };

      let savedContact: ContactWithCompany | null = null;

      if (editingContact) {
        const payload: ContactUpdate = basePayload;
        const { data, error } = await supabase
          .from("contacts")
          .update(payload)
          .eq("id", editingContact.id)
          .select("*, company:companies(id, name)")
          .single();

        if (error) return { ok: false, error: error.message };
        savedContact = data as unknown as ContactWithCompany;
        setContacts((current) => current.map((contact) => (contact.id === savedContact?.id ? savedContact : contact)));
      } else {
        const payload: ContactInsert = {
          ...basePayload,
          workspace_id: workspace.id,
          created_by: user?.id || null,
        };
        const { data, error } = await supabase
          .from("contacts")
          .insert(payload)
          .select("*, company:companies(id, name)")
          .single();

        if (error) return { ok: false, error: error.message };
        savedContact = data as unknown as ContactWithCompany;
        setContacts((current) => [savedContact as ContactWithCompany, ...current]);
        setPage(1);
      }

      let warning = "";
      const notes = quickNotes.map((content) => content.trim()).filter(Boolean);
      if (savedContact && notes.length) {
        const notePayloads: NoteInsert[] = notes.map((content) => ({
          workspace_id: workspace.id,
          contact_id: savedContact?.id || null,
          user_id: user?.id || null,
          content,
        }));
        const { error } = await supabase.from("notes").insert(notePayloads);
        if (error) warning = `Contato salvo, mas as notas rápidas não foram persistidas: ${error.message}`;
      }

      if (selectedFilesCount > 0) {
        warning = [warning, "Arquivos selecionados não foram enviados porque não há bucket/policies de storage configurados para contatos."]
          .filter(Boolean)
          .join(" ");
      }

      setNotice({
        type: warning ? "warning" : "success",
        text: warning || (editingContact ? "Contato atualizado com sucesso." : "Contato criado com sucesso."),
      });

      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Não foi possível salvar o contato." };
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedContacts = async () => {
    if (!selectedContacts.length) return;
    if (!workspace?.id) {
      const ids = selectedContacts.map((contact) => contact.id);
      setContacts((current) => current.filter((contact) => !ids.includes(contact.id)));
      setSelected(new Set());
      setNotice({ type: "success", text: `${ids.length} contato${ids.length > 1 ? "s" : ""} removido${ids.length > 1 ? "s" : ""} desta sessão.` });
      setConfirmDeleteOpen(false);
      return;
    }

    setDeleting(true);
    setOperationError("");
    setNotice(null);
    const ids = selectedContacts.map((contact) => contact.id);
    const previous = contacts;

    setContacts((current) => current.filter((contact) => !ids.includes(contact.id)));
    setSelected(new Set());

    const { error } = await supabase.from("contacts").delete().in("id", ids);

    if (error) {
      setContacts(previous);
      setOperationError(error.message);
    } else {
      setNotice({ type: "success", text: `${ids.length} contato${ids.length > 1 ? "s" : ""} excluído${ids.length > 1 ? "s" : ""}.` });
    }

    setDeleting(false);
    setConfirmDeleteOpen(false);
  };

  const exportCsv = () => {
    const source = selectedContacts.length ? selectedContacts : filteredContacts;
    const rows = [
      ["Nome", "E-mail", "Telefone", "Empresa", "Cargo", "Adicionado em"],
      ...source.map((contact) => [
        contact.full_name,
        contact.email || "",
        contact.phone || "",
        getCompanyName(contact),
        contact.job_title || "",
        formatDate(contact.created_at),
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => csvCell(String(cell))).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "contatos-kortex.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const printContacts = () => {
    const source = selectedContacts.length ? selectedContacts : filteredContacts;
    if (!source.length) {
      setNotice({ type: "warning", text: "Nenhum contato disponível para imprimir." });
      return;
    }

    const printWindow = window.open("", "_blank", "width=1120,height=780");
    if (!printWindow) {
      setOperationError("Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.");
      return;
    }

    const generatedAt = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date());
    const rowsHtml = source
      .map(
        (contact) => `
          <tr>
            <td>${escapeHtml(contact.full_name)}</td>
            <td>${escapeHtml(contact.email || "")}</td>
            <td>${escapeHtml(contact.phone || "")}</td>
            <td>${escapeHtml(getCompanyName(contact))}</td>
            <td>${escapeHtml(contact.job_title || "")}</td>
            <td>${escapeHtml(formatDate(contact.created_at))}</td>
          </tr>
        `,
      )
      .join("");

    printWindow.document.write(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Contatos Kortex</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 32px; color: #0b1554; font-family: Inter, Arial, sans-serif; }
            h1 { margin: 0; font-size: 24px; }
            p { margin: 8px 0 24px; color: #53679a; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border-bottom: 1px solid #dbe6f7; padding: 10px 8px; text-align: left; vertical-align: top; }
            th { background: #f5f8ff; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
          </style>
        </head>
        <body>
          <h1>Contatos</h1>
          <p>${source.length} contato${source.length === 1 ? "" : "s"} | Gerado em ${escapeHtml(generatedAt)}</p>
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Telefone</th>
                <th>Empresa</th>
                <th>Cargo</th>
                <th>Adicionado em</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const importContacts = async (file: File, onProgress: (progress: number) => void): Promise<ContactImportResult> => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "csv" && !file.type.includes("csv") && !file.type.startsWith("text/")) {
      throw new Error("Selecione um arquivo CSV. Outros formatos precisam de um parser configurado antes da importação.");
    }

    setOperationError("");
    setNotice(null);
    onProgress(3);

    const parsed = parseContactsImport(await readFileAsText(file));
    if (!parsed.rows.length) {
      return {
        imported: 0,
        rejected: parsed.rejected.length ? parsed.rejected : [{ row: 0, reason: "Nenhuma linha válida encontrada." }],
        total: parsed.rejected.length,
      };
    }

    if (!workspace?.id) {
      const imported = parsed.rows.map((row) => localContactFromValues(row));
      setContacts((current) => [...imported, ...current]);
      setPage(1);
      onProgress(100);
      return {
        imported: imported.length,
        rejected: parsed.rejected,
        total: parsed.rows.length + parsed.rejected.length,
      };
    }

    const companyCache = new Map(companies.map((company) => [normalize(company.name), company.id]));
    const imported: ContactWithCompany[] = [];
    const rejected: ContactImportRejected[] = [...parsed.rejected];

    for (const [index, row] of parsed.rows.entries()) {
      try {
        let companyId: string | null = null;
        const normalizedCompany = normalize(row.companyName.trim());
        if (normalizedCompany) {
          companyId = companyCache.get(normalizedCompany) || null;
          if (!companyId) {
            companyId = await resolveCompanyId(row.companyName);
            if (companyId) companyCache.set(normalizedCompany, companyId);
          }
        }

        const payload: ContactInsert = {
          workspace_id: workspace.id,
          created_by: user?.id || null,
          full_name: row.fullName.trim(),
          job_title: row.jobTitle.trim() || null,
          email: row.email.trim() || null,
          phone: row.phone.trim() || null,
          notes: row.observations.trim() || null,
          company_id: companyId,
        };

        const { data, error } = await supabase
          .from("contacts")
          .insert(payload)
          .select("*, company:companies(id, name)")
          .single();

        if (error) {
          rejected.push({ row: row.rowNumber, reason: error.message });
        } else if (data) {
          imported.push(data as unknown as ContactWithCompany);
        }
      } catch (error) {
        rejected.push({
          row: row.rowNumber,
          reason: error instanceof Error ? error.message : "Erro inesperado ao importar a linha.",
        });
      }

      onProgress(Math.min(98, Math.max(8, Math.round(((index + 1) / parsed.rows.length) * 100))));
    }

    if (imported.length) {
      setContacts((current) => {
        const currentIds = new Set(current.map((contact) => contact.id));
        return [...imported.filter((contact) => !currentIds.has(contact.id)), ...current];
      });
      setPage(1);
    }

    onProgress(100);
    const result = { imported: imported.length, rejected, total: parsed.rows.length + parsed.rejected.length };
    setNotice({
      type: result.rejected.length ? "warning" : "success",
      text:
        result.imported > 0
          ? `${result.imported} contato${result.imported === 1 ? "" : "s"} importado${result.imported === 1 ? "" : "s"}.${result.rejected.length ? ` ${result.rejected.length} linha${result.rejected.length === 1 ? "" : "s"} rejeitada${result.rejected.length === 1 ? "" : "s"}.` : ""}`
          : "Nenhum contato foi importado.",
    });
    return result;
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="shrink-0 border-b border-border bg-card px-3 py-3 sm:px-4">
        <div className="mb-3 flex flex-col gap-1">
          <h1 className="text-xl font-black tracking-tight text-foreground">Contatos</h1>
          <p className="text-sm text-muted-foreground">Gerencie contatos e mantenha a base visual pronta para o CRM.</p>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative min-w-[220px] flex-1 xl:max-w-[520px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              className="h-10 w-full rounded-xl border border-input bg-background pl-10 pr-14 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
              placeholder="Buscar contatos..."
              type="search"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-muted px-2 py-1 text-[10px] font-bold text-muted-foreground">
              Ctrl K
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton onClick={() => setShowFilters(true)} active={hasFilters}>
              <Filter className="h-4 w-4" />
              Filtros
            </ToolbarButton>
            <div ref={actionsMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setShowActionsMenu((current) => !current)}
                aria-haspopup="menu"
                aria-expanded={showActionsMenu}
                className={cn(
                  "inline-flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-bold transition",
                  showActionsMenu
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-foreground hover:border-primary/50 hover:text-primary",
                )}
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Abrir ações</span>
              </button>
              {showActionsMenu && (
                <div
                  role="menu"
                  className="absolute right-0 top-12 z-30 w-48 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowActionsMenu(false);
                      printContacts();
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold transition hover:bg-accent hover:text-accent-foreground"
                  >
                    <Printer className="h-4 w-4" />
                    Imprimir
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowActionsMenu(false);
                      exportCsv();
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold transition hover:bg-accent hover:text-accent-foreground"
                  >
                    <Download className="h-4 w-4" />
                    Exportar
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowActionsMenu(false);
                      setImportOpen(true);
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold transition hover:bg-accent hover:text-accent-foreground"
                  >
                    <UploadCloud className="h-4 w-4" />
                    Importar
                  </button>
                </div>
              )}
            </div>
            {selectedContacts.length > 0 && (
              <ToolbarButton onClick={() => setConfirmDeleteOpen(true)} active>
                <Trash2 className="h-4 w-4" />
                Excluir {selectedContacts.length}
              </ToolbarButton>
            )}
            <button
              type="button"
              onClick={openNewContact}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Novo contato
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 scrollbar-thin sm:p-4">
        {(operationError || notice) && (
          <div
            className={cn(
              "mb-3 rounded-xl border px-4 py-3 text-sm",
              operationError
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : notice?.type === "warning"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            )}
          >
            {operationError || notice?.text}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Carregando contatos...
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Não foi possível carregar contatos: {loadError}
          </div>
        ) : !contacts.length ? (
          <EmptyState
            title="Nenhum contato encontrado"
            description="Crie um contato para começar a preencher a base visual."
            onAction={openNewContact}
            actionLabel="Novo contato"
          />
        ) : !filteredContacts.length ? (
          <EmptyState
            title="Nenhum contato corresponde aos filtros"
            description="Ajuste a busca ou limpe os filtros para visualizar os contatos reais existentes."
            onAction={clearFilters}
            actionLabel="Limpar filtros"
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[940px] text-left text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  <tr>
                    <th className="w-12 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedVisible}
                        onChange={toggleVisibleSelection}
                        className="h-4 w-4 rounded border-input accent-blue-600"
                        aria-label="Selecionar contatos visíveis"
                      />
                    </th>
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">E-mail</th>
                    <th className="px-4 py-3">Telefone</th>
                    <th className="px-4 py-3">Empresa</th>
                    <th className="px-4 py-3">Adicionado em</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageContacts.map((contact) => {
                    const wa = whatsappHref(contact.phone);
                    return (
                      <tr key={contact.id} className="transition hover:bg-muted/35">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(contact.id)}
                            onChange={() => toggleSelected(contact.id)}
                            className="h-4 w-4 rounded border-input accent-blue-600"
                            aria-label={`Selecionar ${contact.full_name}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => openEditContact(contact)} className="flex min-w-0 items-center gap-3 text-left">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-black text-primary">
                              {initials(contact.full_name) || <User className="h-4 w-4" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-bold text-foreground">{contact.full_name}</span>
                              {contact.job_title && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{contact.job_title}</span>}
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{contact.email || ""}</td>
                        <td className="px-4 py-3 text-muted-foreground">{contact.phone || ""}</td>
                        <td className="px-4 py-3 text-muted-foreground">{getCompanyName(contact)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(contact.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {wa && (
                              <a
                                href={wa}
                                target="_blank"
                                rel="noreferrer"
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-primary transition hover:bg-primary/10"
                                aria-label={`Abrir WhatsApp de ${contact.full_name}`}
                              >
                                <MessageCircle className="h-4 w-4" />
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditContact(contact)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                              aria-label={`Editar ${contact.full_name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
              <span>
                Mostrando {pageContacts.length ? (page - 1) * pageSize + 1 : 0} a {Math.min(page * pageSize, filteredContacts.length)} de {filteredContacts.length} contatos
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-foreground transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Página anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => index + 1).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setPage(item)}
                    className={cn(
                      "h-9 w-9 rounded-xl border text-sm font-bold transition",
                      item === page ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground hover:border-primary",
                    )}
                  >
                    {item}
                  </button>
                ))}
                {totalPages > 5 && <span className="px-1">...</span>}
                <button
                  type="button"
                  disabled={page === totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-foreground transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Próxima página"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                  className="h-9 rounded-xl border border-border bg-background px-3 text-sm font-semibold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                  aria-label="Contatos por página"
                >
                  {pageSizeOptions.map((size) => (
                    <option key={size} value={size}>{size} por página</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {showFilters && (
        <FiltersDialog
          filters={filters}
          setFilters={setFilters}
          onClose={() => setShowFilters(false)}
          onClear={() => setFilters(emptyFilters)}
        />
      )}

      {modalOpen && (
        <ContactModal
          contact={editingContact}
          companies={companies}
          saving={saving}
          onClose={closeContactModal}
          onSubmit={handleSubmitContact}
        />
      )}

      {importOpen && (
        <ImportContactsDialog
          onClose={() => setImportOpen(false)}
          onImport={importContacts}
        />
      )}

      {confirmDeleteOpen && (
        <ConfirmDeleteDialog
          count={selectedContacts.length}
          deleting={deleting}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={() => void deleteSelectedContacts()}
        />
      )}
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  active,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-foreground hover:border-primary/50 hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <User className="h-6 w-6" />
      </div>
      <p className="mt-4 text-sm font-black text-foreground">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function FiltersDialog({
  filters,
  setFilters,
  onClose,
  onClear,
}: {
  filters: ContactFilters;
  setFilters: (filters: ContactFilters) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  const options: Array<[keyof ContactFilters, string]> = [
    ["hasEmail", "Somente com e-mail"],
    ["hasPhone", "Somente com telefone"],
    ["hasCompany", "Somente com empresa vinculada"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="contacts-filter-title" className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="contacts-filter-title" className="text-lg font-black">Filtros</h2>
            <p className="mt-1 text-sm text-muted-foreground">Refine a lista de contatos reais.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground" aria-label="Fechar filtros">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {options.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilters({ ...filters, [key]: !filters[key] })}
              className={cn(
                "flex h-11 w-full items-center gap-3 rounded-xl border px-3 text-left text-sm font-bold transition",
                filters[key] ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:border-primary/40",
              )}
            >
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-md border", filters[key] ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                {filters[key] && <Check className="h-3.5 w-3.5" />}
              </span>
              {label}
            </button>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClear} className="h-10 rounded-xl border border-border px-4 text-sm font-bold text-foreground transition hover:border-primary">
            Limpar
          </button>
          <button type="button" onClick={onClose} className="h-10 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary/90">
            Aplicar filtros
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteDialog({
  count,
  deleting,
  onCancel,
  onConfirm,
}: {
  count: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="delete-contact-title" className="w-full max-w-md rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" />
          </span>
          <div>
            <h2 id="delete-contact-title" className="text-lg font-black">Excluir contatos?</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Esta ação excluirá {count} contato{count === 1 ? "" : "s"} selecionado{count === 1 ? "" : "s"} da lista atual.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={deleting} className="h-10 rounded-xl border border-border px-4 text-sm font-bold text-foreground transition hover:border-primary disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={onConfirm} disabled={deleting} className="inline-flex h-10 items-center gap-2 rounded-xl bg-destructive px-4 text-sm font-bold text-destructive-foreground transition hover:bg-destructive/90 disabled:opacity-50">
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportContactsDialog({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (file: File, onProgress: (progress: number) => void) => Promise<ContactImportResult>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"select" | "processing" | "success" | "error">("select");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ContactImportResult | null>(null);
  const [error, setError] = useState("");
  const [videoError, setVideoError] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(media.matches);
    syncMotion();
    media.addEventListener("change", syncMotion);
    return () => media.removeEventListener("change", syncMotion);
  }, []);

  useEffect(() => {
    firstButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && status !== "processing") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, status]);

  const selectFile = (selectedFile?: File | null) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setError("");
    setResult(null);
    setProgress(0);
    setStatus("select");
  };

  const startImport = async () => {
    if (!file) {
      setError("Selecione um arquivo CSV para iniciar a importação.");
      return;
    }

    setStatus("processing");
    setError("");
    setResult(null);
    setProgress(0);

    try {
      const importResult = await onImport(file, setProgress);
      setResult(importResult);
      setProgress(100);
      if (importResult.imported > 0) {
        setStatus("success");
      } else {
        setError("Nenhum contato foi importado.");
        setStatus("error");
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Não foi possível importar o arquivo.");
      setStatus("error");
    }
  };

  const resetSelection = () => {
    setFile(null);
    setResult(null);
    setError("");
    setProgress(0);
    setStatus("select");
  };

  const rejected = result?.rejected || [];

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contacts-import-title"
        className="flex max-h-[72dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id="contacts-import-title" className="text-xl font-black">
              {status === "processing" ? "Importando arquivo" : status === "success" ? "Importação concluída" : "Importar contatos"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {status === "processing"
                ? "Estamos processando seu arquivo. Aguarde alguns instantes."
                : status === "success"
                  ? "Seu arquivo foi importado com sucesso."
                  : "Use CSV com colunas de nome, e-mail, telefone, empresa, cargo e observações."}
            </p>
          </div>
          <button
            ref={firstButtonRef}
            type="button"
            onClick={onClose}
            disabled={status === "processing"}
            className="rounded-xl p-2 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Fechar importação"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {status === "processing" ? (
          <div className="min-h-0 overflow-y-auto px-6 py-8 text-center" aria-live="polite">
            <div className="mx-auto flex h-32 w-32 items-center justify-center">
              {!reducedMotion && !videoError ? (
                <video
                  src="/brand/flame-loading.mp4"
                  className="h-full w-full object-contain"
                  autoPlay
                  muted
                  loop
                  playsInline
                  aria-hidden="true"
                  onError={() => setVideoError(true)}
                />
              ) : (
                <img src="/brand/kortex-symbol.png" alt="" className="h-20 w-20 object-contain" />
              )}
            </div>
            <div className="mx-auto mt-7 h-3 max-w-md overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-4 text-sm font-semibold text-muted-foreground">Importando dados... {progress > 0 ? `${progress}%` : ""}</p>
          </div>
        ) : status === "success" ? (
          <div className="min-h-0 overflow-y-auto px-6 py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
              <Check className="h-8 w-8" />
            </div>
            <p className="mt-5 text-lg font-black text-foreground">
              {result?.imported || 0} contato{result?.imported === 1 ? "" : "s"} importado{result?.imported === 1 ? "" : "s"}.
            </p>
            {rejected.length > 0 && (
              <div className="mx-auto mt-4 max-w-lg rounded-xl border border-warning/30 bg-warning/10 p-3 text-left text-sm text-warning">
                <p className="font-black">{rejected.length} linha{rejected.length === 1 ? "" : "s"} rejeitada{rejected.length === 1 ? "" : "s"}.</p>
                <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
                  {rejected.slice(0, 8).map((item) => (
                    <li key={`${item.row}-${item.reason}`}>Linha {item.row}: {item.reason}</li>
                  ))}
                  {rejected.length > 8 && <li>Mais {rejected.length - 8} rejeição{rejected.length - 8 === 1 ? "" : "ões"}.</li>}
                </ul>
              </div>
            )}
          </div>
        ) : status === "error" ? (
          <div className="min-h-0 overflow-y-auto px-6 py-6">
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-black">{error || "Não foi possível importar o arquivo."}</p>
                  {rejected.length > 0 && (
                    <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
                      {rejected.slice(0, 10).map((item) => (
                        <li key={`${item.row}-${item.reason}`}>Linha {item.row}: {item.reason}</li>
                      ))}
                      {rejected.length > 10 && <li>Mais {rejected.length - 10} rejeição{rejected.length - 10 === 1 ? "" : "ões"}.</li>}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 overflow-y-auto px-5 py-5">
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                selectFile(event.dataTransfer.files.item(0));
              }}
              className="flex min-h-[190px] flex-col items-center justify-center rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-5 text-center"
            >
              <UploadCloud className="h-10 w-10 text-primary" />
              <p className="mt-3 text-sm font-black text-foreground">Arraste e solte o CSV aqui</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">ou selecione o arquivo no computador</p>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-primary px-4 text-sm font-bold text-primary transition hover:bg-primary hover:text-primary-foreground"
              >
                <FileText className="h-4 w-4" />
                Selecionar arquivo
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => selectFile(event.target.files?.item(0))}
              />
            </div>

            {file && (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm">
                <FileText className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                </div>
                <button type="button" onClick={resetSelection} className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground" aria-label="Remover arquivo">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {error && (
              <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">
          {status === "success" ? (
            <button type="button" onClick={onClose} className="h-10 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground transition hover:bg-primary/90">
              Concluído
            </button>
          ) : status === "error" ? (
            <>
              <button type="button" onClick={resetSelection} className="h-10 rounded-xl border border-border px-4 text-sm font-bold transition hover:border-primary">
                Tentar novamente
              </button>
              <button type="button" onClick={onClose} className="h-10 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground transition hover:bg-primary/90">
                Fechar
              </button>
            </>
          ) : status === "processing" ? (
            <button type="button" disabled className="h-10 rounded-xl border border-border px-4 text-sm font-bold text-muted-foreground opacity-70">
              Processando
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-sm font-bold transition hover:border-primary">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void startImport()}
                disabled={!file}
                className="h-10 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Importar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactModal({
  contact,
  companies,
  saving,
  onClose,
  onSubmit,
}: {
  contact: ContactWithCompany | null;
  companies: Pick<CompanyRow, "id" | "name">[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: ContactSubmitPayload) => Promise<ContactSubmitResult>;
}) {
  const [activeTab, setActiveTab] = useState<"contact" | "files">("contact");
  const draftKey = contactDraftKey(contact?.id);
  const draft = useMemo(() => readContactDraft(draftKey), [draftKey]);
  const [form, setForm] = useState<ContactFormValues>(() => draft?.form || formFromContact(contact));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState("");
  const [localNotice, setLocalNotice] = useState(draft ? "Rascunho carregado deste navegador." : "");
  const [quickNote, setQuickNote] = useState(() => draft?.quickNote || "");
  const [quickNotes, setQuickNotes] = useState<string[]>(() => draft?.quickNotes || []);
  const [files, setFiles] = useState<Array<{ id: string; file: File }>>([]);
  const modalRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const dirty = Boolean(
    form.fullName ||
      form.jobTitle ||
      form.companyName ||
      form.phone ||
      form.email ||
      form.observations ||
      quickNote ||
      quickNotes.length ||
      files.length,
  );

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const closeSafely = useCallback(() => {
    if (saving) return;
    if (!dirty || window.confirm("Existem alterações não salvas. Deseja fechar mesmo assim?")) onClose();
  }, [dirty, onClose, saving]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSafely();
      if (event.key !== "Tab" || !modalRef.current) return;

      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);

      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeSafely]);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const selectedFiles = Array.from(fileList).map((file) => ({ id: crypto.randomUUID(), file }));
    setFiles((current) => [...selectedFiles, ...current]);
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.fullName.trim()) nextErrors.fullName = "Informe o nome do contato.";
    if (form.email.trim() && !emailPattern.test(form.email.trim())) {
      nextErrors.email = "Informe um e-mail válido.";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError("");

    if (!validate()) {
      setActiveTab("contact");
      return;
    }

    const result = await onSubmit({
      values: form,
      quickNotes,
      selectedFilesCount: files.length,
    });

    if (!result.ok) {
      setLocalError(result.error || "Não foi possível salvar o contato.");
      return;
    }

    if (typeof window !== "undefined") window.localStorage.removeItem(draftKey);
    onClose();
  };

  const handleSaveDraft = () => {
    if (typeof window === "undefined") return;
    const draftToSave: ContactDraft = {
      form,
      quickNote,
      quickNotes,
      savedAt: new Date().toISOString(),
    };

    try {
      window.localStorage.setItem(draftKey, JSON.stringify(draftToSave));
      setLocalError("");
      setLocalNotice("Rascunho salvo neste navegador.");
    } catch {
      setLocalNotice("");
      setLocalError("Não foi possível salvar o rascunho neste navegador.");
    }
  };

  const addQuickNote = () => {
    const trimmed = quickNote.trim();
    if (!trimmed) return;
    setQuickNotes((current) => [trimmed, ...current]);
    setQuickNote("");
  };

  const displayName = form.fullName.trim() || (contact ? contact.full_name : "Contato sem nome");

  const unsupportedPlaceholder = "Não suportado pelo modelo atual";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm max-sm:p-3">
      <form
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-modal-title"
        onSubmit={handleSubmit}
        className="relative grid h-[min(650px,calc(100dvh_-_32px))] w-[min(1120px,calc(100vw_-_40px))] grid-cols-[220px_minmax(0,1fr)_245px] overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl max-xl:grid-cols-[220px_minmax(0,1fr)] max-lg:flex max-lg:h-[calc(100dvh_-_24px)] max-lg:w-[calc(100vw_-_24px)] max-lg:flex-col max-lg:overflow-y-auto"
      >
        <button
          type="button"
          onClick={closeSafely}
          className="absolute right-3 top-3 z-20 rounded-xl p-2 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
          aria-label="Fechar modal"
        >
          <X className="h-5 w-5" />
        </button>

        <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-border bg-muted/25 p-4 max-lg:min-h-fit max-lg:border-b max-lg:border-r-0 max-lg:overflow-visible">
          <div className="pr-9">
            <h2 id="contact-modal-title" className="text-lg font-black">{contact ? "Editar contato" : "Novo contato"}</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">Cadastre um novo lead e avance suas oportunidades.</p>
          </div>

          <div className="mt-3 flex items-center gap-3 border-b border-border pb-3 text-left">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {initials(displayName) ? <span className="text-base font-black">{initials(displayName)}</span> : <User className="h-6 w-6" />}
            </div>
            <div className="min-w-0">
              <p className="max-w-full truncate text-sm font-black text-foreground">{displayName}</p>
              <p className="mt-1 max-w-full truncate text-xs text-muted-foreground">{form.companyName || "Empresa não vinculada"}</p>
              <p className="mt-1 text-xs leading-4 text-muted-foreground">Foto de contato ainda não está disponível.</p>
            </div>
          </div>

          <div className="mt-3 grid gap-1.5 rounded-xl border border-border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
            <p className="font-black text-foreground">Resumo</p>
            <p>Nome: {form.fullName.trim() ? "preenchido" : "pendente"}</p>
            <p>E-mail: {form.email.trim() ? "preenchido" : "opcional"}</p>
            <p>Arquivos: {files.length}</p>
            <p>Notas: {quickNotes.length}</p>
          </div>

          <div className="mt-auto space-y-2 pt-4 max-lg:mt-4">
            <button
              type="submit"
              disabled={saving}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-black text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {contact ? "Salvar contato" : "Criar contato"}
            </button>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={saving}
              className="flex h-10 w-full items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-bold transition hover:border-primary disabled:opacity-50"
            >
              <Save className="mr-2 h-4 w-4" />
              Salvar rascunho
            </button>
            <button
              type="button"
              onClick={closeSafely}
              disabled={saving}
              className="flex h-9 w-full items-center justify-center rounded-xl text-sm font-bold text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden p-4 max-lg:flex-none max-lg:overflow-visible">
          <div className="pr-9">
            <div>
              <h2 className="text-lg font-black">Informações de contato</h2>
              <p className="mt-1 text-sm text-muted-foreground">Preencha os dados abaixo para cadastrar um novo contato.</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 rounded-xl border border-border bg-background p-1">
            <button
              type="button"
              onClick={() => setActiveTab("contact")}
              className={cn(
                "flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-bold transition",
                activeTab === "contact" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <User className="h-4 w-4" />
              Contato
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("files")}
              className={cn(
                "flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-bold transition",
                activeTab === "files" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FileText className="h-4 w-4" />
              Arquivos
            </button>
          </div>

          {activeTab === "contact" ? (
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin max-lg:overflow-visible">
              <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nome do contato" required error={errors.fullName}>
                <IconInput
                  inputRef={firstFieldRef}
                  icon={User}
                  value={form.fullName}
                  onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                  placeholder="Ex.: João Silva"
                />
              </Field>
              <Field label="Cargo">
                <IconInput
                  icon={Briefcase}
                  value={form.jobTitle}
                  onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}
                  placeholder="Ex.: Gerente, Diretora, Sócio"
                />
              </Field>
              <Field label="Empresa">
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    list="contacts-companies"
                    value={form.companyName}
                    onChange={(event) => setForm({ ...form, companyName: event.target.value })}
                    placeholder="Ex.: Empresa Ltda."
                    className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                  <datalist id="contacts-companies">
                    {companies.map((company) => (
                      <option key={company.id} value={company.name} />
                    ))}
                  </datalist>
                </div>
              </Field>
              <Field label="CNPJ">
                <IconInput
                  icon={FileText}
                  value=""
                  readOnly
                  disabled
                  placeholder={unsupportedPlaceholder}
                  className="cursor-not-allowed bg-muted/50 text-muted-foreground disabled:opacity-100"
                />
              </Field>
              <Field label="Telefone">
                <IconInput
                  icon={MessageCircle}
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  placeholder="(31) 98765-4321"
                />
              </Field>
              <Field label="E-mail" error={errors.email}>
                <IconInput
                  icon={Mail}
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  placeholder="contato@empresa.com"
                  type="email"
                />
              </Field>
              <Field label="Cidade">
                <IconInput
                  icon={Building2}
                  value=""
                  readOnly
                  disabled
                  placeholder={unsupportedPlaceholder}
                  className="cursor-not-allowed bg-muted/50 text-muted-foreground disabled:opacity-100"
                />
              </Field>
              <Field label="Estado">
                <IconInput
                  icon={Flag}
                  value=""
                  readOnly
                  disabled
                  placeholder={unsupportedPlaceholder}
                  className="cursor-not-allowed bg-muted/50 text-muted-foreground disabled:opacity-100"
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Canal de origem">
                  <IconInput
                    icon={Paperclip}
                    value=""
                    readOnly
                    disabled
                    placeholder={unsupportedPlaceholder}
                    className="cursor-not-allowed bg-muted/50 text-muted-foreground disabled:opacity-100"
                  />
                </Field>
              </div>
              <label className="block space-y-1 text-[13px] font-semibold text-foreground md:col-span-2">
                <span>Observações de contato</span>
                <textarea
                  value={form.observations}
                  onChange={(event) => setForm({ ...form, observations: event.target.value.slice(0, 1000) })}
                  className="min-h-[86px] w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
                  placeholder="Adicione informações relevantes sobre o contato..."
                />
                <span className="block text-right text-xs text-muted-foreground">{form.observations.length}/1000</span>
              </label>
              </div>
            </div>
          ) : (
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin max-lg:overflow-visible">
              <div className="space-y-4">
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addFiles(event.dataTransfer.files);
                }}
                className="flex min-h-[172px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background p-5 text-center"
              >
                <UploadCloud className="h-10 w-10 text-primary" />
                <p className="mt-3 text-sm font-black text-foreground">Arraste e solte arquivos aqui</p>
                <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                  Não há Supabase Storage configurado para contatos. Os arquivos ficam apenas selecionados nesta sessão e não serão enviados ao salvar.
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-primary px-4 text-sm font-bold text-primary transition hover:bg-primary hover:text-primary-foreground"
                >
                  <Paperclip className="h-4 w-4" />
                  Selecionar arquivo
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => addFiles(event.target.files)} />
              </div>

              <div>
                <h3 className="text-sm font-black text-foreground">Arquivos selecionados ({files.length})</h3>
                <div className="mt-3 space-y-2">
                  {files.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
                      Nenhum arquivo selecionado ainda.
                    </div>
                  ) : (
                    files.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <FileText className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-foreground">{item.file.name}</p>
                          <p className="text-xs text-muted-foreground">{formatFileSize(item.file.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFiles((current) => current.filter((file) => file.id !== item.id))}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Remover ${item.file.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            </div>
          )}

          {localError && (
            <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {localError}
            </div>
          )}

          {localNotice && (
            <div className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
              {localNotice}
            </div>
          )}

        </main>

        <aside className="flex min-h-0 flex-col overflow-y-auto border-l border-border bg-card p-4 max-xl:col-span-2 max-xl:border-l-0 max-xl:border-t max-lg:col-span-1 max-lg:flex-none max-lg:overflow-visible">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-start gap-3 pr-8">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-base font-black text-foreground">Notas rápidas</h3>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  Adicione uma nota sobre este contato. Suas anotações ajudam no acompanhamento.
                </p>
              </div>
            </div>

            <textarea
              value={quickNote}
              onChange={(event) => setQuickNote(event.target.value.slice(0, 2000))}
              className="mt-3 min-h-[180px] flex-1 resize-none rounded-xl border border-input bg-background px-3 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10 max-xl:min-h-[140px] max-lg:flex-none"
              placeholder="Digite sua nota aqui..."
            />
            <div className="mt-1 text-right text-xs text-muted-foreground">{quickNote.length}/2000</div>
            <button
              type="button"
              onClick={addQuickNote}
              className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-primary bg-primary/10 text-sm font-black text-primary transition hover:bg-primary hover:text-primary-foreground"
            >
              <Save className="h-4 w-4" />
              Salvar nota
            </button>

            <div className="mt-4 min-h-0 border-t border-border pt-3">
              <h4 className="text-sm font-black text-foreground">Notas para salvar ({quickNotes.length})</h4>
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1 scrollbar-thin max-lg:max-h-none max-lg:overflow-visible">
                {quickNotes.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-background p-4 text-center text-sm text-muted-foreground">
                    Nenhuma nota adicionada.
                  </div>
                ) : (
                  quickNotes.map((note, index) => (
                    <div key={`${note}-${index}`} className="rounded-xl border border-border bg-background p-3 text-sm">
                      <div className="mb-1 flex items-center gap-2 text-xs font-bold text-primary">
                        <Check className="h-3.5 w-3.5" />
                        Será salva com o contato
                      </div>
                      <p className="text-muted-foreground">{note}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
