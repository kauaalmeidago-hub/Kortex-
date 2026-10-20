import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  type Location,
} from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  authMode,
  authReturnUrl,
  isProfileSector,
  profileSectors,
  safeAuthDestination,
  validateAuthFields,
  type AuthErrors,
} from "@/features/auth/model";
import {
  authFailure,
  completeAuthProfile,
  loadAuthProfile,
  loadAuthSettings,
  restoreAuthReturn,
  startGoogleAuth,
  type AuthProfile,
  type AuthSettings,
} from "@/features/auth/service";
import {
  finishRecovery,
  RecoveryError,
  restoreRecoverySession,
  saveRecoveredPassword,
} from "@/features/auth/recovery";
import "./AuthPage.css";
import { waRequest, WaError } from '@/features/whatsapp/api';

const emailStorageKey = "kortex-auth-email";
// Temporarily hide the provider entry points while retaining existing callbacks.
const showGoogleSignIn = false;
const initialSettings: AuthSettings = {
  google: false,
  signupEnabled: true,
  minPasswordLength: 6,
  verified: false,
};
export default function AuthPage() {
  const location = useLocation(),
    navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const mode = authMode(location.pathname, location.search, location.hash);
  const recoveryLayout = mode === "forgot" || mode === "reset";
  const [forceLogin, setForceLogin] = useState(
    Boolean(
      location.state?.preventAutoLogin || location.state?.recoveryComplete,
    ),
  );
  const [returnAttempt, setReturnAttempt] = useState(0);

  const destination = useMemo(() => {
    const from = (location.state as { from?: Location } | null)?.from;
    return safeAuthDestination(
      from
        ? `${from.pathname}${from.search}${from.hash}`
        : new URLSearchParams(location.search).get("next"),
      window.location.origin,
    );
  }, [location]);
  const callbackUrl = authReturnUrl(
    window.location.origin,
    "/auth/callback",
    destination,
  );
  const linkState = { from: { pathname: destination, search: "", hash: "" } };
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(emailStorageKey) ?? "";
    } catch {
      return "";
    }
  });
  const [remember, setRemember] = useState(() => {
    try {
      return Boolean(localStorage.getItem(emailStorageKey));
    } catch {
      return false;
    }
  });
  const [name, setName] = useState(""),
    [sector, setSector] = useState("");
  const [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false),
    [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AuthErrors>({});
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const inFlight = useRef(false);
  const [settings, setSettings] = useState(initialSettings),
    [settingsLoading, setSettingsLoading] = useState(true);
  const passwordMinimum = Math.max(
    mode === "reset" ? 8 : 6,
    settings.minPasswordLength,
  );
  const [confirmationPending, setConfirmationPending] = useState(false),
    [passwordChanged, setPasswordChanged] = useState(false);
  const [returnedSession, setReturnedSession] = useState<Session | null>(null);
  const [returnLoading, setReturnLoading] = useState(
      mode === "callback" || mode === "reset",
    ),
    [returnError, setReturnError] = useState("");
  const returnRequest = useRef<{
    key: string;
    promise: Promise<Session | null>;
  }>();
  const currentUser = user ?? returnedSession?.user;
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [profileState, setProfileState] = useState<{
    userId: string;
    loading: boolean;
    data: AuthProfile | null;
    error: string;
  }>({ userId: "", loading: false, data: null, error: "" });
  useEffect(() => {
    let active = true;
    void loadAuthSettings().then((data) => {
      if (active) {
        setSettings(data);
        setSettingsLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setError("");
    setNotice("");
    setFieldErrors({});
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setConfirmationPending(false);
    setPasswordChanged(false);
  }, [mode]);
  useEffect(() => {
    if (mode === "login" && location.state?.recoveryComplete) {
      setForceLogin(true);
      setNotice("Senha redefinida com sucesso. Faça login com sua nova senha.");
      navigate(location.pathname + location.search, {
        replace: true,
        state: { ...linkState, preventAutoLogin: true },
      });
    } else if (mode === "login" && location.state?.preventAutoLogin)
      setForceLogin(true);
    // Consume the success notification once; never carry tokens in navigation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, location.state?.recoveryComplete]);
  useEffect(() => {
    if (mode !== "callback" && mode !== "reset") return;
    let active = true;
    const key = `${mode}:${location.pathname}:${returnAttempt}`;
    const returnUrl = `${window.location.origin}${location.pathname}${location.search}${location.hash}`;
    setReturnLoading(true);
    setReturnError("");
    if (returnRequest.current?.key !== key)
      returnRequest.current = {
        key,
        promise:
          mode === "reset"
            ? restoreRecoverySession(returnUrl)
            : restoreAuthReturn(returnUrl),
      };
    void returnRequest.current.promise
      .then((session) => {
        if (!active) return;
        setReturnedSession(session);
        if (!session)
          setReturnError(
            mode === "reset"
              ? "Este link é inválido ou expirou. Solicite um novo link para redefinir sua senha."
              : "Não foi possível confirmar seu acesso. Entre novamente ou solicite um novo link.",
          );
      })
      .catch((failure) => {
        if (active)
          setReturnError(
            mode === "reset"
              ? failure instanceof RecoveryError && failure.reason === "invalid"
                ? "Este link é inválido ou expirou. Solicite um novo link para redefinir sua senha."
                : "Não foi possível validar o link agora. Confira sua conexão e tente novamente."
              : "Não foi possível validar o link de acesso. Ele pode ter expirado; solicite um novo link.",
          );
      })
      .finally(() => {
        if (active) {
          setReturnLoading(false);
          const clean = new URL(returnUrl);
          [
            "code",
            "error",
            "error_code",
            "error_description",
            "token_hash",
            "token",
            "type",
          ].forEach((name) => clean.searchParams.delete(name));
          if (clean.hash || clean.search !== location.search)
            navigate(clean.pathname + clean.search, {
              replace: true,
              state: location.state,
            });
        }
      });
    return () => {
      active = false;
    };
    // The SDK consumes the return once. URL cleanup must reuse that result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, location.pathname, returnAttempt]);
  const userId = currentUser?.id,
    needsProfile =
      mode !== "reset" &&
      mode !== "forgot" &&
      !(
        mode === "login" &&
        (forceLogin ||
          location.state?.preventAutoLogin ||
          location.state?.recoveryComplete)
      );
  useEffect(() => {
    if (!userId || !needsProfile) return;
    let active = true;
    setProfileState({ userId, loading: true, data: null, error: "" });
    void loadAuthProfile(userId)
      .then((data) => {
        if (active)
          setProfileState({ userId, loading: false, data, error: "" });
      })
      .catch((failure) => {
        if (active)
          setProfileState({
            userId,
            loading: false,
            data: null,
            error: authFailure(failure),
          });
      });
    return () => {
      active = false;
    };
  }, [userId, needsProfile, profileAttempt]);
  const profileReady = Boolean(
    userId && profileState.userId === userId && !profileState.loading,
  );
  const profileComplete =
    profileReady && isProfileSector(profileState.data?.sector);
  useEffect(() => {
    if (
      currentUser &&
      !authLoading &&
      !busy &&
      !returnLoading &&
      !returnError &&
      needsProfile &&
      profileComplete
    )
      navigate(destination, { replace: true });
  }, [
    currentUser,
    authLoading,
    busy,
    returnLoading,
    returnError,
    needsProfile,
    profileComplete,
    destination,
    navigate,
  ]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const invalid = validateAuthFields(
      mode,
      { name, sector, email, password, confirmPassword },
      passwordMinimum,
    );
    setFieldErrors(invalid);
    setError("");
    setNotice("");
    if (Object.keys(invalid).length) {
      document.getElementById(`auth-${Object.keys(invalid)[0]}`)?.focus();
      return;
    }
    if (mode === "signup" && !settings.signupEnabled) {
      setError("A criação de contas está indisponível no momento.");
      return;
    }
    if (mode === "reset" && (!returnedSession || returnLoading || returnError))
      return;
    inFlight.current = true;
    setBusy("email");
    try {
      if (mode === "login") {
        const result = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (result.error) throw result.error;
        if (!result.data.session) throw new Error("SESSION_UNAVAILABLE");
        try {
          if (remember) localStorage.setItem(emailStorageKey, email.trim());
          else localStorage.removeItem(emailStorageKey);
        } catch {
          /* Optional email preference only. */
        }
        setForceLogin(false);
        setReturnedSession(result.data.session);
        setPassword("");
        navigate(location.pathname + location.search, {
          replace: true,
          state: linkState,
        });
      } else if (mode === "signup") {
        const result = await waRequest<{ created: boolean; session?: Session }>('signup', { body: {
          email: email.trim(),
          password,
          name: name.trim(), sector,
        } });
        setPassword("");
        setConfirmPassword("");
        if (result.created) {
          if (result.session) {
            const restored = await supabase.auth.setSession(result.session);
            if (restored.error) throw restored.error;
          }
          navigate('/auth/whatsapp', { replace: true });
        } else setConfirmationPending(true);
      } else if (mode === "forgot") {
        const result = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: authReturnUrl(
            window.location.origin,
            "/auth/reset-password",
            destination,
          ),
        });
        if (result.error) throw result.error;
        setNotice(
          "Se houver uma conta associada a este e-mail, você receberá as instruções para redefinir sua senha.",
        );
      } else if (mode === "reset") {
        await saveRecoveredPassword(password, returnedSession!.user.id);
        setPassword("");
        setConfirmPassword("");
        setPasswordChanged(true);
        setReturnedSession(null);
        try {
          await finishRecovery();
          navigate("/auth/login", {
            replace: true,
            state: { ...linkState, recoveryComplete: true },
          });
        } catch {
          setError(
            "Sua senha foi alterada, mas não foi possível encerrar a sessão. Tente concluir o retorno ao login.",
          );
        }
      }
    } catch (failure) {
      if (failure instanceof RecoveryError && failure.reason === "invalid") {
        setReturnError(
          "Este link é inválido ou expirou. Solicite um novo link para redefinir sua senha.",
        );
        setReturnedSession(null);
        setPassword("");
        setConfirmPassword("");
      } else setError(failure instanceof WaError ? failure.message : authFailure(failure));
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  };
  const google = async () => {
    if (inFlight.current || !settings.google) return;
    inFlight.current = true;
    setBusy("google");
    setError("");
    try {
      await startGoogleAuth(callbackUrl);
    } catch (failure) {
      setError(authFailure(failure));
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  };
  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || !userId) return;
    if (!isProfileSector(sector)) {
      setFieldErrors({ sector: "Selecione seu setor." });
      return;
    }
    inFlight.current = true;
    setBusy("profile");
    setError("");
    setFieldErrors({});
    try {
      const saved = await completeAuthProfile(
        sector,
        profileState.data?.full_name ||
          currentUser?.user_metadata.full_name ||
          currentUser?.user_metadata.name ||
          name,
      );
      setProfileState({ userId, loading: false, data: saved, error: "" });
    } catch (failure) {
      setError(authFailure(failure));
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  };
  const feedback = (
    <>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
  const googleButton = (
    <>
      <div className="auth-divider">
        <span>ou</span>
      </div>
      <button
        type="button"
        className="auth-button auth-google"
        onClick={() => void google()}
        disabled={Boolean(busy) || settingsLoading || !settings.google}
        aria-describedby={
          !settings.google && !settingsLoading
            ? "auth-google-status"
            : undefined
        }
      >
        {busy === "google" ? (
          <Loader2 className="animate-spin" size={18} />
        ) : (
          <GoogleMark />
        )}
        Continuar com Google
      </button>
      {!settingsLoading && !settings.google && (
        <p id="auth-google-status" className="auth-hint">
          {settings.verified
            ? "Acesso com Google ainda não habilitado."
            : "Não foi possível verificar o acesso com Google. Tente mais tarde."}
        </p>
      )}
    </>
  );
  let content: ReactNode;
  if (passwordChanged) {
    content = (
      <div className="auth-status" role="status">
        <CheckCircle2 size={36} />
        <AuthHeading
          title="Senha atualizada"
          subtitle="Sua nova senha foi salva."
        />
        {feedback}
        <button
          type="button"
          className="auth-button auth-primary"
          disabled={Boolean(busy)}
          onClick={async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            setBusy("finish");
            try {
              await finishRecovery();
              navigate("/auth/login", {
                replace: true,
                state: { ...linkState, recoveryComplete: true },
              });
            } catch {
              setError(
                "Sua senha já foi alterada. Não foi possível encerrar a sessão; tente novamente.",
              );
            } finally {
              inFlight.current = false;
              setBusy("");
            }
          }}
        >
          {busy ? "Aguarde..." : "Voltar para o login"}
        </button>
      </div>
    );
  } else if (confirmationPending && !currentUser) {
    content = (
      <div className="auth-status" role="status">
        <CheckCircle2 size={36} />
        <AuthHeading
          title="Confira seu e-mail"
          subtitle="Para continuar o cadastro, confirme o link enviado ao endereço informado."
        />
        <p className="auth-hint">
          A confirmação ainda não inicia sua sessão nesta janela.
        </p>
        <Link
          className="auth-button auth-primary"
          to="/auth/login"
          state={linkState}
        >
          Voltar para entrar
        </Link>
      </div>
    );
  } else if (currentUser && needsProfile) {
    content =
      !profileReady || authLoading ? (
        <AuthStatus text="Carregando seu perfil..." />
      ) : profileState.error ? (
        <div className="auth-form">
          <AuthHeading
            title="Concluir seu perfil"
            subtitle="Sua conta foi preservada."
          />
          <p role="alert" className="auth-error">
            {profileState.error}
          </p>
          <button
            type="button"
            className="auth-button auth-primary"
            onClick={() => setProfileAttempt((n) => n + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : profileComplete ? (
        <AuthStatus text="Abrindo sua conta..." />
      ) : (
        <form className="auth-form" onSubmit={saveProfile} noValidate>
          <AuthHeading
            title="Qual é seu setor?"
            subtitle="Complete seu perfil para continuar. Sua conta já está conectada."
          />
          <SectorField
            value={sector}
            onChange={setSector}
            error={fieldErrors.sector}
            disabled={Boolean(busy)}
          />
          <p className="auth-hint">
            O setor informado compõe seu perfil. O acesso à equipe e às tarefas
            segue as permissões da sua conta.
          </p>
          {feedback}
          <AuthSubmit busy={Boolean(busy)} label="Salvar e continuar" />
        </form>
      );
  } else if (mode === "callback") {
    content = returnError ? (
      <div className="auth-form">
        <AuthHeading
          title="Confira seu acesso"
          subtitle="Não foi possível concluir a confirmação."
        />
        <p className="auth-error" role="alert">
          {returnError}
        </p>
        <Link
          className="auth-button auth-primary"
          to="/auth/login"
          state={linkState}
        >
          Voltar para entrar
        </Link>
      </div>
    ) : (
      <AuthStatus text="Confirmando seu acesso..." />
    );
  } else {
    const signup = mode === "signup",
      reset = mode === "reset",
      forgot = mode === "forgot";
    content = (
      <form
        className="auth-form"
        onSubmit={onSubmit}
        noValidate
        aria-busy={Boolean(busy)}
      >
        {mode === "login" && (
          <img
            className="auth-platform-mark"
            src="/brand/kortex-symbol.png"
            alt="Kortex"
            width="40"
            height="40"
          />
        )}
        <AuthHeading
          title={
            signup
              ? "Crie sua conta"
              : forgot
                ? "Esqueceu sua senha?"
                : reset
                  ? "Redefina sua senha"
                  : "Comece sua jornada"
          }
          subtitle={
            signup
              ? "Comece sua jornada com a gente."
              : forgot
                ? "Informe seu e-mail para receber as instruções de recuperação."
                : reset
                  ? "Crie uma nova senha para acessar sua conta."
                  : "Seu próximo passo começa aqui."
          }
        />
        <fieldset
          disabled={
            Boolean(busy) ||
            (reset &&
              (returnLoading || Boolean(returnError) || !returnedSession))
          }
          className="auth-fields"
        >
          {signup && (
            <div className="auth-name-sector">
              <AuthField
                id="auth-name"
                label="Nome"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                error={fieldErrors.name}
                maxLength={160}
                required
              />
              <SectorField
                value={sector}
                onChange={setSector}
                error={fieldErrors.sector}
                disabled={Boolean(busy)}
              />
            </div>
          )}
          {!reset && (
            <AuthField
              id="auth-email"
              label="E-mail"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Digite seu e-mail"
              error={fieldErrors.email}
              required
            />
          )}
          {!forgot && (
            <PasswordField
              id="auth-password"
              label={reset ? "Nova senha" : "Senha"}
              value={password}
              onChange={setPassword}
              shown={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
              autoComplete={
                signup || reset ? "new-password" : "current-password"
              }
              placeholder={
                reset
                  ? "Digite sua nova senha"
                  : signup
                    ? "Crie sua senha"
                    : "Digite sua senha"
              }
              error={fieldErrors.password}
              hint={
                reset
                  ? `Use pelo menos ${passwordMinimum} caracteres.`
                  : undefined
              }
            />
          )}
          {(signup || reset) && (
            <PasswordField
              id="auth-confirmPassword"
              label={reset ? "Confirmar nova senha" : "Confirmar senha"}
              value={confirmPassword}
              onChange={setConfirmPassword}
              shown={showConfirmPassword}
              onToggle={() => setShowConfirmPassword((v) => !v)}
              autoComplete="new-password"
              placeholder={
                reset ? "Digite novamente sua senha" : "Confirme sua senha"
              }
              error={fieldErrors.confirmPassword}
            />
          )}
        </fieldset>
        {mode === "login" && (
          <div>
            <div className="auth-login-options">
              <label htmlFor="auth-remember" className="auth-remember">
                <Checkbox
                  id="auth-remember"
                  checked={remember}
                  onCheckedChange={(value) => setRemember(value === true)}
                  disabled={Boolean(busy)}
                  aria-describedby="auth-remember-hint"
                />
                Lembrar de mim
              </label>
              <Link to="/auth/forgot-password" state={linkState}>
                Esqueceu a senha?
              </Link>
            </div>
            <p className="auth-hint" id="auth-remember-hint">
              Salva somente seu e-mail neste dispositivo.
            </p>
          </div>
        )}
        {signup && (
          <p className="auth-hint">
            Use pelo menos {passwordMinimum} caracteres.
          </p>
        )}
        {reset && returnLoading && (
          <AuthStatus text="Validando o link de recuperação..." />
        )}
        {reset && returnError && (
          <p className="auth-error" role="alert">
            {returnError}{" "}
            <Link to="/auth/forgot-password" state={linkState}>
              Solicitar novo link
            </Link>
          </p>
        )}
        {reset && returnError && (
          <button
            type="button"
            className="auth-button auth-google"
            onClick={() => setReturnAttempt((value) => value + 1)}
          >
            Tentar validar novamente
          </button>
        )}
        {feedback}
        <AuthSubmit
          busy={busy === "email"}
          disabled={
            Boolean(busy) ||
            (reset &&
              (returnLoading || Boolean(returnError) || !returnedSession)) ||
            (signup && !settings.signupEnabled)
          }
          label={
            signup
              ? "Criar conta"
              : forgot
                ? "Enviar link de recuperação"
                : reset
                  ? "Salvar nova senha"
                  : "Entrar"
          }
        />
        {showGoogleSignIn && (signup || mode === "login") && googleButton}
        <p className="auth-switch">
          {signup ? (
            <>
              Já tem uma conta?{" "}
              <Link to="/auth/login" state={linkState}>
                Entrar
              </Link>
            </>
          ) : mode === "login" ? (
            <>
              Ainda não tem uma conta?{" "}
              <Link to="/auth/signup" state={linkState}>
                Criar conta
              </Link>
            </>
          ) : (
            <Link
              className="auth-back-link"
              to="/auth/login"
              state={{ ...linkState, preventAutoLogin: true }}
            >
              <ArrowLeft size={16} aria-hidden="true" /> Voltar para o login
            </Link>
          )}
        </p>
      </form>
    );
  }
  return (
    <main className="auth-page">
      <section
        className={`auth-card ${recoveryLayout ? "auth-card--recovery" : mode === "signup" ? "auth-card--signup" : "auth-card--login"}`}
        aria-label={mode === "signup" ? "Criar conta Kortex" : "Acesso Kortex"}
      >
        <section className="auth-form-panel">{content}</section>
        <aside className="auth-art" aria-hidden="true">
          <img
            src={
              recoveryLayout
                ? "/auth/koa-recovery-art.png"
                : mode === "signup"
                  ? "/auth/koa-signup-art.png"
                  : "/auth/koa-login-art.png"
            }
            alt=""
            width="1120"
            height="1400"
          />
          {!recoveryLayout && mode !== "signup" && (
            <div className="auth-art-copy">
              <span>Sua operação, conectada.</span>
              <h2>
                Mais clareza para gerir.
                <br />
                Mais tempo para evoluir.
              </h2>
              <p>Centralize conversas, empresas e tarefas em um só lugar.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
function AuthHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="auth-heading">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}
function AuthStatus({ text }: { text: string }) {
  return (
    <p className="auth-loading" role="status">
      <Loader2 size={18} className="animate-spin" />
      {text}
    </p>
  );
}
function AuthSubmit({
  busy,
  disabled,
  label,
}: {
  busy: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="submit"
      className="auth-button auth-primary auth-submit"
      disabled={busy || disabled}
    >
      {busy && <Loader2 size={18} className="animate-spin" />}
      {busy ? "Aguarde..." : label}
    </button>
  );
}
function AuthField({
  label,
  error,
  children,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  children?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="auth-field">
      <label htmlFor={props.id}>{label}</label>
      <div className="auth-input-wrap">
        <input
          {...props}
          aria-invalid={Boolean(error)}
          aria-describedby={
            [error ? `${props.id}-error` : "", hint ? `${props.id}-hint` : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {children}
      </div>
      {hint && (
        <p id={`${props.id}-hint`} className="auth-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${props.id}-error`} className="auth-field-error">
          {error}
        </p>
      )}
    </div>
  );
}
function PasswordField({
  id,
  label,
  value,
  onChange,
  shown,
  onToggle,
  autoComplete,
  placeholder,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  shown: boolean;
  onToggle: () => void;
  autoComplete: string;
  placeholder: string;
  error?: string;
  hint?: string;
}) {
  return (
    <AuthField
      id={id}
      label={label}
      type={shown ? "text" : "password"}
      autoComplete={autoComplete}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      error={error}
      required
      className="auth-password-input"
      hint={hint}
    >
      <button
        type="button"
        className="auth-password-toggle"
        onClick={onToggle}
        aria-label={`${shown ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`}
        aria-pressed={shown}
      >
        {shown ? <EyeOff size={19} /> : <Eye size={19} />}
      </button>
    </AuthField>
  );
}
function SectorField({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="auth-field">
      <label htmlFor="auth-sector">Setor</label>
      <Select
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        required
        name="sector"
      >
        <SelectTrigger
          id="auth-sector"
          className="auth-sector-trigger"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "auth-sector-error" : undefined}
        >
          <SelectValue placeholder="Selecione seu setor" />
        </SelectTrigger>
        <SelectContent className="auth-sector-menu" collisionPadding={12}>
          {profileSectors.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p id="auth-sector-error" className="auth-field-error">
          {error}
        </p>
      )}
    </div>
  );
}
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285f4"
        d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.1v5h6.6c3.9-3.6 6.1-8.8 6.1-14.8Z"
      />
      <path
        fill="#34a853"
        d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5c-1.8 1.2-4.2 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.2A20.4 20.4 0 0 0 24 44Z"
      />
      <path
        fill="#fbbc05"
        d="M12.6 27.6a12.3 12.3 0 0 1 0-7.2v-5.2H5.8a20 20 0 0 0 0 17.6l6.8-5.2Z"
      />
      <path
        fill="#ea4335"
        d="M24 12c3 0 5.6 1 7.7 3l5.8-5.8C34 6 29.5 4 24 4A20.4 20.4 0 0 0 5.8 15.2l6.8 5.2C14.2 15.6 18.7 12 24 12Z"
      />
    </svg>
  );
}
