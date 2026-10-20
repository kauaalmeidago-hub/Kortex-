import { useRef, useState, type ReactNode } from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CompanyAvatar,
  CompanyField,
  CompanyFields,
  CompanyPhoto,
} from "@/components/companies/CompanyForm";
import KoaChatComposer from "@/components/KoaChatComposer";
import { type Company, type CompanyContact } from "@/features/companies/model";
import {
  companyFileUrl,
  getCompany,
  linkCompanyContact,
  listCompanyContacts,
  listCompanyFiles,
  listCompanyNotes,
  saveCompanyContact,
  saveCompanyNote,
  removeCompanyFile,
  unassignedCompanyContacts,
  uploadCompanyFile,
  type ContactValues,
} from "@/features/companies/service";
import { useCompanyEditor } from "@/features/companies/useCompanyEditor";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import "./CompaniesPage.css";

const date = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
export default function CompanyProfilePage() {
  const { companyId = "" } = useParams();
  const { workspace, user, loading } = useAuth();
  const [params] = useSearchParams();
  const validId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      companyId,
    );
  const query = useQuery({
    queryKey: ["company", workspace?.id, user?.id, companyId],
    queryFn: () => getCompany(workspace!.id, companyId),
    enabled: Boolean(validId && workspace && user),
  });
  const savedReturn = params.get("return") ?? "";
  const back = `/companies${savedReturn.startsWith("?") ? savedReturn : ""}`;
  if (!query.data)
    return (
      <div className="companies-theme company-profile-page">
        <Link className="company-back" to={back}>
          <ArrowLeft size={17} />
          Voltar para empresas
        </Link>
        <div className="company-empty">
          <MessageSquare size={32} />
          <h1>
            {loading || Boolean(validId && workspace && user && query.isLoading)
              ? "Carregando empresa..."
              : query.isError
                ? "Não foi possível carregar a empresa"
                : !user || !workspace
                  ? "Selecione um workspace"
                  : "Empresa não encontrada"}
          </h1>
          <p>
            {query.isError
              ? (query.error as Error).message
              : !workspace || !user
                ? "Entre em um workspace para acessar os dados da empresa."
                : "Confira o endereço ou volte para a listagem."}
          </p>
          {query.isError && (
            <button
              className="company-button"
              onClick={() => void query.refetch()}
            >
              Tentar novamente
            </button>
          )}
        </div>
      </div>
    );
  return (
    <CompanyProfileContent
      key={`${workspace.id}:${user.id}:${companyId}`}
      company={query.data}
      workspaceId={workspace.id}
      userId={user.id}
      back={back}
    />
  );
}

