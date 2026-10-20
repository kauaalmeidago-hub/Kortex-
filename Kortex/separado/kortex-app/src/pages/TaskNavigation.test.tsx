import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { taskCatalogFixture, taskFixture, taskIds } from "@/test/taskFixtures";
const access = vi.hoisted(() => ({ admin: true, signedIn: true }));
vi.mock('@/integrations/supabase/client', async original => {
  const actual = await original<typeof import('@/integrations/supabase/client')>();
  return { supabase: { ...actual.supabase, rpc: (name: string, ...args: unknown[]) => name === 'wa_onboarding_required' ? { abortSignal: async () => ({ data: false, error: null }) } : (actual.supabase.rpc as CallableFunction)(name, ...args) } };
});
vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    user: access.signedIn ? { id: taskIds.admin } : null,
    workspace: access.signedIn ? { id: taskIds.workspace } : null,
    loading: false,
    signOut: vi.fn(),
  }),
}));
vi.mock("@/features/access/BusinessAccess",()=>({
 BusinessAccessProvider:({children}:{children:ReactNode})=>children,
 useBusinessAccess:()=>({contexts:[],token:"test",isCurrent:()=>true,key:(_kind:string,r:string)=>[r,taskIds.workspace,taskIds.admin],selected:()=>({board_id:"board",sector_id:taskIds.sector,can_dispatch:access.admin}),retry:vi.fn()}),
 BusinessContextPicker:()=>null,
}));
vi.mock("@/features/tasks/hooks", () => ({
  useTaskAdmin: () => ({ data: access.admin, isLoading: false }),
  useTaskCount: () => ({ data: 1 }),
  useTasksData: () => ({
    scope:{board_id:"board",can_dispatch:access.admin,can_write:true},
    access:{token:"test",isCurrent:()=>true,key:(_kind:string,r:string)=>[r,taskIds.workspace,taskIds.admin]},
    tasks: { data: [taskFixture()], isLoading: false },
    catalog: { data: taskCatalogFixture(), isLoading: false },
    workspace: access.signedIn ? { id: taskIds.workspace } : null,
    user: access.signedIn ? { id: taskIds.admin } : null,
    authLoading: false,
    contextError: null,
    retryContext: vi.fn(),
  }),
}));
vi.mock("@/features/tasks/service", async (original) => ({
  ...(await original<typeof import("@/features/tasks/service")>()),
  listTaskConversations: vi.fn().mockResolvedValue([]),
  listTaskMessages: vi.fn().mockResolvedValue([]),
  listTaskDrafts: vi.fn().mockResolvedValue([]),
}));
import App from "@/App";
vi.mock("@/features/auth/service", async (original) => ({
  ...(await original<typeof import("@/features/auth/service")>()),
  loadAuthSettings: vi
    .fn()
    .mockResolvedValue({
      google: false,
      signupEnabled: true,
      minPasswordLength: 6,
      verified: true,
    }),
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  access.admin = true;
  access.signedIn = true;
  window.history.replaceState(null, "", "/admin/tasks");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("real application task and KOA route mapping", () => {
  it("preserves the management destination when an unauthenticated visitor opens login", async () => {
    access.signedIn = false;
    access.admin = false;
    window.history.replaceState(
      null,
      "",
      "/admin/tasks?conversation=return-target",
    );
    render(<App />);
    expect(window.location.pathname).toBe("/auth/login");
    expect(window.history.state.usr.from).toMatchObject({
      pathname: "/admin/tasks",
      search: "?conversation=return-target",
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Continuar com Google" })).not.toBeInTheDocument();
  });
  it("opens management independently and switches to operational KOA without sharing its composition", async () => {
    render(<App />);
    const navigation = within(await screen.findByRole("complementary"));
    expect(
      await screen.findByText(
        "Qual tarefa vamos realizar hoje e para qual setor?",
        { selector: "h2" },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Senha")).not.toBeInTheDocument();
    expect(
      navigation.getByRole("button", { name: "Gestão de tarefas" }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.change(screen.getByLabelText("Mensagem para Gestão de tarefas"), {
      target: { value: "Rascunho administrativo ainda não enviado" },
    });
    fireEvent.click(navigation.getByRole("button", { name: "Koa" }));
    expect(window.location.pathname).toBe("/movimentacoes/inclusao");
    expect(
      screen.getByText("Inclusão de beneficiário", { selector: "h1" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Mensagem para Gestão de tarefas"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Rascunho administrativo ainda não enviado"),
    ).not.toBeInTheDocument();
    expect(navigation.getByRole("button", { name: "Koa" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      navigation.getByRole("button", { name: "Gestão de tarefas" }),
    ).not.toHaveAttribute("aria-current");
    fireEvent.click(
      navigation.getByRole("button", { name: "Gestão de tarefas" }),
    );
    expect(window.location.pathname).toBe("/admin/tasks");
    expect(
      await screen.findByText(
        "Qual tarefa vamos realizar hoje e para qual setor?",
        { selector: "h2" },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Inclusão de beneficiário", { selector: "h1" }),
    ).not.toBeInTheDocument();
  });
  it.each([
    ["/movimentacoes/inclusao", "Inclusão de beneficiário", "Koa"],
    ["/movimentacoes/exclusao", "Exclusão de beneficiário", "Koa"],
    ["/movimentacoes/carteirinha", "Emissão de carteirinha", "Koa"],
    ["/admin/tasks", "Gestão de tarefas", "Gestão de tarefas"],
    ["/tasks", "Tarefas", "Tarefas"],
  ])(
    "retains the right module after mounting the direct route %s",
    async (path, heading, item) => {
      window.history.replaceState(null, "", path);
      render(<App />);
      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeInTheDocument();
      expect(window.location.pathname).toBe(path);
      expect(screen.getByRole("button", { name: item })).toHaveAttribute(
        "aria-current",
        "page",
      );
      const other = item === "Koa" ? "Gestão de tarefas" : "Koa";
      expect(screen.getByRole("button", { name: other })).not.toHaveAttribute(
        "aria-current",
      );
    },
  );
  it("denies an ordinary account on the direct management route and keeps its Tasks access", async () => {
    access.admin = false;
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Acesso restrito" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Gestão de tarefas" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tarefas" }));
    expect(
      screen.getByRole("button", { name: "Nova tarefa" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/tasks");
  });
});
