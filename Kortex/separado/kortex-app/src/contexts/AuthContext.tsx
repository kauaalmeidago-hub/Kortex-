import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
}
type WorkspaceMemberRow = { workspace: Workspace | null };

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  contextError: string | null;
  retryContext: () => void;
  workspace: Workspace | null;
  workspaces: Workspace[];
  setWorkspace: (w: Workspace) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);
const logoutMarker = `kortex:logout:${import.meta.env.VITE_SUPABASE_URL ?? "default"}`;
type LogoutIntent = { userId: string | null; sessionId: string | null };
function sessionId(session: Session | null): string | null {
  try {
    const part = session!.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part)).session_id ?? null;
  } catch { return null; }
}
function logoutRequested() {
  let stored: string | null;
  try { stored = localStorage.getItem(logoutMarker); } catch { return null; }
  try { return JSON.parse(stored ?? "null") as LogoutIntent | null; }
  catch { return { userId: null, sessionId: null }; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const locallySignedOut = useRef(logoutRequested());
  const [auth, setAuth] = useState<{
    session: Session | null;
    loading: boolean;
    error: string | null;
  }>({ session: null, loading: true, error: null });
  const [context, setContext] = useState<{
    userId: string | null;
    rows: Workspace[];
    activeId: string | null;
    loading: boolean;
    error: string | null;
  }>({ userId: null, rows: [], activeId: null, loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const user = auth.session?.user ?? null;
  const userId = user?.id ?? null;

  useEffect(() => {
    let active = true;
    let revision = 0;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      revision += 1;
      const blocked = locallySignedOut.current;
      // GoTrue also emits SIGNED_IN when an old session is recovered/refocused.
      // A real fresh login has a different server-issued session_id.
      if ((event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") && session && (!blocked ||
        session.user.id !== blocked.userId ||
        (blocked.sessionId && sessionId(session) && sessionId(session) !== blocked.sessionId))) {
        locallySignedOut.current = null;
        try { localStorage.removeItem(logoutMarker); } catch { /* Optional local synchronization. */ }
      }
      if (active) setAuth({ session: locallySignedOut.current ? null : session, loading: false, error: null });
    });
    const initialRevision = revision;
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        // A newer login/logout event wins over a delayed initial session read.
        if (!active || revision !== initialRevision) return;
        setAuth({
          session: locallySignedOut.current ? null : data.session,
          loading: false,
          error: error
            ? "Não foi possível recuperar a sessão. Tente novamente."
            : null,
        });
      })
      .catch(() => {
        if (active && revision === initialRevision)
          setAuth({
            session: null,
            loading: false,
            error: "Não foi possível recuperar a sessão. Tente novamente.",
          });
      });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [attempt]);

  useEffect(() => {
    const onLogout = (event: StorageEvent) => {
      if (event.key !== logoutMarker || !event.newValue) return;
      locallySignedOut.current = logoutRequested() ?? { userId: auth.session?.user.id ?? null, sessionId: sessionId(auth.session) };
      setAuth({ session: null, loading: false, error: null });
      setContext({ userId: null, rows: [], activeId: null, loading: false, error: null });
    };
    window.addEventListener("storage", onLogout);
    return () => window.removeEventListener("storage", onLogout);
  }, [auth.session]);

  useEffect(() => {
    if (!userId) {
      setContext({
        userId: null,
        rows: [],
        activeId: null,
        loading: false,
        error: null,
      });
      return;
    }
    let active = true;
    setContext({
      userId,
      rows: [],
      activeId: null,
      loading: true,
      error: null,
    });
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("workspace_members")
          .select("workspace:workspaces(id, name, slug, owner_id)")
          .eq("active", true)
          .eq("user_id", userId);
        if (error) throw error;
        if (!active) return;
        const rows = ((data ?? []) as WorkspaceMemberRow[])
          .map((row) => row.workspace)
          .filter((row): row is Workspace => Boolean(row));
        let savedId: string | null = null;
        try {
          savedId =
            localStorage.getItem(`active-workspace:${userId}`) ??
            localStorage.getItem("active-workspace-id");
        } catch {
          /* Membership remains authoritative if storage is unavailable. */
        }
        setContext({
          userId,
          rows,
          activeId:
            (rows.find((row) => row.id === savedId) ?? (rows.length===1?rows[0]:undefined))?.id ?? null,
          loading: false,
          error: rows.length
            ? null
            : "Sua conta não está vinculada a uma equipe. Consulte a administração.",
        });
      } catch {
        if (active)
          setContext({
            userId,
            rows: [],
            activeId: null,
            loading: false,
            error:
              "Não foi possível carregar o contexto da conta. Tente novamente.",
          });
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, attempt]);

  // A workspace from a previous account is never exposed during scope loading.
  const workspaces = context.userId === userId ? context.rows : [];
  const workspace =
    workspaces.find((row) => row.id === context.activeId) ?? null;
  const loading =
    auth.loading ||
    Boolean(userId && (context.userId !== userId || context.loading));
  const contextError =
    auth.error || (context.userId === userId ? context.error : null);
  const retryContext = useCallback(() => setAttempt((value) => value + 1), []);
  const setWorkspace = (next: Workspace) => {
    if (!workspaces.some((row) => row.id === next.id)) return;
    setContext((current) => ({ ...current, activeId: next.id }));
  };

  useEffect(() => {
    if (!workspace || !userId) return;
    try {
      localStorage.setItem(`active-workspace:${userId}`, workspace.id);
    } catch {
      /* Optional preference. */
    }
  }, [workspace, userId]);

  const signOut = async () => {
    // Hide data and cancel its scope before waiting for a remote logout response.
    // The marker also prevents a late refresh/initial read or reload restoring it.
    const intent = { userId, sessionId: sessionId(auth.session), nonce: crypto.randomUUID() };
    locallySignedOut.current = intent;
    try { localStorage.setItem(logoutMarker, JSON.stringify(intent)); } catch { /* Local state still closes immediately. */ }
    setAuth({ session: null, loading: false, error: null });
    setContext({ userId: null, rows: [], activeId: null, loading: false, error: null });
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider
      value={{
        user,
        session: auth.session,
        loading,
        contextError,
        retryContext,
        workspace,
        workspaces,
        setWorkspace,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