export function CompanyProfileContent({
  company,
  workspaceId,
  userId,
  back = "/companies",
  backLabel = "Voltar para empresas",
  origin,
  canEdit = true,
  initialContactId = "",
}: {
  company: Company;
  workspaceId?: string;
  userId?: string;
  back?: string;
  backLabel?: string;
  origin?: ReactNode;
  canEdit?: boolean;
  initialContactId?: string;
}) {
  const editor = useCompanyEditor(workspaceId, userId, company);
  useUnsavedChanges(editor.dirty);
  const client = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const tab =
    requestedTab === "notes"
      ? "notes"
      : requestedTab === "conversation"
        ? "conversation"
        : requestedTab === "files" || location.pathname.endsWith("/files")
          ? "files"
          : "conversation";
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState(initialContactId);
  const [contactEditor, setContactEditor] = useState<
    CompanyContact | null | undefined
  >();
  const contactTrigger = useRef<HTMLButtonElement | null>(null);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const enabled = Boolean(workspaceId && userId);
  const contacts = useQuery({
    queryKey: ["company-contacts", workspaceId, userId, company.id],
    queryFn: () => listCompanyContacts(workspaceId!, company.id),
    enabled,
  });
  const selected = contacts.data?.find((c) => c.id === selectedContact);
  const matches = (contacts.data ?? []).filter((c) =>
    `${c.full_name} ${c.job_title ?? ""}`
      .toLocaleLowerCase("pt-BR")
      .includes(contactSearch.toLocaleLowerCase("pt-BR")),
  );
  const changeTab = (next: string) => {
    const search = new URLSearchParams(params);
    search.set("tab", next);
    setParams(search, { replace: true });
  };
  return (
    <div className={`companies-theme company-profile-page${origin ? " pipeline-record-page" : ""}`}>
      <Link className="company-back" to={back}>
        <ArrowLeft size={17} />
        {backLabel}
      </Link>
      <h1 className="sr-only">Perfil de {company.name}</h1>
      <div className="company-profile-layout">
        <aside className="company-profile-sidebar">
          <CompanyPhoto
            name={editor.values.name}
            image={editor.imageUrl}
            onChange={editor.chooseImage}
            onRemove={editor.removeImage}
            disabled={editor.saving || !canEdit}
          />
          <h2 className="company-profile-name">{company.name}</h2>
          <section className="company-contacts">
            <header>
              <h3>Contatos da empresa</h3>
              <button
                type="button"
                className="company-link"
                disabled={!canEdit}
                onClick={(event) => {
                  contactTrigger.current = event.currentTarget;
                  setContactEditor(null);
                }}
              >
                Adicionar contato
              </button>
            </header>
            <div className="companies-search">
              <Search size={15} />
              <input
                type="search"
                aria-label="Buscar contatos da empresa"
                placeholder="Nome do contato"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
              />
            </div>
            {contacts.isError ? (
              <CompanyQueryError
                error={contacts.error}
                onRetry={() => void contacts.refetch()}
              />
            ) : contacts.isLoading && enabled ? (
              <p className="company-feedback">Carregando contatos...</p>
            ) : matches.length ? (
              matches.map((contact) => (
                <div className="company-contact" key={contact.id}>
                  <button
                    type="button"
                    className="company-contact-main"
                    aria-pressed={selectedContact === contact.id}
                    onClick={() => {
                      setSelectedContact(contact.id);
                      changeTab("conversation");
                    }}
                  >
                    <CompanyAvatar name={contact.full_name} />
                    <span>
                      <strong>{contact.full_name}</strong>
                      {contact.job_title && <small>{contact.job_title}</small>}
                    </span>
                  </button>
                  {contact.can_edit !== false && canEdit && <DropdownMenu>
                    <DropdownMenuTrigger asChild><button type="button" className="company-icon-button" aria-label={`Ações de ${contact.full_name}`} onClick={event => { contactTrigger.current = event.currentTarget; }}>
                      <MoreHorizontal size={17} />
                    </button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end"><DropdownMenuItem
                      onSelect={() => {
                        setContactEditor(contact);
                      }}
                    >
                      <Pencil size={13} />
                      Editar contato
                    </DropdownMenuItem></DropdownMenuContent>
                  </DropdownMenu>}
                </div>
              ))
            ) : (
              <p className="company-feedback">
                {contactSearch
                  ? "Nenhum contato encontrado."
                  : "Nenhum contato vinculado."}
              </p>
            )}
          </section>
        </aside>
        <div className="company-profile-main">
          <form
            className="company-profile-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await editor.save();
            }}
          >
            <CompanyFields
              values={editor.values}
              onChange={editor.setValues}
              disabled={editor.saving || !canEdit}
            />
            {editor.error && (
              <p role="alert" className="company-feedback company-error">
                {editor.error}
              </p>
            )}
            {editor.notice && (
              <p role="status" className="company-feedback">
                {editor.notice}
              </p>
            )}
            <footer className="company-actions">
              <button
                type="submit"
                className="company-button company-cyan"
                disabled={editor.saving || !enabled || !canEdit}
              >
                {editor.saving ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar alterações"
                )}
              </button>
            </footer>
          </form>
          {origin}
          <section className="company-activity">
            <div
              role="tablist"
              aria-label="Atividade da empresa"
              className="company-tabs"
            >
              {[
                { id: "conversation", label: "Conversa", Icon: MessageSquare },
                { id: "notes", label: "Notas", Icon: FileText },
                { id: "files", label: "Arquivos", Icon: Paperclip },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  id={`company-tab-${id}`}
                  role="tab"
                  aria-selected={tab === id}
                  tabIndex={tab === id ? 0 : -1}
                  aria-controls="company-activity-panel"
                  onClick={() => changeTab(id)}
                  onKeyDown={(event) => {
                    const ids = ["conversation", "notes", "files"];
                    const index = ids.indexOf(id);
                    const next =
                      event.key === "ArrowRight"
                        ? (index + 1) % 3
                        : event.key === "ArrowLeft"
                          ? (index + 2) % 3
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? 2
                              : -1;
                    if (next >= 0) {
                      event.preventDefault();
                      changeTab(ids[next]);
                      document
                        .getElementById(`company-tab-${ids[next]}`)
                        ?.focus();
                    }
                  }}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>
            <div
              id="company-activity-panel"
              role="tabpanel"
              aria-labelledby={`company-tab-${tab}`}
              className="company-activity-panel"
            >
              {tab === "conversation" ? (
                <>
                  <div className="company-conversation-body">
                    {selected ? (
                      <>
                        <p className="font-medium">{selected.full_name}</p>
                        <p className="company-feedback">
                          O histórico e o envio de conversas deste contato ainda
                          não estão conectados. Nenhuma mensagem será enviada.
                        </p>
                      </>
                    ) : (
                      <div className="company-empty company-conversation-empty">
                        <MessageSquare size={52} strokeWidth={1.15} />
                        <p>Selecione um contato para conversar.</p>
                      </div>
                    )}
                  </div>
                  <fieldset
                    disabled={!selected}
                    className="company-conversation-composer"
                  >
                    <KoaChatComposer
                      value={selected ? (chatDrafts[selected.id] ?? "") : ""}
                      onChange={(value) => {
                        if (selected)
                          setChatDrafts((current) => ({
                            ...current,
                            [selected.id]: value,
                          }));
                      }}
                      onSubmit={() => {}}
                      disabled
                      inputLabel={
                        selected
                          ? `Rascunho para ${selected.full_name}`
                          : "Selecione um contato para conversar"
                      }
                      attachmentDisabled
                      attachmentTitle="Integração de conversas ainda indisponível"
                    />
                  </fieldset>
                </>
              ) : null}
              <div hidden={tab !== "notes"}>
                <CompanyNotes
                  key={company.id}
                  companyId={company.id}
                  workspaceId={workspaceId}
                  userId={userId}
                  canEdit={canEdit}
                />
              </div>
              {tab === "files" && (
                <CompanyFiles
                  companyId={company.id}
                  workspaceId={workspaceId}
                  userId={userId}
                  canEdit={canEdit}
                />
              )}
            </div>
          </section>
        </div>
      </div>
      <Dialog
        open={contactEditor !== undefined}
        onOpenChange={(open) => {
          if (!open) setContactEditor(undefined);
        }}
      >
        <DialogContent
          className="companies-theme company-contact-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            contactTrigger.current?.focus();
          }}
        >
          <DialogTitle>
            {contactEditor ? "Editar contato" : "Adicionar contato"}
          </DialogTitle>
          <DialogDescription>
            Contato vinculado a {company.name}.
          </DialogDescription>
          <DialogClose asChild>
            <button
              type="button"
              className="company-dialog-close"
              aria-label="Fechar cadastro de contato"
            >
              <X size={18} />
            </button>
          </DialogClose>
          {contactEditor !== undefined && (
            <ContactEditor
              key={contactEditor?.id ?? "new"}
              companyId={company.id}
              contact={contactEditor}
              workspaceId={workspaceId}
              userId={userId}
                  sectorId={company.sector_id ?? undefined}
              onSaved={async () => {
                await client.invalidateQueries({
                  queryKey: ["company-contacts", workspaceId],
                });
                await client.invalidateQueries({ queryKey: ["contacts"] });
                await client.invalidateQueries({ predicate: q => ["pipeline-data", "pipeline-record", "lead-catalog"].includes(String(q.queryKey[1])) });
                setContactEditor(undefined);
              }}
              onCancel={() => setContactEditor(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function CompanyQueryError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="company-feedback company-error">
      <p>{(error as Error).message}</p>
      <button type="button" className="company-link" onClick={onRetry}>
        Tentar novamente
      </button>
    </div>
  );
}
function ContactEditor({
  companyId,
  contact,
  workspaceId,
  userId,
  onSaved,
  onCancel,
  sectorId,
}: {
  companyId: string;
  contact: CompanyContact | null;
  workspaceId?: string;
  userId?: string;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  sectorId?: string;
}) {
  const [values, setValues] = useState<ContactValues>(() => ({
    full_name: contact?.full_name ?? "",
    job_title: contact?.job_title ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
  }));
  const [mode, setMode] = useState("new");
  const [existing, setExisting] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const available = useQuery({
    queryKey: ["unassigned-company-contacts", workspaceId, userId],
    queryFn: () => unassignedCompanyContacts(workspaceId!),
    enabled: Boolean(workspaceId && userId && mode === "link"),
  });
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (inFlight.current) return;
        inFlight.current = true;
        setSaving(true);
        setError("");
        try {
          const scope = {
            workspaceId: workspaceId ?? "",
            userId: userId ?? "",
            sectorId,
          };
          if (mode === "link") {
            if (!existing) throw new Error("Selecione um contato.");
            await linkCompanyContact(scope, companyId, existing);
          } else
            await saveCompanyContact(scope, companyId, values, contact?.id);
          await onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          inFlight.current = false;
          setSaving(false);
        }
      }}
    >
      {!contact && (
        <div className="company-contact-mode">
          <button
            type="button"
            className="company-button"
            aria-pressed={mode === "new"}
            onClick={() => setMode("new")}
          >
            Novo contato
          </button>
          <button
            type="button"
            className="company-button"
            aria-pressed={mode === "link"}
            onClick={() => setMode("link")}
          >
            Vincular existente
          </button>
        </div>
      )}
      {mode === "link" ? (
        <CompanyField label="Contato sem empresa">
          <select
            value={existing}
            onChange={(e) => setExisting(e.target.value)}
          >
            <option value="">Selecione um contato</option>
            {available.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
          {available.isError && (
            <p role="alert">{(available.error as Error).message}</p>
          )}
          {!available.isLoading && !available.data?.length && (
            <small>Nenhum contato disponível para vincular.</small>
          )}
        </CompanyField>
      ) : (
        <div className="company-contact-fields">
          {(
            [
              ["full_name", "Nome do contato", "Digite o nome do contato"],
              ["job_title", "Função", "Informe a função"],
              ["phone", "Telefone do contato", "Informe o telefone"],
              ["email", "E-mail do contato", "Informe o e-mail"],
            ] as const
          ).map(([key, label, placeholder]) => (
            <CompanyField key={key} label={label}>
              <input
                required={key === "full_name"}
                type={
                  key === "email" ? "email" : key === "phone" ? "tel" : "text"
                }
                value={values[key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
                placeholder={placeholder}
                disabled={saving}
              />
            </CompanyField>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="company-feedback company-error">
          {error}
        </p>
      )}
      {(!workspaceId || !userId) && (
        <p className="company-feedback">
          Entre em um workspace para salvar o contato.
        </p>
      )}
      <footer className="company-actions">
        <button
          type="button"
          className="company-button"
          onClick={onCancel}
          disabled={saving}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="company-button company-cyan"
          disabled={saving || !workspaceId || !userId}
        >
          {saving
            ? "Salvando..."
            : mode === "link"
              ? "Vincular contato"
              : "Salvar contato"}
        </button>
      </footer>
    </form>
  );
}
function CompanyNotes({
  companyId,
  workspaceId,
  userId,
  canEdit = true,
}: {
  companyId: string;
  workspaceId?: string;
  userId?: string;
  canEdit?: boolean;
}) {
  const client = useQueryClient();
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  useUnsavedChanges(Boolean(content.trim()));
  const notes = useQuery({
    queryKey: ["company-notes", workspaceId, userId, companyId],
    queryFn: () => listCompanyNotes(workspaceId!, companyId),
    enabled: Boolean(workspaceId && userId),
  });
  return (
    <div className="company-notes-body">
      {canEdit && <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (inFlight.current) return;
          inFlight.current = true;
          setSaving(true);
          setError("");
          try {
            await saveCompanyNote(
              { workspaceId: workspaceId ?? "", userId: userId ?? "" },
              companyId,
              content,
              editing,
            );
            await client.invalidateQueries({
              queryKey: ["company-notes", workspaceId, userId, companyId],
            });
            setContent("");
            setEditing(undefined);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            inFlight.current = false;
            setSaving(false);
          }
        }}
      >
        <CompanyField label={editing ? "Editar nota" : "Nova nota"}>
          <textarea
            rows={3}
            placeholder="Escreva uma nota sobre esta empresa"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={saving}
          />
        </CompanyField>
        <div className="company-actions">
          {editing && (
            <button
              type="button"
              className="company-button"
              onClick={() => {
                setEditing(undefined);
                setContent("");
              }}
            >
              Cancelar edição
            </button>
          )}
          <button
            type="submit"
            className="company-button company-primary"
            disabled={saving || !content.trim() || !workspaceId || !userId}
          >
            {saving ? "Salvando..." : "Salvar nota"}
          </button>
        </div>
      </form>}
      {error && (
        <p role="alert" className="company-feedback company-error">
          {error}
        </p>
      )}
      {notes.isError ? (
        <CompanyQueryError
          error={notes.error}
          onRetry={() => void notes.refetch()}
        />
      ) : notes.isLoading && workspaceId ? (
        <p className="company-feedback">Carregando notas...</p>
      ) : notes.data?.length ? (
        notes.data.map((note) => (
          <article className="company-note" key={note.id}>
            <p>{note.content}</p>
            <footer>
              <time>{date(note.updated_at)}</time>
              {canEdit && note.user_id === userId && <button
                type="button"
                className="company-link"
                onClick={() => {
                  setEditing(note.id);
                  setContent(note.content);
                }}
              >
                Editar nota
              </button>}
            </footer>
          </article>
        ))
      ) : (
        <p className="company-feedback">
          Nenhuma nota cadastrada para esta empresa.
        </p>
      )}
    </div>
  );
}
function CompanyFiles({
  companyId,
  workspaceId,
  userId,
  canEdit = true,
}: {
  companyId: string;
  workspaceId?: string;
  userId?: string;
  canEdit?: boolean;
}) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const files = useQuery({
    queryKey: ["company-files", workspaceId, userId, companyId],
    queryFn: () => listCompanyFiles(workspaceId!, companyId),
    enabled: Boolean(workspaceId && userId),
  });
  return (
    <div className="company-files-body">
      <div className="company-actions">
        <input
          ref={input}
          type="file"
          aria-label="Arquivo da empresa"
          className="sr-only"
          disabled={busy || !workspaceId || !userId || !canEdit}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file || inFlight.current) return;
            inFlight.current = true;
            setBusy(true);
            setError("");
            try {
              await uploadCompanyFile(
                { workspaceId: workspaceId ?? "", userId: userId ?? "" },
                companyId,
                file,
              );
              await client.invalidateQueries({
                queryKey: ["company-files", workspaceId, userId, companyId],
              });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              inFlight.current = false;
              setBusy(false);
            }
          }}
        />
        <button
          type="button"
          className="company-button company-primary"
          disabled={busy || !workspaceId || !userId || !canEdit}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} />
          {busy ? "Enviando..." : "Enviar arquivo"}
        </button>
      </div>
      <p className="company-feedback">
        Arquivos privados desta empresa · até 20 MB por arquivo.
      </p>
      {error && (
        <p role="alert" className="company-feedback company-error">
          {error}
        </p>
      )}
      {files.isError ? (
        <CompanyQueryError
          error={files.error}
          onRetry={() => void files.refetch()}
        />
      ) : files.isLoading && workspaceId ? (
        <p className="company-feedback">Carregando arquivos...</p>
      ) : files.data?.length ? (
        files.data.map((file) => (
          <div className="company-file" key={file.id}>
            <FileText size={20} />
            <div>
              <strong>{file.name}</strong>
              <small>
                {(file.size_bytes / 1024).toLocaleString("pt-BR", {
                  maximumFractionDigits: 1,
                })}{" "}
                KB · {date(file.created_at)}
              </small>
            </div>
            <button
              type="button"
              className="company-icon-button"
              aria-label={`Baixar ${file.name}`}
              onClick={async () => {
                setError("");
                try {
                  const url = await companyFileUrl(file);
                  const link = document.createElement("a");
                  link.href = url;
                  link.rel = "noopener";
                  link.download = file.name;
                  link.click();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Download size={17} />
            </button>
            {canEdit && <button type="button" className="company-icon-button" aria-label={`Remover ${file.name}`} disabled={busy}
              onClick={async () => {
                if (inFlight.current || !window.confirm(`Remover o arquivo ${file.name}?`)) return;
                inFlight.current = true; setBusy(true); setError("");
                try {
                  await removeCompanyFile({ workspaceId: workspaceId ?? "", userId: userId ?? "" }, file);
                  await client.invalidateQueries({ queryKey: ["company-files", workspaceId, userId, companyId] });
                } catch (e) { setError((e as Error).message); }
                finally { inFlight.current = false; setBusy(false); }
              }}><Trash2 size={17} /></button>}
          </div>
        ))
      ) : (
        <div className="company-empty">
          <Paperclip size={30} />
          <p>Nenhum arquivo nesta empresa.</p>
        </div>
      )}
    </div>
  );
}
