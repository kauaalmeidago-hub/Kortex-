import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppSidebar from "./AppSidebar";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

vi.mock("@/features/tasks/hooks",()=>({useTaskAdmin:()=>useQuery({queryKey:["task-admin",undefined,undefined],queryFn:async()=>false,enabled:false}),useTaskCount:()=>({data:undefined})}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, signOut: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSidebar() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/kit-faturamento"]}>
        <AppSidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function panelEvent(type: "open" | "close") {
  act(() => {
    window.dispatchEvent(new Event(`kortex:koa-panel-${type}`));
  });
}

describe("KOA sidebar restoration", () => {
  it("keeps operational KOA and administrative management separate in navigation, identity and active state", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["task-admin", undefined, undefined], true);
    function Location() {
      return <output data-testid="location">{useLocation().pathname}</output>;
    }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/tasks"]}>
          <AppSidebar />
          <Location />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const koa = screen.getByRole("button", { name: "Koa" });
    const admin = screen.getByRole("button", { name: "Gestão de tarefas" });
    expect(koa.querySelector("img")).toHaveAttribute(
      "src",
      "/brand/koa-minimized-robot.png",
    );
    expect(admin.querySelector("img")).toHaveAttribute(
      "src",
      "/brand/koa-assistant.png",
    );
    expect(admin).toHaveAttribute("aria-current", "page");
    expect(koa).not.toHaveAttribute("aria-current");
    fireEvent.click(koa);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/movimentacoes/inclusao",
    );
    expect(koa).toHaveAttribute("aria-current", "page");
    expect(admin).not.toHaveAttribute("aria-current");
    fireEvent.click(admin);
    expect(screen.getByTestId("location")).toHaveTextContent("/admin/tasks");
    expect(admin).toHaveAttribute("aria-current", "page");
    expect(koa).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByRole("button", { name: "Tarefas" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/tasks");
    expect(koa).not.toHaveAttribute("aria-current");
    expect(admin).not.toHaveAttribute("aria-current");
  });
  it("shows administrative management immediately after KOA only with a positive permission result", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AppSidebar />
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(tree);
    expect(
      screen.queryByRole("button", { name: "Gestão de tarefas" }),
    ).not.toBeInTheDocument();
    act(() => client.setQueryData(["task-admin", undefined, undefined], true));
    await screen.findByRole("button", { name: "Gestão de tarefas" });
    const nav = screen.getByRole("navigation");
    const names = Array.from(nav.querySelectorAll("button[aria-label]")).map(
      (e) => e.getAttribute("aria-label"),
    );
    expect(names[names.indexOf("Koa") + 1]).toBe("Gestão de tarefas");
    act(() => client.setQueryData(["task-admin", undefined, undefined], false));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Gestão de tarefas" }),
      ).not.toBeInTheDocument(),
    );
  });
  it("restores an expanded sidebar but preserves one manually collapsed before opening", () => {
    renderSidebar();
    panelEvent("open");
    expect(
      screen.getByRole("button", { name: "Expandir menu" }),
    ).toBeInTheDocument();
    panelEvent("close");
    fireEvent.click(screen.getByRole("button", { name: "Recolher menu" }));
    panelEvent("open");
    panelEvent("close");
    expect(
      screen.getByRole("button", { name: "Expandir menu" }),
    ).toBeInTheDocument();
  });
  it("keeps the original preference when opening or closing across a mobile breakpoint", () => {
    let narrow = false;
    const listeners = new Set<() => void>();
    const original = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...original(query),
      get matches() {
        return narrow;
      },
      addEventListener: (_type, listener) => {
        listeners.add(listener as () => void);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener as () => void);
      },
    }));
    const resize = (value: boolean) =>
      act(() => {
        narrow = value;
        listeners.forEach((listener) => listener());
      });
    renderSidebar();
    panelEvent("open");
    resize(true);
    panelEvent("close");
    resize(false);
    expect(
      screen.getByRole("button", { name: "Recolher menu" }),
    ).toBeInTheDocument();
    resize(true);
    panelEvent("open");
    resize(false);
    expect(
      screen.getByRole("button", { name: "Expandir menu" }),
    ).toBeInTheDocument();
    panelEvent("close");
    expect(
      screen.getByRole("button", { name: "Recolher menu" }),
    ).toBeInTheDocument();
  });
});
