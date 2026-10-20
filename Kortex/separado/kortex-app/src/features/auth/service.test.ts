import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signInWithOAuth: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: api.rpc, auth: api },
}));
import {
  completeAuthProfile,
  loadAuthSettings,
  restoreAuthReturn,
  startGoogleAuth,
} from "./service";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VITE_AUTH_GOOGLE_MODE", "supabase");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("authentication integration", () => {
  it("uses the authenticated profile RPC without accepting another user's identity", async () => {
    api.rpc.mockResolvedValue({
      data: { id: "same-user", sector: "financeiro" },
      error: null,
    });
    expect(
      await completeAuthProfile("financeiro", " Nome Completo "),
    ).toMatchObject({ id: "same-user" });
    expect(api.rpc).toHaveBeenCalledWith("complete_my_profile", {
      p_sector: "financeiro",
      p_full_name: "Nome Completo",
    });
  });
  it("preserves a profile error for retry and rejects privileged profile declarations", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(completeAuthProfile("comercial")).rejects.toEqual({
      code: "42501",
    });
    // Runtime payloads remain untrusted even when TypeScript has a narrow type.
    await expect(completeAuthProfile("admin" as "comercial")).rejects.toThrow(
      "INVALID_PROFILE_SECTOR",
    );
    expect(api.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not exchange a code twice after the SDK restored the callback session", async () => {
    api.getSession.mockResolvedValue({
      data: { session: { user: { id: "same-user" } } },
      error: null,
    });
    expect(
      await restoreAuthReturn(
        "https://kortex.example/auth/callback?code=opaque",
      ),
    ).toMatchObject({ user: { id: "same-user" } });
    expect(api.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("exchanges a code only when there is no restored session and propagates rejection", async () => {
    api.getSession.mockResolvedValue({ data: { session: null }, error: null });
    api.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { code: "otp_expired" },
    });
    await expect(
      restoreAuthReturn(
        "https://kortex.example/auth/reset-password?code=opaque",
      ),
    ).rejects.toEqual({ code: "otp_expired" });
    expect(api.exchangeCodeForSession).toHaveBeenCalledWith("opaque");
  });
  it("starts the configured Supabase Google provider with the environment callback", async () => {
    api.signInWithOAuth.mockResolvedValue({ error: null });
    const url = "https://kortex.example/auth/callback?next=%2Ftasks";
    await startGoogleAuth(url);
    expect(api.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: url },
    });
  });
  it("detects an unavailable Google provider without inventing a successful login", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            external: { google: false },
            disable_signup: false,
            password_min_length: 12,
          }),
        }),
    );
    expect(await loadAuthSettings()).toMatchObject({
      google: false,
      signupEnabled: true,
      minPasswordLength: 12,
      verified: true,
    });
  });
});
