import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
import type { Json } from "@/integrations/supabase/types";
import { TaskField } from "@/components/tasks/TaskFormDialog";
import { taskFailure } from "@/features/tasks/service";
export type BoardColumn = {
  id: string;
  name: string;
  color: string;
  position: number;
  base_status?: string;
};
export function ColumnsEditor({
  scope,
  columns,
  onClose,
  onSaved,
}: {
  scope: BusinessContext;
  columns: BoardColumn[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(columns);
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const removed = columns.filter((c) => !draft.some((d) => d.id === c.id));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="tasks-theme max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogTitle>Colunas de {scope.board_name}</DialogTitle>
        <DialogDescription>
          As alterações se aplicam a este quadro. Ao remover uma coluna, escolha
          o destino dos registros.
        </DialogDescription>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await supabase.rpc("business_save_columns", {
                p_board: scope.board_id,
                p_version: scope.version,
                p_columns: draft as unknown as Json,
                p_moves: moves,
              });
              if (r.error) taskFailure(r.error);
              onSaved();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {draft.map((c, i) => (
            <div className="flex items-end gap-2" key={c.id}>
              <div className="flex-1">
                <TaskField label={`Coluna ${i + 1}`}>
                  <input
                    required
                    maxLength={80}
                    value={c.name}
                    disabled={busy}
                    onChange={(e) =>
                      setDraft((rows) =>
                        rows.map((row) =>
                          row.id === c.id
                            ? { ...row, name: e.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </TaskField>
              </div>
              <button
                type="button"
                className="task-button"
                aria-label={`Remover ${c.name}`}
                disabled={busy || draft.length === 1}
                onClick={() =>
                  setDraft((rows) => rows.filter((row) => row.id !== c.id))
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
          {removed.map((c) => (
            <TaskField key={c.id} label={`Mover registros de “${c.name}” para`}>
              <select
                required
                value={moves[c.id] ?? ""}
                onChange={(e) =>
                  setMoves((v) => ({ ...v, [c.id]: e.target.value }))
                }
              >
                <option value="">Selecione uma coluna do mesmo quadro</option>
                {draft.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </TaskField>
          ))}
          <button
            type="button"
            className="task-button"
            disabled={busy || draft.length >= 30}
            onClick={() =>
              setDraft((v) => [
                ...v,
                {
                  id: crypto.randomUUID(),
                  name: "Nova coluna",
                  color: "blue",
                  position: v.length,
                  base_status: "todo",
                },
              ])
            }
          >
            <Plus size={16} />
            Adicionar coluna
          </button>
          {error && (
            <p className="task-error" role="alert">
              {error}
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
              disabled={busy || !scope.can_manage}
            >
              {busy ? "Salvando..." : "Salvar colunas"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
