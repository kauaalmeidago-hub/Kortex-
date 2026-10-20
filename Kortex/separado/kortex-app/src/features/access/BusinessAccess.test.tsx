import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
const mocks = vi.hoisted(() => ({
  user: { id: "A" } as { id: string } | null,
  rpc: vi.fn(),
  removeAllChannels: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user, loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, removeAllChannels: mocks.removeAllChannels },
}));
import { BusinessAccessProvider, useBusinessAccess } from "./BusinessAccess";
const context = (user: string, board = user): BusinessContext => ({
  board_id: board,
  workspace_id: `org-${user}`,
  sector_id: `sector-${user}`,
  sector_name: user,
  board_name: board,
  kind: "tasks",
  visibility: "personal",
  can_write: true,
  can_manage: true,
  can_share: false,
  can_dispatch: false,
  pipeline_id: null,
  version: "2026-10-15T00:00:00Z",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let client: QueryClient;
beforeEach(() => {
  mocks.user = { id: "A" };
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  mocks.rpc.mockImplementation(() => ({
    abortSignal: () =>
      Promise.resolve({ data: [context(mocks.user!.id)], error: null }),
  }));
});
afterEach(() => {
  cleanup();
  client.clear();
});
function Probe() {
  const a = useBusinessAccess();
  const scope = a.selected("tasks");
  return (
    <>
      <output data-testid="scope">{scope?.board_id ?? "blocked"}</output>
      <output data-testid="key">
        {JSON.stringify(a.key("tasks", "tasks"))}
      </output>
      <output data-testid="error">{a.error}</output>
      {a.contexts.map((c) => (
        <button key={c.board_id} onClick={() => a.select(c)}>
          {c.board_id}
        </button>
      ))}
    </>
  );
}
function Tree({ children = <Probe /> }: { children?: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <BusinessAccessProvider>{children}</BusinessAccessProvider>
    </QueryClientProvider>
  );
}
describe("trusted business context and cache lifecycle", () => {
  it("requires an explicit choice when more than one authorized board exists", async () => {
    mocks.rpc.mockReturnValue({
      abortSignal: () =>
        Promise.resolve({
          data: [context("A", "one"), context("A", "two")],
          error: null,
        }),
    });
    render(<Tree />);
    await screen.findByRole("button", { name: "two" });
    expect(screen.getByTestId("scope")).toHaveTextContent("blocked");
    fireEvent.click(screen.getByRole("button", { name: "two" }));
    expect(screen.getByTestId("scope")).toHaveTextContent("two");
    expect(screen.getByTestId("key").textContent).toContain("org-A");
    expect(screen.getByTestId("key").textContent).toContain("sector-A");
  });
  it("discards old associations when A logs out and B logs in while the response is delayed", async () => {
    const old = deferred<{ data: BusinessContext[]; error: null }>();
    mocks.rpc.mockImplementation(() => ({
      abortSignal: () =>
        mocks.user?.id === "A"
          ? old.promise
          : Promise.resolve({ data: [context("B")], error: null }),
    }));
    const view = render(<Tree />);
    mocks.user = { id: "B" };
    view.rerender(<Tree />);
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent("B"),
    );
    await act(async () => old.resolve({ data: [context("A")], error: null }));
    expect(screen.getByTestId("scope")).toHaveTextContent("B");
    expect(
      client
        .getQueryCache()
        .findAll()
        .some((q) => q.queryKey[2] === "A"),
    ).toBe(false);
  });
  it("cancels old record requests and ignores late private content after an account change", async () => {
    const old = deferred<string>();
    let signal: AbortSignal | undefined;
    function Records() {
      const a = useBusinessAccess();
      const scope = a.selected("tasks");
      const query = useQuery({
        queryKey: a.key("tasks", "records"),
        enabled: Boolean(scope),
        queryFn: ({ signal: s }) => {
          if (scope?.board_id === "A") {
            signal = s;
            return old.promise;
          }
          return Promise.resolve("B records");
        },
      });
      return (
        <>
          <Probe />
          <p>{scope ? query.data : "blocked"}</p>
        </>
      );
    }
    const view = render(
      <Tree>
        <Records />
      </Tree>,
    );
    await waitFor(() => expect(signal).toBeDefined());
    mocks.user = { id: "B" };
    view.rerender(
      <Tree>
        <Records />
      </Tree>,
    );
    await screen.findByText("B records");
    await act(async () => old.resolve("A secret"));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText("A secret")).not.toBeInTheDocument();
    expect(
      client
        .getQueryCache()
        .findAll()
        .some((q) => q.state.data === "A secret"),
    ).toBe(false);
  });
  it("blocks business data when association validation fails instead of displaying zero results", async () => {
    mocks.rpc.mockReturnValue({
      abortSignal: () =>
        Promise.resolve({ data: null, error: { code: "PGRST202" } }),
    });
    render(<Tree />);
    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent(
        "atualização de segurança",
      ),
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("blocked");
  });
  it("clears scoped caches and channels when the active association is revoked", async () => {
    let allowed = true;
    mocks.rpc.mockImplementation(() => ({
      abortSignal: () =>
        Promise.resolve(
          allowed
            ? { data: [context("A")], error: null }
            : { data: null, error: { code: "42501" } },
        ),
    }));
    render(<Tree />);
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent("A"),
    );
    client.setQueryData(JSON.parse(screen.getByTestId("key").textContent!), [
      "private",
    ]);
    allowed = false;
    await act(async () => {
      await client.invalidateQueries({
        predicate: (q) => q.queryKey[1] === "business-contexts",
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent("blocked"),
    );
    expect(
      client
        .getQueryCache()
        .findAll()
        .some(
          (q) =>
            Array.isArray(q.state.data) && q.state.data.includes("private"),
        ),
    ).toBe(false);
  });
});
