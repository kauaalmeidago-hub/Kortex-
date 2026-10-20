import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { TaskField } from "@/components/tasks/TaskFormDialog";
import { supabase } from "@/integrations/supabase/client";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
import { taskFailure } from "@/features/tasks/service";
import { useBusinessAccess } from "./BusinessAccess";
export function BoardMembersEditor({
  scope,
  onClose,
}: {
  scope: BusinessContext;
  onClose: () => void;
}) {
  const access = useBusinessAccess();
  const client = useQueryClient();
  const [user, setUser] = useState("");
  const [write, setWrite] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = access.key(scope.kind, "board-members");
  const query = useQuery({
    queryKey: key,
    enabled: scope.can_manage,
    retry: false,
    refetchInterval: 15000,
    queryFn: async ({ signal }) => {
      const [people, members] = await Promise.all([
        supabase
          .rpc("business_people", { p_board: scope.board_id })
          .abortSignal(signal),
        supabase
          .from("business_board_members")
          .select("*")
          .eq("board_id", scope.board_id)
          .eq("active", true)
          .abortSignal(signal),
      ]);
      if (people.error) taskFailure(people.error);
      if (members.error) taskFailure(members.error);
      return { people: people.data, members: members.data };
    },
  });
  const save = async (person: string, active: boolean) => {
    const token = access.token;
    setBusy(true);
    setError("");
    try {
      const r = await supabase.rpc("business_set_board_member", {
        p_board: scope.board_id,
        p_user: person,
        p_active: active,
        p_write: active && write,
      });
      if (r.error) taskFailure(r.error);
      if (access.isCurrent(token)) {
        await client.invalidateQueries({ queryKey: key });
        setUser("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="tasks-theme sm:max-w-lg">
        <DialogTitle>Participantes de {scope.board_name}</DialogTitle>
        <DialogDescription>
          {scope.kind === "pipeline"
            ? "Os participantes convidados recebem acesso à pipeline dentro do mesmo setor."
            : "A participação no quadro preserva a privacidade das tarefas pessoais. A leitura delas exige autorização específica."}
        </DialogDescription>
        {query.isLoading ? (
          <p role="status">Carregando participantes...</p>
        ) : query.error ? (
          <p role="alert" className="task-error">
            {query.error.message}
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {query.data?.members.map((m) => (
                <li
                  className="flex items-center justify-between gap-3 text-sm"
                  key={m.user_id}
                >
                  <span>
                    {query.data?.people.find((p) => p.user_id === m.user_id)
                      ?.full_name || "Participante"}{" "}
                    · {m.can_write ? "Edição" : "Consulta"}
                  </span>
                  <button
                    type="button"
                    className="task-button"
                    disabled={busy}
                    onClick={() => void save(m.user_id, false)}
                  >
                    Revogar
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save(user, true);
              }}
            >
              <TaskField label="Integrante autorizado do setor">
                <select
                  required
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                >
                  <option value="">Selecione o integrante</option>
                  {query.data?.people.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.full_name || p.email || "Integrante"}
                    </option>
                  ))}
                </select>
              </TaskField>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={write}
                  onChange={(e) => setWrite(e.target.checked)}
                />
                Permitir edição no quadro
              </label>
              <button
                className="task-button task-cyan"
                disabled={busy || !user}
              >
                {busy ? "Salvando..." : "Salvar participação"}
              </button>
            </form>
          </>
        )}
        {error && (
          <p role="alert" className="task-error">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
