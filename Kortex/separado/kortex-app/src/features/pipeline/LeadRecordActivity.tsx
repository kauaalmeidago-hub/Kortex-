import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { useBusinessAccess } from '@/features/access/BusinessAccess';
import { supabase } from '@/integrations/supabase/client';
import { taskFailure, validateTaskAttachment } from '@/features/tasks/service';
import type { BusinessContext } from '@/integrations/supabase/businessTypes';
import type { LeadRow } from './service';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
export default function LeadRecordActivity({
  scope,
  lead,
  userId,
  tab,
  active = true,
  authorNames = {},
}: {
  scope: BusinessContext;
  lead: LeadRow;
  userId: string;
  tab: "notes" | "activities" | "files" | "conversation";
  active?: boolean;
  authorNames?: Record<string,string>;
}) {
  const access = useBusinessAccess();
  const client = useQueryClient();
  const token = access.token;
  const key = [...access.key("pipeline", `lead-${tab}`), lead.id];
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const lock = useRef(false);
  useUnsavedChanges(Boolean(text.trim()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notes = useQuery({
    queryKey: [...access.key("pipeline", "lead-notes"), lead.id],
    enabled: active && tab === "notes",
    retry: false,
    refetchInterval: 15000,
    queryFn: async ({ signal }) => {
      const r = await supabase
        .from("notes")
        .select("id,content,created_at,updated_at,user_id")
        .eq("workspace_id", scope.workspace_id)
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .abortSignal(signal);
      if (r.error) taskFailure(r.error);
      return r.data;
    },
  });
  const activities = useQuery({
    queryKey: [...access.key("pipeline", "lead-activities"), lead.id],
    enabled: active && tab === "activities",
    retry: false,
    refetchInterval: 15000,
    queryFn: async ({ signal }) => {
      const r = await supabase
        .from("activities")
        .select("id,type,content,created_at")
        .eq("workspace_id", scope.workspace_id)
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .abortSignal(signal);
      if (r.error) taskFailure(r.error);
      return r.data;
    },
  });
  const files = useQuery({
    queryKey: [...access.key("pipeline", "lead-files"), lead.id],
    enabled: active && tab === "files",
    retry: false,
    refetchInterval: 15000,
    queryFn: async ({ signal }) => {
      const r = await supabase
        .from("lead_files")
        .select("*")
        .eq("workspace_id", scope.workspace_id)
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .abortSignal(signal);
      if (r.error) taskFailure(r.error);
      return r.data;
    },
  });
  const refresh = () => {
    if (access.isCurrent(token))
      void client.invalidateQueries({ queryKey: key });
  };
  const act = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const current =
    tab === "notes" ? notes : tab === "activities" ? activities : files;
  return (
    <div className="space-y-4 p-5">
      {tab === "conversation" ? (
        <p className="text-sm text-muted-foreground">
          A integração de conversa com o contato ainda não está disponível neste
          módulo.
        </p>
      ) : current.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando...
        </p>
      ) : current.error ? (
        <p role="alert" className="task-error">
          {current.error.message}
        </p>
      ) : (
        <>
          {tab === "notes" && (
            <>
              {notes.data?.map((n) => (
                <article
                  key={n.id}
                  className="rounded-lg border border-border p-3"
                >
                  <p className="whitespace-pre-wrap text-sm">{n.content}</p>
                  <small className="text-muted-foreground">
                    {authorNames[n.user_id] || (n.user_id === userId ? "Você" : "Autor indisponível")} · {new Date(n.created_at).toLocaleString("pt-BR")}
                  </small>
                  {lead.can_edit && n.user_id === userId && <button className="company-link ml-3" onClick={() => { setEditing(n.id); setText(n.content); }}>Editar nota</button>}
                </article>
              ))}
              {!notes.data?.length && (
                <p className="text-sm text-muted-foreground">
                  Nenhuma nota registrada.
                </p>
              )}
              {lead.can_edit && (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      const previous = notes.data?.find(n => n.id === editing);
                      const r = editing && previous ? await supabase.from("notes").update({content: text.trim()})
                        .eq("workspace_id", scope.workspace_id).eq("lead_id", lead.id).eq("id", editing)
                        .eq("updated_at", previous.updated_at).select("id").single() : await supabase.from("notes").insert({
                          workspace_id: scope.workspace_id,
                          lead_id: lead.id,
                          user_id: userId,
                          content: text.trim(),
                        });
                      if (r.error) taskFailure(r.error);
                      if (access.isCurrent(token)) { setText(""); setEditing(null); }
                      refresh();
                    });
                  }}
                >
                  <textarea
                    className="w-full rounded-xl border border-border bg-background p-3 text-sm"
                    maxLength={16000}
                    required
                    placeholder="Escreva uma nota..."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <button
                    className="task-button task-cyan"
                    disabled={busy || !text.trim()}
                  >
                    Salvar nota
                  </button>
                  {editing && <button type="button" className="company-button ml-2" onClick={() => {setEditing(null); setText("");}}>Cancelar edição</button>}
                </form>
              )}
            </>
          )}
          {tab === "activities" && (
            <>
              {activities.data?.map((a) => (
                <article
                  key={a.id}
                  className="border-b border-border py-3 text-sm"
                >
                  <p>{a.content || a.type}</p>
                  <small className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleString("pt-BR")}
                  </small>
                </article>
              ))}
              {!activities.data?.length && (
                <p className="text-sm text-muted-foreground">
                  Nenhuma atividade registrada.
                </p>
              )}
            </>
          )}
          {tab === "files" && (
            <>
              {files.data?.map((f) => (
                <div
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
                  key={f.id}
                >
                  <Paperclip size={16} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {f.name}
                  </span>
                  <button
                    className="task-button"
                    aria-label={`Baixar ${f.name}`}
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const r = await supabase.storage
                          .from("lead-files")
                          .createSignedUrl(f.storage_path, 60, {
                            download: f.name,
                          });
                        if (r.error) taskFailure(r.error);
                        if (!access.isCurrent(token)) return;
                        const link = document.createElement("a");
                        link.href = r.data.signedUrl;
                        link.download = f.name;
                        link.rel = "noopener";
                        link.click();
                      })
                    }
                  >
                    <Download size={15} />
                  </button>
                  {lead.can_edit && (
                    <button
                      className="task-button"
                      disabled={busy}
                      aria-label={`Remover ${f.name}`}
                      onClick={() =>
                        void act(async () => {
                          const stored = await supabase.storage
                            .from("lead-files")
                            .remove([f.storage_path]);
                          if (stored.error) taskFailure(stored.error);
                          const row = await supabase
                            .from("lead_files")
                            .delete()
                            .eq("id", f.id)
                            .eq("lead_id", lead.id);
                          if (row.error) taskFailure(row.error);
                          refresh();
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
              {!files.data?.length && (
                <p className="text-sm text-muted-foreground">
                  Nenhum arquivo vinculado.
                </p>
              )}
              {lead.can_edit && (
                <label className="task-button w-fit">
                  <Paperclip size={16} />
                  Anexar arquivo
                  <input
                    type="file"
                    disabled={busy}
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      void act(async () => {
                        validateTaskAttachment(file);
                        const id = crypto.randomUUID();
                        const path = `${scope.workspace_id}/${lead.id}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
                        const upload = await supabase.storage
                          .from("lead-files")
                          .upload(path, file, { upsert: false });
                        if (upload.error) taskFailure(upload.error);
                        const r = await supabase
                          .from("lead_files")
                          .insert({
                            id,
                            workspace_id: scope.workspace_id,
                            lead_id: lead.id,
                            storage_path: path,
                            name: file.name,
                            mime_type: file.type || "application/octet-stream",
                            size_bytes: file.size,
                            created_by: userId,
                          });
                        if (r.error) {
                          await supabase.storage
                            .from("lead-files")
                            .remove([path]);
                          taskFailure(r.error);
                        }
                        refresh();
                      });
                    }}
                  />
                </label>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      {busy && <p role="status" className="text-sm text-muted-foreground">{tab === "files" ? "Processando arquivo..." : "Salvando..."}</p>}
    </div>
  );
}

