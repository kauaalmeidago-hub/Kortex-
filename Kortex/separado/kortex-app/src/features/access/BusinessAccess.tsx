import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
import { withRequestDeadline } from "./requestDeadline";
import { environmentKey } from "./environment";

type Access = {
  contexts: BusinessContext[];
  loading: boolean;
  error: string | null;
  retry: () => void | Promise<unknown>;
  selected: (kind: "tasks" | "pipeline") => BusinessContext | null;
  select: (context: BusinessContext) => void;
  key: (kind: "tasks" | "pipeline", resource: string) => readonly unknown[];
  isCurrent: (token: string) => boolean;
  token: string;
};
const empty: Access = {
  contexts: [],
  loading: false,
  error: null,
  retry: () => {},
  selected: () => null,
  select: () => {},
  key: (_, r) => [environmentKey, r, "blocked"],
  isCurrent: () => false,
  token: "blocked",
};
const Context = createContext<Access>(empty);
export function BusinessAccessProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const client = useQueryClient();
  const [choice, setChoice] = useState<{
    user: string;
    tasks?: string;
    pipeline?: string;
  }>({ user: "" });
  const previousUser = useRef<string | null>(null);
  const claimedInvite = useRef<string | null>(null);
  const query = useQuery({
    queryKey: [environmentKey, "business-contexts", user?.id],
    enabled: Boolean(user && !authLoading),
    retry: false,
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    queryFn: ({ signal }) =>
      withRequestDeadline(signal, async (signal) => {
        let r = await supabase.rpc("business_contexts").abortSignal(signal);
        if (!r.error && !r.data?.length) {
          const profile = await supabase
            .from("profiles")
            .select("sector")
            .eq("id", user!.id)
            .abortSignal(signal)
            .maybeSingle();
          if (profile.data?.sector) {
            const onboard = await supabase
              .rpc("business_onboard_personal", {
                p_sector: profile.data.sector,
              })
              .abortSignal(signal);
            if (!onboard.error)
              r = await supabase.rpc("business_contexts").abortSignal(signal);
          }
        }
        if (!r.error && r.data?.length && claimedInvite.current !== user!.id) {
          const invite = await supabase
            .rpc("task_admin_accept_invite", {})
            .abortSignal(signal);
          if (!invite.error) {
            claimedInvite.current = user!.id;
            if (invite.data === true)
              r = await supabase.rpc("business_contexts").abortSignal(signal);
          }
        }
        if (r.error)
          throw new Error(
            ["PGRST202", "42P01", "42703"].includes(r.error.code)
              ? "A atualização de segurança ainda não foi aplicada a este ambiente. Os dados de negócio estão bloqueados."
              : "Não foi possível validar seus vínculos de acesso. Tente novamente.",
          );
        return r.data;
      }),
  });
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    if (!query.dataUpdatedAt) return;
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, 30000 - (Date.now() - query.dataUpdatedAt)),
    );
    return () => clearTimeout(timer);
  }, [query.dataUpdatedAt]);
  const contexts =
    user &&
    !authLoading &&
    !query.isError &&
    !expired &&
    Date.now() - query.dataUpdatedAt < 30000
      ? (query.data ?? [])
      : [];
  const selected = (kind: "tasks" | "pipeline") => {
    const available = contexts.filter((c) => c.kind === kind);
    const id = choice.user === user?.id ? choice[kind] : undefined;
    return (
      available.find((c) => c.board_id === id) ??
      (available.length === 1 ? available[0] : null)
    );
  };
  const signature = JSON.stringify([
    environmentKey,
    user?.id,
    selected("tasks")?.board_id,
    selected("pipeline")?.board_id,
    contexts.map((c) => [
      c.board_id,
      c.can_write,
      c.can_dispatch,
      c.can_manage,
    ]),
  ]);
  const boundary = useRef({ signature, epoch: 0 });
  if (boundary.current.signature !== signature)
    boundary.current = { signature, epoch: boundary.current.epoch + 1 };
  const token = JSON.stringify([signature, boundary.current.epoch]);
  const current = useRef(token);
  current.current = token;
  const purge = () => {
    const predicate = (q: { queryKey: readonly unknown[] }) =>
      q.queryKey[1] !== "business-contexts" || q.queryKey[2] !== user?.id;
    void client.cancelQueries({ predicate });
    client.removeQueries({ predicate });
    void supabase.removeAllChannels();
    try {
      for (const k of Object.keys(localStorage))
        if (k.startsWith("kortex-contact-draft:")) localStorage.removeItem(k);
    } catch {
      /* Storage is optional; it never grants access. */
    }
  };
  const previousToken = useRef(token);
  useLayoutEffect(() => {
    if (previousToken.current !== token) {
      // Revocation may change context without an explicit picker action. Remove
      // every previous scoped query; the current association query stays active.
      const prior = previousToken.current;
      previousToken.current = token;
      const predicate = (q: { queryKey: readonly unknown[] }) =>
        q.queryKey[1] !== "business-contexts" && q.queryKey.includes(prior);
      void client.cancelQueries({ predicate });
      client.removeQueries({ predicate });
      void supabase.removeAllChannels();
    }
  }, [token, client]);
  useLayoutEffect(() => {
    if (previousUser.current !== user?.id) {
      previousUser.current = user?.id ?? null;
      purge();
      setChoice({ user: user?.id ?? "" });
    }
    // Cache eviction is driven by identity, never token refresh of the same user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  const select = (context: BusinessContext) => {
    if (!user || !contexts.some((c) => c.board_id === context.board_id)) return;
    current.current = "switching";
    purge();
    setChoice((c) => ({
      ...c,
      user: user.id,
      [context.kind]: context.board_id,
    }));
  };
  const key = (kind: "tasks" | "pipeline", resource: string) => {
    const c = selected(kind);
    return [
      environmentKey,
      resource,
      user?.id,
      c?.workspace_id,
      c?.sector_id,
      c?.board_id,
      token,
    ] as const;
  };
  return (
    <Context.Provider
      value={{
        contexts,
        selected,
        select,
        key,
        isCurrent: (t) => current.current === t,
        token,
        loading:
          authLoading ||
          Boolean(user && (query.isLoading || (expired && !query.isError))),
        error: query.error?.message ?? null,
        retry: () => query.refetch(),
      }}
    >
      {children}
    </Context.Provider>
  );
}
// The hook is intentionally colocated with its access boundary.
// eslint-disable-next-line react-refresh/only-export-components
export const useBusinessAccess = () => useContext(Context);
export function BusinessContextPicker({
  kind,
  onSelect,
}: {
  kind: "tasks" | "pipeline";
  onSelect?: (context: BusinessContext) => void;
}) {
  const a = useBusinessAccess();
  const options = a.contexts.filter((c) => c.kind === kind);
  const active = a.selected(kind);
  if (a.loading)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Validando acesso...
      </p>
    );
  if (a.error)
    return (
      <div role="alert" className="p-4 text-sm">
        <p>{a.error}</p>
        <button type="button" className="task-button mt-2" onClick={a.retry}>
          Tentar novamente
        </button>
      </div>
    );
  if (!options.length)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Sua conta ainda não possui uma associação ativa a um setor e quadro.
        Solicite o vínculo à gestão da sua organização.
      </p>
    );
  return (
    <label className="flex min-w-0 max-w-full flex-wrap items-center gap-3 px-5 py-3 text-[13px] text-muted-foreground">
      Quadro
      <select
        aria-label="Quadro autorizado"
        className="task-select min-w-0 w-full max-w-full sm:w-auto"
        value={active?.board_id ?? ""}
        onChange={(e) => {
          const c = options.find((c) => c.board_id === e.target.value);
          if (c) {
            a.select(c);
            onSelect?.(c);
          }
        }}
      >
        <option value="" disabled>
          Selecione um quadro
        </option>
        {options.map((c) => (
          <option key={c.board_id} value={c.board_id}>
            {c.workspace_name
              ? `${c.workspace_name}${new Set(options.map((o) => o.workspace_id)).size > 1 ? ` (${c.workspace_id.slice(-6)})` : ""} · `
              : ""}
            {c.sector_name} · {c.board_name}
            {c.visibility === "personal" ? " · Pessoal" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
