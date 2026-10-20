import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useBusinessAccess } from "@/features/access/BusinessAccess";
import { supabase } from "@/integrations/supabase/client";
import { checkTaskAdmin, listTasks, loadTaskCatalog } from "./service";
export function useTaskCount() {
  const access = useBusinessAccess();
  const scope = access.selected("tasks");
  return useQuery({
    queryKey: access.key("tasks", "task-count"),
    enabled: Boolean(scope),
    retry: false,
    refetchInterval: 15000,
    queryFn: async ({ signal }) => {
      const r = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", scope!.workspace_id)
        .eq("sector_id", scope!.sector_id)
        .eq("board_id", scope!.board_id)
        .abortSignal(signal);
      if (r.error) throw r.error;
      return r.count ?? 0;
    },
  });
}
export function useTaskAdmin() {
  const a = useBusinessAccess();
  const scope = a.selected("tasks");
  const query = useQuery({
    queryKey: a.key("tasks", "task-admin-access"),
    enabled: Boolean(scope?.can_dispatch),
    retry: false,
    refetchInterval: 15000,
    queryFn: () => checkTaskAdmin(scope!.board_id),
  });
  return {
    data: Boolean(scope?.can_dispatch && query.data === true),
    isLoading: a.loading || (Boolean(scope?.can_dispatch) && query.isLoading),
    error: a.error ? new Error(a.error) : query.error,
  };
}
export function useTasksData(dispatch = false) {
  const auth = useAuth();
  const access = useBusinessAccess();
  const scope = access.selected("tasks");
  const tasks = useQuery({
    queryKey: access.key("tasks", "tasks"),
    enabled: Boolean(scope),
    retry: false,
    refetchInterval: 15000,
    queryFn: ({ signal }) => listTasks(scope!.board_id, signal),
  });
  const catalog = useQuery({
    queryKey: [
      ...access.key("tasks", "task-catalog"),
      dispatch ? access.token : "personal",
    ],
    enabled: Boolean(scope),
    retry: false,
    refetchInterval: 15000,
    queryFn: async ({ signal }) => {
      const scopes = dispatch
        ? access.contexts.filter(
            (c) =>
              c.kind === "tasks" &&
              c.workspace_id === scope!.workspace_id &&
              c.can_dispatch,
          )
        : [scope!];
      const results = await Promise.all(
        scopes.map((c) => loadTaskCatalog(c, signal)),
      );
      const unique = <T>(rows: T[], id: (r: T) => string) =>
        Array.from(new Map(rows.map((r) => [id(r), r])).values());
      return {
        companies: unique(
          results.flatMap((c) => c.companies),
          (r) => r.id,
        ),
        people: unique(
          results.flatMap((c) => c.people),
          (r) => r.user_id,
        ),
        sectors: unique(
          results.flatMap((c) => c.sectors),
          (r) => r.id,
        ),
        members: unique(
          results.flatMap((c) => c.members),
          (r) => `${r.sector_id}:${r.user_id}`,
        ),
        stages: results.flatMap((c) => c.stages),
        boards: scopes,
      };
    },
  });
  return {
    tasks,
    catalog,
    scope,
    access,
    workspace:
      auth.workspaces.find((w) => w.id === scope?.workspace_id) ??
      (scope ? { id: scope.workspace_id } : null),
    user: auth.user,
    authLoading: auth.loading || access.loading,
    contextError: auth.contextError || access.error,
    retryContext: () => {
      auth.retryContext();
      access.retry();
    },
  };
}
