import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BusinessContextPicker,
  useBusinessAccess,
} from "@/features/access/BusinessAccess";
import { ColumnsEditor } from "@/features/access/ColumnsEditor";
import { pipelineData } from "@/features/pipeline/service";
import "./TasksPage.css";

export default function PipelineStagesSettingsPage() {
  const access = useBusinessAccess();
  const scope = access.selected("pipeline");
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const data = useQuery({
    queryKey: access.key("pipeline", "pipeline-data"),
    enabled: Boolean(scope),
    retry: false,
    refetchInterval: 15000,
    queryFn: ({ signal }) => pipelineData(scope!, signal),
  });
  return (
    <div className="tasks-theme h-full overflow-auto">
      <BusinessContextPicker kind="pipeline" />
      {scope && (
        <div className="space-y-5 p-5" key={scope.board_id}>
          <Link className="task-link" to={`/pipeline/${scope.pipeline_id}`}>
            ← Voltar para a pipeline
          </Link>
          <h1 className="text-lg font-semibold">Pipelines &amp; Etapas</h1>
          <Link className="task-button" to={`/pipeline/new?sector=${scope.sector_id}&return=${encodeURIComponent("/settings/pipelines")}`}>Nova pipeline</Link>
          <p className="text-sm text-muted-foreground">
            Etapas de {scope.board_name}, na ordem configurada para este quadro.
          </p>
          {data.isLoading ? (
            <p role="status">Carregando etapas...</p>
          ) : data.error ? (
            <div role="alert">
              <p className="task-error">{data.error.message}</p>
              <button
                className="task-button"
                onClick={() => void data.refetch()}
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <>
              <ol className="max-w-xl space-y-2">
                {data.data?.stages.map((s) => (
                  <li
                    className="rounded-xl border border-border bg-card p-3 text-sm"
                    key={s.id}
                  >
                    {s.name}
                  </li>
                ))}
              </ol>
              {scope.can_manage && (
                <button
                  className="task-button task-cyan"
                  disabled={!data.data}
                  onClick={() => setEditing(true)}
                >
                  Gerenciar etapas
                </button>
              )}
            </>
          )}
          {editing && data.data && (
            <ColumnsEditor
              key={scope.board_id}
              scope={scope}
              columns={data.data.stages}
              onClose={() => setEditing(false)}
              onSaved={() => {
                void client.invalidateQueries({
                  queryKey: access.key("pipeline", "pipeline-data"),
                });
                void access.retry();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
