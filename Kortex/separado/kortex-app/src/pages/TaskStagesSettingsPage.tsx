import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTasksData } from "@/features/tasks/hooks";
import { BusinessContextPicker } from "@/features/access/BusinessAccess";
import { ColumnsEditor } from "@/features/access/ColumnsEditor";
import "./TasksPage.css";
export default function TaskStagesSettingsPage() {
  const { scope, catalog, access } = useTasksData();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  return (
    <div className="tasks-theme h-full overflow-auto">
      <BusinessContextPicker kind="tasks" />
      {scope && (
        <div className="space-y-5 p-5">
          <Link className="task-link" to="/tasks">
            ← Voltar para tarefas
          </Link>
          <h1 className="text-lg font-semibold">
            Colunas de {scope.board_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            A configuração pertence a este quadro. A remoção exige uma coluna de
            destino e permissão para movimentar todos os registros afetados.
          </p>
          {catalog.isError ? (
            <p role="alert" className="task-error">
              {catalog.error.message}
            </p>
          ) : catalog.isLoading ? (
            <p role="status">Carregando colunas...</p>
          ) : (
            <>
              <ul className="space-y-2">
                {catalog.data?.stages
                  .filter((s) => !s.archived)
                  .map((s) => (
                    <li
                      key={s.id}
                      className="max-w-xl rounded-xl border border-border bg-card p-3 text-sm"
                    >
                      {s.name}
                    </li>
                  ))}
              </ul>
              {scope.can_manage ? (
                <button
                  className="task-button task-cyan"
                  disabled={!catalog.data}
                  onClick={() => setEditing(true)}
                >
                  Gerenciar colunas
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sua associação permite consultar as colunas. A alteração exige
                  gestão deste quadro.
                </p>
              )}
            </>
          )}
          {editing && catalog.data && (
            <ColumnsEditor
              key={scope.board_id}
              scope={scope}
              columns={catalog.data.stages.filter((s) => !s.archived)}
              onClose={() => setEditing(false)}
              onSaved={() => {
                void client.invalidateQueries({
                  queryKey: access.key("tasks", "task-catalog"),
                });
                void client.invalidateQueries({
                  queryKey: access.key("tasks", "tasks"),
                });
                access.retry();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
