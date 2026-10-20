import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
const api = vi.hoisted(() => ({
  initialize: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: api } }));
let event: (event: AuthChangeEvent, session: Session | null) => void;
function session(method = "otp", id = "session-one", age = 0): Session {
  const now = Math.floor(Date.now() / 1000);
  return {
    user: { id: "person-one" },
    access_token: `header.${btoa(JSON.stringify({ sub: "person-one", session_id: id, exp: now + 3600, amr: [{ method, timestamp: now - age }] }))}.signature`,
  } as Session;
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(1_792_051_200_000);
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  api.initialize.mockResolvedValue({ error: null });
  api.getSession.mockResolvedValue({
    data: { session: session() },
    error: null,
  });
  api.getUser.mockResolvedValue({
    data: { user: { id: "person-one" } },
    error: null,
  });
  api.updateUser.mockResolvedValue({
    data: { user: { id: "person-one" } },
    error: null,
  });
  api.signOut.mockResolvedValue({ error: null });
  api.onAuthStateChange.mockImplementation((callback) => {
    event = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
});
afterEach(() => vi.restoreAllMocks());
describe("validated password recovery", () => {
  it("rejects direct access even with an existing password or OTP login", async () => {
    const recovery = await import("./recovery");
    await expect(
      recovery.restoreRecoverySession(
        "https://kortex.example/auth/reset-password",
      ),
    ).rejects.toMatchObject({ reason: "invalid" });
    api.getSession.mockResolvedValue({
      data: { session: session("password") },
      error: null,
    });
    await expect(
      recovery.restoreRecoverySession(
        "https://kortex.example/auth/reset-password#type=recovery",
      ),
    ).rejects.toMatchObject({ reason: "invalid" });
    expect(api.updateUser).not.toHaveBeenCalled();
  });
  it("validates the exact incoming identity and resumes the established session after module reload", async () => {
    const recovery = await import("./recovery");
    const current = session();
    expect(
      await recovery.restoreRecoverySession(
        `https://kortex.example/auth/reset-password#type=recovery&access_token=${current.access_token}`,
      ),
    ).toMatchObject({ user: { id: "person-one" } });
    expect(api.getUser).toHaveBeenCalledWith(current.access_token);
    expect(sessionStorage.getItem("kortex-recovery-context")).not.toContain(
      current.access_token,
    );
    vi.resetModules();
    const reloaded = await import("./recovery");
    await expect(
      reloaded.restoreRecoverySession(
        "https://kortex.example/auth/reset-password",
      ),
    ).resolves.toBeTruthy();
  });
  it("accepts the SDK recovery event without depending on it after refresh", async () => {
    const recovery = await import("./recovery");
    recovery.installRecoveryTracking();
    event("PASSWORD_RECOVERY", session());
    await expect(
      recovery.restoreRecoverySession(
        "https://kortex.example/auth/reset-password",
      ),
    ).resolves.toBeTruthy();
    event("SIGNED_OUT", null);
    await expect(
      recovery.restoreRecoverySession(
        "https://kortex.example/auth/reset-password",
      ),
    ).rejects.toBeTruthy();
  });
  it("continues the same legitimate recovery after the SDK rotates its access token", async () => {
    const initial = session();
    window.history.replaceState({}, "", `/auth/reset-password#type=recovery&access_token=${initial.access_token}`);
    const recovery = await import("./recovery");
    await recovery.restoreRecoverySession(window.location.href);
    window.history.replaceState({}, "", "/auth/reset-password");
    const refreshed = { ...initial, access_token: initial.access_token.replace("header.", "refreshed.") };
    api.getSession.mockResolvedValue({ data: { session: refreshed }, error: null });
    await expect(recovery.restoreRecoverySession(window.location.href)).resolves.toMatchObject({ access_token: refreshed.access_token });
    expect(api.getUser).toHaveBeenLastCalledWith(refreshed.access_token);
  });
  it("never substitutes an older account for a rejected or mismatched return", async () => {
    const recovery = await import("./recovery");
    recovery.installRecoveryTracking();
    event("PASSWORD_RECOVERY", session());
    await expect(
      recovery.restoreRecoverySession(
        "https://kortex.example/auth/reset-password#error=access_denied",
      ),
    ).rejects.toBeTruthy();
    await expect(
      recovery.restoreRecoverySession(
        "https://kortex.example/auth/reset-password#type=recovery&access_token=another-account-token",
      ),
    ).rejects.toBeTruthy();
    api.getUser.mockResolvedValue({
      data: { user: { id: "different-person" } },
      error: null,
    });
    await expect(
      recovery.restoreRecoverySession(
        "https://kortex.example/auth/reset-password",
      ),
    ).rejects.toBeTruthy();
    expect(api.updateUser).not.toHaveBeenCalled();
  });
  it("propagates failed SDK initialization rather than reusing a previous session", async () => {
    const recovery = await import("./recovery");
    api.initialize.mockResolvedValue({ error: { code: "otp_expired" } });
    await expect(
      recovery.restoreRecoverySession(
        "https://kortex.example/auth/reset-password?code=expired",
      ),
    ).rejects.toBeTruthy();
    expect(api.getUser).not.toHaveBeenCalled();
  });
  it("does not reuse an established recovery to authorize an unrelated callback code", async () => {
    const recovery = await import("./recovery");
    recovery.installRecoveryTracking();
    event("PASSWORD_RECOVERY", session());
    await recovery.restoreRecoverySession(
      "https://kortex.example/auth/reset-password",
    );
    await expect(
      recovery.restoreRecoverySession(
        "https://kortex.example/auth/reset-password?code=unrelated",
      ),
    ).rejects.toMatchObject({ reason: "invalid" });
    expect(api.updateUser).not.toHaveBeenCalled();
  });
  it("blocks expired recovery authentication even with an unexpired access token", async () => {
    const recovery = await import("./recovery");
    const old = session("otp", "old", 3700);
    api.getSession.mockResolvedValue({ data: { session: old }, error: null });
    await expect(
      recovery.restoreRecoverySession(
        `https://kortex.example/auth/reset-password#type=recovery&access_token=${old.access_token}`,
      ),
    ).rejects.toBeTruthy();
  });
  it("distinguishes a temporary validation outage", async () => {
    const recovery = await import("./recovery");
    api.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthRetryableFetchError", status: 0 },
    });
    await expect(
      recovery.restoreRecoverySession(
        "https://kortex.example/auth/reset-password",
      ),
    ).rejects.toMatchObject({ reason: "network" });
  });
  it("checks identity again, preserves the exact password and blocks history reuse after success", async () => {
    const recovery = await import("./recovery");
    recovery.installRecoveryTracking();
    event("PASSWORD_RECOVERY", session());
    await recovery.restoreRecoverySession(
      "https://kortex.example/auth/reset-password",
    );
    await expect(
      recovery.saveRecoveredPassword(
        "  Password!withSpaces  ",
        "another-person",
      ),
    ).rejects.toBeTruthy();
    expect(api.updateUser).not.toHaveBeenCalled();
    await recovery.saveRecoveredPassword(
      "  Password!withSpaces  ",
      "person-one",
    );
    expect(api.updateUser).toHaveBeenCalledExactlyOnceWith({
      password: "  Password!withSpaces  ",
    });
    await expect(
      recovery.restoreRecoverySession(
        `https://kortex.example/auth/reset-password#type=recovery&access_token=${session().access_token}`,
      ),
    ).rejects.toBeTruthy();
    expect(sessionStorage.getItem("kortex-recovery-context")).toBeNull();
  });
  it("does not claim success on provider failure or reuse an expired form", async () => {
    const recovery = await import("./recovery");
    recovery.installRecoveryTracking();
    event("PASSWORD_RECOVERY", session());
    await recovery.restoreRecoverySession(
      "https://kortex.example/auth/reset-password",
    );
    api.updateUser.mockResolvedValue({ error: { code: "session_expired" } });
    await expect(
      recovery.saveRecoveredPassword("NewPassword!1", "person-one"),
    ).rejects.toMatchObject({ reason: "invalid" });
    expect(sessionStorage.getItem("kortex-recovery-context")).toBeNull();
  });
  it("reports logout failure independently from a completed password update", async () => {
    const recovery = await import("./recovery");
    api.signOut.mockResolvedValue({ error: { code: "network_error" } });
    await expect(recovery.finishRecovery()).rejects.toMatchObject({
      code: "network_error",
    });
    expect(api.updateUser).not.toHaveBeenCalled();
  });
});
