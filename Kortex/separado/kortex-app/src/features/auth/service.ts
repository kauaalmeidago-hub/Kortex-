import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { isProfileSector, type ProfileSector } from "./model";

export type AuthProfile = {
  id: string;
  full_name: string | null;
  sector: ProfileSector | null;
  avatar_url: string | null;
};
export type AuthSettings = {
  google: boolean;
  signupEnabled: boolean;
  minPasswordLength: number;
  verified: boolean;
};
export const googleAuthMode =
  import.meta.env.VITE_AUTH_GOOGLE_MODE === "lovable" ? "lovable" : "supabase";

export function authFailure(error: unknown): string {
  const e = error as { code?: string; message?: string; status?: number };
  if (["42703", "42P01", "PGRST202", "PGRST204"].includes(e?.code ?? ""))
    return "O perfil aguarda uma atualização da plataforma. Sua conta foi preservada; tente novamente mais tarde.";
  if (e?.code === "invalid_credentials")
    return "E-mail ou senha incorretos. Confira seus dados.";
  if (e?.code === "email_not_confirmed")
    return "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.";
  if (e?.code === "same_password")
    return "Escolha uma senha diferente da senha atual.";
  if (e?.code === "weak_password")
    return "A senha não atende à política de segurança. Use uma senha mais longa, com letras, números e símbolos.";
  if (e?.code === "user_already_exists")
    return "Já existe uma conta com esse e-mail. Entre ou recupere sua senha.";
  if (e?.code === "signup_disabled")
    return "A criação de contas está indisponível no momento.";
  if (e?.status === 429 || e?.code?.includes("rate_limit"))
    return "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.";
  if (
    e?.code === "provider_disabled" ||
    (e?.code === "validation_failed" && e?.message?.includes("provider"))
  )
    return "O acesso com Google ainda não está habilitado nesta plataforma.";
  return "Não foi possível concluir. Seus dados foram preservados; tente novamente.";
}
export async function loadAuthSettings(): Promise<AuthSettings> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`,
      { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } },
    );
    if (!response.ok) throw new Error("SETTINGS_UNAVAILABLE");
    const data = await response.json();
    return {
      google: googleAuthMode === "lovable" || data.external?.google === true,
      signupEnabled: data.disable_signup !== true,
      minPasswordLength: Math.max(6, Number(data.password_min_length) || 6),
      verified: true,
    };
  } catch {
    return {
      google: googleAuthMode === "lovable",
      signupEnabled: true,
      minPasswordLength: 6,
      verified: false,
    };
  }
}
export async function loadAuthProfile(
  userId: string,
): Promise<AuthProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,sector,avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as AuthProfile | null;
}
export async function completeAuthProfile(
  sector: ProfileSector,
  fullName?: string,
): Promise<AuthProfile> {
  if (!isProfileSector(sector)) throw new Error("INVALID_PROFILE_SECTOR");
  const { data, error } = await supabase.rpc("complete_my_profile", {
    p_sector: sector,
    p_full_name: fullName?.trim() || undefined,
  });
  if (error) throw error;
  return data as AuthProfile;
}
export async function startGoogleAuth(redirectTo: string): Promise<void> {
  if (googleAuthMode === "lovable") {
    const { lovable } = await import("@/integrations/lovable");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: redirectTo,
    });
    if (result.error) throw result.error;
    if (!result.redirected) {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session)
        throw error ?? new Error("OAUTH_SESSION_UNAVAILABLE");
    }
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw error;
}
export async function restoreAuthReturn(url: string): Promise<Session | null> {
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  if (fragment.has("error") || parsed.searchParams.has("error"))
    throw new Error("AUTH_CALLBACK_REJECTED");
  // The installed Supabase client handles implicit callbacks and PKCE automatically.
  // Wait for its initialization before attempting an explicit code exchange.
  const current = await supabase.auth.getSession();
  if (current.error) throw current.error;
  if (current.data.session) return current.data.session;
  const code = parsed.searchParams.get("code");
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return data.session;
  }
  return null;
}
