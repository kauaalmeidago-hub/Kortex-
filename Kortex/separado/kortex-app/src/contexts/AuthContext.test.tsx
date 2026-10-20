import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  from: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: mocks, from: mocks.from },
}));
import { AuthProvider, useAuth } from "./AuthContext";
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const session = (id: string) =>
  ({ user: { id, email: `${id}@test.invalid` }, access_token: `header.${btoa(JSON.stringify({session_id:id}))}.signature` }) as Session;
const workspace = (id: string) => ({
  id,
  name: id,
  slug: id,
  owner_id: "owner",
});
let authEvent: (event: string, s: Session | null) => void;
let lookup: ReturnType<typeof vi.fn>;
function Probe() {
  const auth = useAuth();
  return (
    <>
      <output data-testid="scope">
        {JSON.stringify({
          user: auth.user?.id ?? null,
          workspace: auth.workspace?.id ?? null,
          loading: auth.loading,
          error: auth.contextError,
        })}
      </output>
      <button onClick={auth.retryContext}>Retry</button>
      <button onClick={() => void auth.signOut()}>Sign out</button>
      <button onClick={() => auth.setWorkspace(workspace("forged"))}>
        Unlisted workspace
      </button>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("scope").textContent!);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  lookup = vi.fn();
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.onAuthStateChange.mockImplementation((cb) => {
    authEvent = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  mocks.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({eq: (_field: string, id: string) => lookup(id)}) }),
  }));
});
afterEach(cleanup);
describe("authenticated workspace initialization", () => {
  it("hides data before remote logout finishes and rejects a late refresh", async () => {
    const pending = deferred<unknown>();
    mocks.signOut.mockReturnValue(pending.promise);
    mocks.getSession.mockResolvedValue({ data: { session: session("a") }, error: null });
    lookup.mockResolvedValue({ data: [{ workspace: workspace("a-scope") }], error: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(state().workspace).toBe("a-scope"));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(state()).toMatchObject({ user: null, workspace: null, loading: false });
    await act(async () => authEvent("TOKEN_REFRESHED", session("a")));
    expect(state().user).toBeNull();
    await act(async () => authEvent("SIGNED_IN", session("a")));
    expect(state().user).toBeNull();
    await act(async () => pending.resolve({ error: null }));
    const recovered = { ...session("a"), access_token: `header.${btoa(JSON.stringify({session_id:"new-recovery-session"}))}.signature` };
    await act(async () => authEvent("PASSWORD_RECOVERY", recovered));
    await waitFor(() => expect(state().user).toBe("a"));
    await act(async () => authEvent("SIGNED_IN", session("b")));
    await waitFor(() => expect(state().user).toBe("b"));
  });
  it("closes a second tab on logout intent and does not restore a cached session after reload", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: session("a") }, error: null });
    lookup.mockResolvedValue({ data: [{ workspace: workspace("a-scope") }], error: null });
    const rendered = render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(state().workspace).toBe("a-scope"));
    const key = `kortex:logout:${import.meta.env.VITE_SUPABASE_URL ?? "default"}`;
    localStorage.setItem(key, "logout-intent");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key, newValue: "logout-intent" })));
    expect(state()).toMatchObject({ user: null, workspace: null });
    rendered.unmount();
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(state().loading).toBe(false));
    expect(state()).toMatchObject({ user: null, workspace: null });
  });
  it("keeps loading until memberships resolve and ignores an unauthorized saved workspace", async () => {
    const pending = deferred<unknown>();
    mocks.getSession.mockResolvedValue({
      data: { session: session("a") },
      error: null,
    });
    lookup.mockReturnValue(pending.promise);
    localStorage.setItem("active-workspace-id", "foreign");
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(lookup).toHaveBeenCalledWith("a"));
    expect(state()).toMatchObject({
      user: "a",
      workspace: null,
      loading: true,
    });
    await act(async () =>
      pending.resolve({
        data: [{ workspace: workspace("authorized") }],
        error: null,
      }),
    );
    expect(state()).toMatchObject({
      workspace: "authorized",
      loading: false,
      error: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlisted workspace" }));
    expect(state().workspace).toBe("authorized");
  });
  it("discards old-account responses and does not reload membership on token refresh", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    lookup.mockImplementation((id) =>
      id === "a" ? first.promise : second.promise,
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => authEvent("SIGNED_IN", session("a")));
    await act(async () => authEvent("SIGNED_IN", session("b")));
    expect(state()).toMatchObject({
      user: "b",
      workspace: null,
      loading: true,
    });
    await act(async () =>
      second.resolve({
        data: [{ workspace: workspace("b-scope") }],
        error: null,
      }),
    );
    await act(async () =>
      first.resolve({
        data: [{ workspace: workspace("a-scope") }],
        error: null,
      }),
    );
    expect(state()).toMatchObject({
      user: "b",
      workspace: "b-scope",
      loading: false,
    });
    await act(async () => authEvent("TOKEN_REFRESHED", session("b")));
    expect(lookup).toHaveBeenCalledTimes(2);
    await act(async () => authEvent("SIGNED_OUT", null));
    expect(state()).toMatchObject({
      user: null,
      workspace: null,
      loading: false,
    });
  });
  it("does not restore an old initial session after a newer logout event", async () => {
    const initial = deferred<unknown>();
    mocks.getSession.mockReturnValue(initial.promise);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => authEvent("SIGNED_OUT", null));
    await act(async () =>
      initial.resolve({ data: { session: session("old") }, error: null }),
    );
    expect(state()).toMatchObject({
      user: null,
      workspace: null,
      loading: false,
    });
    expect(lookup).not.toHaveBeenCalled();
  });
  it("exposes membership errors with retry instead of treating them as an empty successful load", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: session("a") },
      error: null,
    });
    lookup
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } })
      .mockResolvedValue({
        data: [{ workspace: workspace("restored") }],
        error: null,
      });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(state().error).toMatch(/carregar o contexto/));
    expect(state().workspace).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(state()).toMatchObject({
        workspace: "restored",
        loading: false,
        error: null,
      }),
    );
  });
  it("handles session recovery failure and retries the existing auth client", async () => {
    mocks.getSession
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ data: { session: null }, error: null });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(state().error).toMatch(/recuperar a sessão/));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(state()).toMatchObject({ loading: false, error: null }),
    );
  });
});
