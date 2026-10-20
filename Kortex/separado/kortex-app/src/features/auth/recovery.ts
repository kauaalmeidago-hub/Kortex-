import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const grantKey = "kortex-recovery-context";
const consumedKey = "kortex-recovery-consumed";
const landingUrl = window.location.href;
let pendingSession: Session | null = null;
let memoryGrant: RecoveryGrant | null = null;
let consumed: string[] = [];
let tracking: (() => void) | undefined;
type RecoveryGrant = { userId: string; sessionId: string; expiresAt: number };
export class RecoveryError extends Error {
  constructor(public readonly reason: "invalid" | "network") {
    super(reason === "invalid" ? "RECOVERY_INVALID" : "RECOVERY_UNAVAILABLE");
  }
}

// Only non-secret identifiers are stored here. The SDK owns all tokens; every
// use is checked against a server-validated session, not this continuity marker.
function readGrant(): RecoveryGrant | null {
  try {
    return (
      JSON.parse(sessionStorage.getItem(grantKey) || "null") ?? memoryGrant
    );
  } catch {
    return memoryGrant;
  }
}
function writeGrant(grant: RecoveryGrant | null) {
  memoryGrant = grant;
  try {
    if (grant) sessionStorage.setItem(grantKey, JSON.stringify(grant));
    else sessionStorage.removeItem(grantKey);
  } catch {
    /* Without storage the valid context lasts for this page only. */
  }
}
function wasConsumed(id: string) {
  try {
    consumed = JSON.parse(localStorage.getItem(consumedKey) || "[]");
  } catch {
    /* Keep the in-memory tombstones if storage is unavailable. */
  }
  return Array.isArray(consumed) && consumed.includes(id);
}
function sessionIdentity(session: Session): RecoveryGrant | null {
  try {
    // getUser(token) validates this exact JWT before these claims are trusted.
    const encoded = session.access_token
      .split(".")[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const claims = JSON.parse(atob(encoded));
    const otp = claims.amr?.find(
      (entry: { method: string }) =>
        entry.method === "otp" || entry.method === "recovery",
    );
    if (!claims.session_id || claims.sub !== session.user.id || !otp?.timestamp)
      return null;
    return {
      userId: claims.sub,
      sessionId: claims.session_id,
      expiresAt:
        Math.min(Number(claims.exp), Number(otp.timestamp) + 3600) * 1000,
    };
  } catch {
    return null;
  }
}

export function installRecoveryTracking() {
  if (tracking) return tracking;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // Never await another SDK call inside its auth-state lock.
    if (event === "PASSWORD_RECOVERY") pendingSession = session;
    if (event === "SIGNED_OUT") {
      pendingSession = null;
      writeGrant(null);
    }
  });
  tracking = () => {
    data.subscription.unsubscribe();
    tracking = undefined;
  };
  return tracking;
}

export async function restoreRecoverySession(url: string): Promise<Session> {
  installRecoveryTracking();
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  if (parsed.searchParams.has("error") || fragment.has("error"))
    throw new RecoveryError("invalid");
  // Initialization is the single owner of implicit/PKCE callback consumption.
  const initialized = await supabase.auth.initialize();
  if (initialized.error) throw new RecoveryError("invalid");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session) throw new RecoveryError("invalid");
  const verified = await supabase.auth.getUser(session.access_token);
  if (verified.error) {
    if (
      verified.error.status === 0 ||
      verified.error.name === "AuthRetryableFetchError"
    )
      throw new RecoveryError("network");
    throw new RecoveryError("invalid");
  }
  if (verified.data.user?.id !== session.user.id)
    throw new RecoveryError("invalid");
  const identity = sessionIdentity(session);
  if (
    !identity ||
    identity.expiresAt <= Date.now() ||
    wasConsumed(identity.sessionId)
  )
    throw new RecoveryError("invalid");
  const original = new URL(landingUrl);
  // A code belongs to the SDK's original navigation. An arbitrary code added
  // later must not borrow a previously established recovery session.
  if (
    parsed.searchParams.has("code") &&
    parsed.searchParams.get("code") !== original.searchParams.get("code")
  )
    throw new RecoveryError("invalid");
  const originalFragment = new URLSearchParams(original.hash.slice(1));
  const incomingToken =
    fragment.get("access_token") ?? originalFragment.get("access_token");
  const incomingRecovery =
    fragment.get("type") === "recovery" ||
    originalFragment.get("type") === "recovery";
  const fromSdk = pendingSession?.access_token === session.access_token;
  const fromImplicitReturn =
    incomingRecovery && incomingToken === session.access_token;
  const grant = readGrant();
  const continuing =
    grant?.sessionId === identity.sessionId &&
    grant.userId === identity.userId &&
    grant.expiresAt > Date.now();
  // A new URL must match its own validated callback, never an older session.
  const hasNewReturn =
    fragment.has("access_token") || parsed.searchParams.has("code");
  if (
    hasNewReturn
      ? !(fromSdk || fromImplicitReturn)
      : !(fromSdk || fromImplicitReturn || continuing)
  )
    throw new RecoveryError("invalid");
  if (
    incomingToken &&
    incomingToken !== session.access_token &&
    (fragment.has("access_token") || !continuing)
  )
    throw new RecoveryError("invalid");
  writeGrant(identity);
  return session;
}

export async function saveRecoveredPassword(
  password: string,
  expectedUserId: string,
) {
  if (password.length < 8) throw { code: "weak_password" };
  const session = await restoreRecoverySession(
    window.location.origin + "/auth/reset-password",
  );
  if (session.user.id !== expectedUserId) throw new RecoveryError("invalid");
  const current = await supabase.auth.getSession();
  if (
    current.error ||
    current.data.session?.access_token !== session.access_token
  )
    throw new RecoveryError("invalid");
  const result = await supabase.auth.updateUser({ password });
  if (result.error) {
    if (
      [
        "session_not_found",
        "session_expired",
        "refresh_token_not_found",
        "user_not_found",
        "bad_jwt",
      ].includes(result.error.code || "")
    ) {
      writeGrant(null);
      throw new RecoveryError("invalid");
    }
    throw result.error;
  }
  const grant = readGrant();
  if (grant) {
    wasConsumed(grant.sessionId);
    consumed = [
      ...(Array.isArray(consumed) ? consumed : []),
      grant.sessionId,
    ].slice(-16);
    try {
      localStorage.setItem(consumedKey, JSON.stringify(consumed));
    } catch {
      /* Memory still blocks reuse. */
    }
  }
  pendingSession = null;
  writeGrant(null);
}

export async function finishRecovery() {
  // Match the application's existing global logout policy.
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
