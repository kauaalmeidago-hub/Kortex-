import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { TaskField } from "@/components/tasks/TaskFormDialog";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
import { useBusinessAccess } from "@/features/access/BusinessAccess";
import {
  emptyLead,
  pipelineCatalog,
  saveLead,
  type LeadRow,
  type LeadValues,
} from "./service";
export function LeadEditor({
  scope,
  stages,
  userId,
  previous,
  initialStage,
  onClose,
  onSaved,
  quick = false,
}: {
  scope: BusinessContext;
  stages: { id: string; name: string }[];
  userId: string;
  previous?: LeadRow;
  initialStage?: string;
  onClose: () => void;
  onSaved: () => void;
  quick?: boolean;
}) {
  const access = useBusinessAccess();
  const token = access.token;
  const [values, setValues] = useState<LeadValues>(() =>
    previous
      ? {
          title: previous.title,
          description: previous.description ?? "",
          company_id: previous.company_id ?? "",
          contact_id: previous.contact_id ?? "",
          value: previous.value ?? 0,
          stage_id: previous.stage_id,
          expected_close_date: previous.expected_close_date ?? "",
          status: previous.status,
          visibility: previous.visibility ?? "personal",
        }
      : emptyLead(initialStage ?? stages[0]?.id),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const creationId = useRef(crypto.randomUUID());
  const catalog = useQuery({
    queryKey: access.key("pipeline", "lead-catalog"),
    queryFn: ({ signal }) => pipelineCatalog(scope, signal),
    retry: false,
    refetchInterval: 15000,
  });
  const change = <K extends keyof LeadValues>(key: K, value: LeadValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent className="tasks-theme max-h-[88vh] overflow-auto sm:max-w-2xl">
        <DialogTitle>{previous ? "Editar registro" : quick ? "Adição rápida" : "Novo registro"}</DialogTitle>
        <DialogDescription>
          {scope.sector_name} · {scope.board_name}
        </DialogDescription>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current) return;
            lock.current = true;
            setError("");
            setBusy(true);
            try {
              await saveLead(scope, values, userId, previous, creationId.current);
              if (access.isCurrent(token)) {
                onSaved();
                onClose();
              }
            } catch (e) {
              setError((e as Error).message);
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          <TaskField label="Título">
            <input
              required
              maxLength={240}
              value={values.title}
              onChange={(e) => change("title", e.target.value)}
              placeholder="Informe o título do registro"
            />
          </TaskField>
          <div className="grid gap-4 sm:grid-cols-2">
            <TaskField label="Empresa">
              <select
                value={values.company_id}
                disabled={catalog.isLoading || catalog.isError}
                onChange={(e) => {
                  change("company_id", e.target.value);
                  change("contact_id", "");
                }}
              >
                <option value="">Sem empresa</option>
                {catalog.data?.companies.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </TaskField>
            <TaskField label="Contato">
              <select
                value={values.contact_id}
                disabled={catalog.isLoading || catalog.isError}
                onChange={(e) => change("contact_id", e.target.value)}
              >
                <option value="">Sem contato</option>
                {catalog.data?.contacts
                  .filter(
                    (c) =>
                      !values.company_id || c.company_id === values.company_id,
                  )
                  .map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.full_name}
                    </option>
                  ))}
              </select>
            </TaskField>
            {!quick && scope.sector_name.toLocaleLowerCase("pt-BR").includes("comercial") && <TaskField label="Valor">
              <input
                type="number"
                min="0"
                step="0.01"
                value={values.value}
                onChange={(e) => change("value", Number(e.target.value))}
              />
            </TaskField>}
            {!quick && <TaskField label="Previsão de fechamento">
              <input
                type="date"
                value={values.expected_close_date}
                onChange={(e) => change("expected_close_date", e.target.value)}
              />
            </TaskField>}
            <TaskField label="Coluna">
              <select
                required
                value={values.stage_id}
                onChange={(e) => change("stage_id", e.target.value)}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </TaskField>
            {!quick && <TaskField label="Situação">
              <select
                value={values.status}
                onChange={(e) =>
                  change("status", e.target.value as LeadValues["status"])
                }
              >
                {Object.entries({
                  new: "Novo",
                  qualified: "Qualificado",
                  proposal: "Proposta",
                  negotiation: "Negociação",
                  won: "Ganho",
                  lost: "Perdido",
                }).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </TaskField>}
          </div>
          {!quick && <TaskField label="Descrição">
            <textarea
              rows={4}
              maxLength={16000}
              value={values.description}
              onChange={(e) => change("description", e.target.value)}
              placeholder="Adicione informações do registro"
            />
          </TaskField>}
          {!previous && (
            <TaskField label="Visibilidade">
              <select
                value={values.visibility}
                onChange={(e) => change("visibility", e.target.value)}
              >
                <option value="personal">Pessoal</option>
                {scope.can_share && (
                  <option value="sector">
                    Compartilhado com o quadro autorizado
                  </option>
                )}
              </select>
            </TaskField>
          )}
          {(error || catalog.error) && (
            <p role="alert" className="task-error">
              {error || catalog.error?.message}
            </p>
          )}
          <div className="task-actions">
            <button
              type="button"
              className="task-button"
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              className="task-button task-cyan"
              disabled={busy || !scope.can_write}
            >
              {busy ? "Salvando..." : "Salvar registro"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
