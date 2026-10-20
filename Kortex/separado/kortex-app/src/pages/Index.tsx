import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BusinessContextPicker,
  useBusinessAccess,
} from "@/features/access/BusinessAccess";
import { useTaskCount } from "@/features/tasks/hooks";
import { pipelineData } from "@/features/pipeline/service";
import { fullModules } from "@/features/access/environment";
import "./TasksPage.css";
export default function Index() {
  const access = useBusinessAccess();
  const scope = access.selected("pipeline");
  const count = useTaskCount();
  const leads = useQuery({
    queryKey: access.key("pipeline", "pipeline-data"),
    queryFn: ({ signal }) => pipelineData(scope!, signal),
    enabled: Boolean(scope),
    retry: false,
    refetchInterval: 15000,
  });
  return (
    <main className="tasks-theme h-full overflow-auto p-5">
      <h1 className="text-xl font-semibold">Sua operação</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Consulte os dados dos seus quadros autorizados.
      </p>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Tarefas</h2>
          <BusinessContextPicker kind="tasks" />
          {access.selected("tasks") && (
            <p className="px-5 py-3 text-2xl font-semibold">
              {count.isError
                ? "Indisponível"
                : count.isLoading
                  ? "Carregando..."
                  : (count.data ?? "—")}
            </p>
          )}
          <Link className="task-button w-fit" to="/tasks">
            Abrir tarefas
          </Link>
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Pipeline</h2>
          <BusinessContextPicker kind="pipeline" />
          {scope && (
            <p className="px-5 py-3 text-2xl font-semibold">
              {leads.isError
                ? "Indisponível"
                : leads.isLoading
                  ? "Carregando..."
                  : (leads.data?.leads.length ?? "—")}
            </p>
          )}
          <Link className="task-button w-fit" to="/pipeline">
            Abrir pipeline
          </Link>
        </section>
      </div>
      {fullModules && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-medium">Acessos rápidos</h2>
          <div className="flex flex-wrap gap-3">
            {[
              ["Empresas", "/companies"],
              ["Kit faturamento", "/kit-faturamento"],
              ["KOA", "/movimentacoes/inclusao"],
              ["Comunicações", "/inbox"],
            ].map(([name, path]) => (
              <Link key={path} className="task-button" to={path}>
                {name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
