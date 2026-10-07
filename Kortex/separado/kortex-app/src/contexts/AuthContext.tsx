import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Workspace { id: string; name: string; slug: string; owner_id: string }
type WorkspaceMemberRow = { workspace: Workspace | null };

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  workspace: Workspace | null;
  workspaces: Workspace[];
  setWorkspace: (w: Workspace) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!s) { setWorkspaces([]); setWorkspace(null); }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("workspace_members")
        .select("workspace:workspaces(id, name, slug, owner_id)")
        .eq("user_id", user.id);
      const rows = (data ?? []) as WorkspaceMemberRow[];
      const ws = rows
        .map((row) => row.workspace)
        .filter((currentWorkspace): currentWorkspace is Workspace => Boolean(currentWorkspace));
      setWorkspaces(ws);
      const savedId = localStorage.getItem("active-workspace-id");
      setWorkspace(ws.find(w => w.id === savedId) || ws[0] || null);
    })();
  }, [user]);

  useEffect(() => {
    if (workspace) localStorage.setItem("active-workspace-id", workspace.id);
  }, [workspace]);

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <Ctx.Provider value={{ user, session, loading, workspace, workspaces, setWorkspace, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
