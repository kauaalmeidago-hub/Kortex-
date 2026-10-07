import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate, type Location } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type AuthMode = "login" | "signup" | "forgot" | "reset";

const brandLogo = "/auth/kortex-wordmark.png";
const authVisual = "/auth/kortex-auth-visual.png";
const emailStorageKey = "kortex-auth-email";

function getRedirectTo(location: Location) {
  const locationState = location.state as { from?: Location } | null;
  return locationState?.from
    ? `${locationState.from.pathname}${locationState.from.search}${locationState.from.hash}`
    : "/";
}

function getAuthMode(location: Location): AuthMode {
  const pathname = location.pathname.toLowerCase();
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));

  if (
    pathname.includes("reset-password") ||
    pathname.includes("nova-senha") ||
    search.has("code") ||
    hash.get("type") === "recovery" ||
    hash.has("access_token")
  ) {
    return "reset";
  }

  if (pathname.includes("forgot-password") || pathname.includes("recuperar-senha")) {
    return "forgot";
  }

  if (pathname.includes("signup") || pathname.includes("criar-conta")) {
    return "signup";
  }

  return "login";
}

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loading: authLoading, user } = useAuth();
  const mode = useMemo(() => getAuthMode(location), [location]);
  const redirectTo = useMemo(() => getRedirectTo(location), [location]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [remember, setRemember] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [checkingRecovery, setCheckingRecovery] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  useEffect(() => {
    const savedEmail = localStorage.getItem(emailStorageKey);
    if (savedEmail) {
      setEmail(savedEmail);
      setRemember(true);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user && mode !== "reset") {
      navigate(redirectTo, { replace: true });
    }
  }, [authLoading, mode, navigate, redirectTo, user]);

  useEffect(() => {
    if (mode !== "reset") return;

    let mounted = true;

    async function activateRecoverySession() {
      setCheckingRecovery(true);

      const searchParams = new URLSearchParams(location.search);
      const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
      const code = searchParams.get("code");
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!mounted) return;
        if (error) toast.error(error.message);
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!mounted) return;
        if (error) toast.error(error.message);
      }

      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      const sessionEmail = data.session?.user?.email;
      if (sessionEmail) setEmail((current) => current || sessionEmail);
      setRecoveryReady(Boolean(data.session));
      setCheckingRecovery(false);
    }

    activateRecoverySession();

    return () => {
      mounted = false;
    };
  }, [location.hash, location.search, mode]);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    if (remember) {
      localStorage.setItem(emailStorageKey, email);
    } else {
      localStorage.removeItem(emailStorageKey);
    }

    navigate(redirectTo, { replace: true });
  };

  const signUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== confirmPassword) {
      toast.error("As senhas precisam ser iguais.");
      return;
    }

    if (!termsAccepted) {
      toast.error("Aceite os Termos de Uso e a Política de Privacidade para continuar.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: name },
      },
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Conta criada! Bem-vindo ao Kortex.");
    navigate("/", { replace: true });
  };

  const recoverPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setResetSent(true);
    toast.success("Link de redefinição enviado para seu e-mail.");
  };

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== confirmPassword) {
      toast.error("As senhas precisam ser iguais.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setPasswordChanged(true);
  };

  return (
    <AuthShell mode={mode}>
      {mode === "signup" ? (
        <SignupForm
          confirmPassword={confirmPassword}
          email={email}
          loading={loading}
          name={name}
          password={password}
          setConfirmPassword={setConfirmPassword}
          setEmail={setEmail}
          setName={setName}
          setPassword={setPassword}
          setShowConfirmPassword={setShowConfirmPassword}
          setShowPassword={setShowPassword}
          setTermsAccepted={setTermsAccepted}
          showConfirmPassword={showConfirmPassword}
          showPassword={showPassword}
          signUp={signUp}
          termsAccepted={termsAccepted}
        />
      ) : mode === "forgot" ? (
        <ForgotPasswordForm
          email={email}
          loading={loading}
          recoverPassword={recoverPassword}
          resetSent={resetSent}
          setEmail={setEmail}
        />
      ) : mode === "reset" ? (
        <ResetPasswordForm
          checkingRecovery={checkingRecovery}
          confirmPassword={confirmPassword}
          email={email}
          loading={loading}
          password={password}
          recoveryReady={recoveryReady}
          setConfirmPassword={setConfirmPassword}
          setEmail={setEmail}
          setPassword={setPassword}
          setShowConfirmPassword={setShowConfirmPassword}
          setShowPassword={setShowPassword}
          showConfirmPassword={showConfirmPassword}
          showPassword={showPassword}
          updatePassword={updatePassword}
        />
      ) : (
        <LoginForm
          email={email}
          loading={loading}
          password={password}
          remember={remember}
          setEmail={setEmail}
          setPassword={setPassword}
          setRemember={setRemember}
          setShowPassword={setShowPassword}
          showPassword={showPassword}
          signIn={signIn}
        />
      )}

      {passwordChanged && (
        <SuccessModal
          onClose={() => {
            setPasswordChanged(false);
            navigate("/", { replace: true });
          }}
        />
      )}
    </AuthShell>
  );
}

type AuthShellProps = {
  children: ReactNode;
  mode: AuthMode;
};

function AuthShell({ children, mode }: AuthShellProps) {
  const isLogin = mode === "login";

  return (
    <main className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden bg-[#020816] p-4 text-white sm:p-5 lg:p-6">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full bg-[#075cff]/35 blur-[120px]" />
        <div className="absolute -bottom-44 right-0 h-[620px] w-[620px] rounded-full bg-[#006eff]/40 blur-[130px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(48,144,255,0.18),transparent_38%),linear-gradient(135deg,rgba(4,17,38,0.92),rgba(2,8,22,0.98))]" />
      </div>

      <section
        className={[
          "relative mx-auto grid w-full max-w-[1220px] overflow-hidden border border-[#0c83ff]/70 bg-[#030912]/92 shadow-[0_0_80px_rgba(0,99,255,0.38)] backdrop-blur-xl",
          "rounded-[24px] lg:h-[clamp(520px,calc(100dvh-48px),680px)] lg:max-h-[calc(100dvh-48px)] lg:grid-cols-[minmax(0,3fr)_minmax(400px,2fr)]",
        ].join(" ")}
      >
        {isLogin ? <LoginVisual /> : <WorkspaceVisual />}

        <section
          className={[
            "relative flex min-h-[calc(100dvh-32px)] min-w-0 items-center justify-center bg-[#030912]/96 px-6 py-8 sm:px-8",
            "lg:h-full lg:min-h-0 lg:overflow-y-auto lg:px-10 lg:py-6 xl:px-12",
          ].join(" ")}
        >
          <div className={isLogin ? "w-full max-w-[390px]" : "w-full max-w-[470px]"}>{children}</div>
        </section>
      </section>
    </main>
  );
}

function LoginVisual() {
  return (
    <aside className="relative hidden h-full min-w-0 overflow-hidden bg-[#061736] lg:block">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_74%_8%,rgba(0,183,255,0.75),transparent_28%),radial-gradient(circle_at_2%_88%,rgba(0,78,255,0.95),transparent_35%),linear-gradient(145deg,#02112c,#06215a_48%,#020916)]" />
      <div className="absolute -left-[25%] top-[5%] h-[880px] w-[880px] rounded-full border-[88px] border-[#0b5cff]/35 opacity-80 blur-[1px]" />
      <div className="absolute -bottom-[34%] -left-[3%] h-[820px] w-[360px] rotate-[-44deg] rounded-[72px] bg-gradient-to-b from-[#063cff]/95 via-[#022a9d]/80 to-[#000b2f]/60 shadow-[0_0_90px_rgba(0,85,255,0.62)]" />
      <div className="absolute left-[48%] top-[12%] h-[610px] w-[178px] rotate-45 rounded-[58px] bg-gradient-to-br from-[#00bbff] via-[#086eff] to-[#001c9f] shadow-[0_0_70px_rgba(0,157,255,0.65)]" />
      <div className="absolute left-[68%] top-[34%] h-[420px] w-[156px] rotate-[-42deg] rounded-[48px] bg-gradient-to-br from-[#9ed7ff] via-[#197dff] to-[#061c69] opacity-85 shadow-[0_0_52px_rgba(113,190,255,0.42)]" />
      <div className="absolute inset-y-0 right-0 w-px bg-[#0c83ff]/80" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),transparent_28%,rgba(0,0,0,0.28)_72%)]" />
    </aside>
  );
}

function WorkspaceVisual() {
  return (
    <aside className="relative hidden h-full min-w-0 overflow-hidden bg-[#f7fbff] lg:block">
      <img
        src={authVisual}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center opacity-70 brightness-[1.34] contrast-[0.82] saturate-[0.82]"
      />
      <div className="absolute inset-0 bg-white/42" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.96),transparent_28%),linear-gradient(90deg,rgba(255,255,255,0.95),rgba(244,250,255,0.54)_62%,rgba(231,242,255,0.35))]" />
      <div className="absolute -right-[4%] top-[4%] h-[740px] w-[260px] rotate-45 rounded-[74px] bg-gradient-to-b from-[#0e7cff]/10 via-[#0e7cff]/24 to-[#0e7cff]/8" />
      <div className="absolute right-[18%] top-[30%] h-[430px] w-[156px] rotate-[-43deg] rounded-[54px] bg-gradient-to-b from-white/78 via-[#ddecff]/68 to-white/42 shadow-[0_24px_80px_rgba(15,96,255,0.14)]" />
      <div className="absolute bottom-[16%] left-[18%] h-[238px] w-[420px] rotate-[6deg] rounded-[22px] border border-[#b7cdf2]/60 bg-white/78 shadow-[0_30px_80px_rgba(8,35,92,0.22)] backdrop-blur">
        <div className="mx-auto mt-4 h-[150px] w-[360px] rounded-[16px] bg-gradient-to-br from-[#eef6ff] to-white p-5 shadow-inner">
          <div className="mb-5 flex items-center gap-2">
            <span className="h-6 w-6 rounded-md bg-[#0a7cff]" />
            <span className="h-2 w-20 rounded-full bg-[#12305d]/22" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <span className="h-16 rounded-xl bg-[#0a7cff]/12" />
            <span className="h-16 rounded-xl bg-[#0a7cff]/16" />
            <span className="h-16 rounded-xl bg-[#0a7cff]/10" />
          </div>
        </div>
        <div className="mx-auto h-5 w-52 rounded-b-[18px] bg-[#dce7f8]" />
      </div>
    </aside>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  icon: ReactNode;
  label: string;
  right?: ReactNode;
  hint?: string;
};

function AuthField({ icon, label, right, hint, className, ...props }: FieldProps) {
  return (
    <label className="grid gap-2">
      <span className="text-[15px] font-semibold text-white/88">{label}</span>
      <span className="relative block">
        <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[#b9cff7]">{icon}</span>
        <Input
          {...props}
          className={[
            "h-[52px] rounded-[12px] border border-[#5a7fbd]/75 bg-[#0c1c35]/80 pl-[54px] pr-5 text-[16px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none placeholder:text-[#a8b9d8] focus-visible:border-[#16a0ff] focus-visible:ring-2 focus-visible:ring-[#0f85ff]/45 focus-visible:ring-offset-0",
            className,
          ]
            .filter(Boolean)
            .join(" ")}
        />
        {right}
      </span>
      {hint && <span className="text-[14px] leading-5 text-[#b9c8e2]">{hint}</span>}
    </label>
  );
}

type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  show: boolean;
  setShow: (show: boolean) => void;
  hint?: string;
};

function PasswordField({ label, value, onChange, placeholder, show, setShow, hint }: PasswordFieldProps) {
  return (
    <AuthField
      icon={<Lock size={27} strokeWidth={1.8} />}
      label={label}
      type={show ? "text" : "password"}
      required
      minLength={8}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      hint={hint}
      className="pr-[58px]"
      right={
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-5 top-1/2 -translate-y-1/2 text-[#b9cff7] transition hover:text-white"
          aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        >
          {show ? <EyeOff size={24} strokeWidth={1.8} /> : <Eye size={24} strokeWidth={1.8} />}
        </button>
      }
    />
  );
}

type LoginFormProps = {
  email: string;
  loading: boolean;
  password: string;
  remember: boolean;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setRemember: (value: boolean) => void;
  setShowPassword: (value: boolean) => void;
  showPassword: boolean;
  signIn: (event: FormEvent<HTMLFormElement>) => void;
};

function LoginForm({
  email,
  loading,
  password,
  remember,
  setEmail,
  setPassword,
  setRemember,
  setShowPassword,
  showPassword,
  signIn,
}: LoginFormProps) {
  return (
    <>
      <img src={brandLogo} alt="Kortex" className="mb-10 h-auto w-[210px] object-contain xl:w-[224px]" />

      <form onSubmit={signIn} className="space-y-6">
        <AuthField
          icon={<Mail size={27} strokeWidth={1.8} />}
          label="E-mail"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="seu@email.com"
        />

        <PasswordField
          label="Senha"
          value={password}
          onChange={setPassword}
          placeholder="Digite sua senha"
          show={showPassword}
          setShow={setShowPassword}
        />

        <div className="flex items-center justify-between gap-4 pt-1 text-[15px]">
          <label className="flex items-center gap-3 font-semibold text-white/90">
            <Checkbox
              checked={remember}
              onCheckedChange={(value) => setRemember(value === true)}
              className="h-[26px] w-[26px] rounded-[6px] border-[#2d9bff] bg-[#0e8cff] text-white data-[state=checked]:bg-[#0e8cff]"
            />
            Lembrar de mim
          </label>

          <Link to="/auth/forgot-password" className="font-semibold text-[#18a7ff] underline-offset-4 hover:underline">
            Esqueci minha senha?
          </Link>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="h-[58px] w-full rounded-[14px] bg-gradient-to-r from-[#00adff] to-[#0067ff] text-[21px] font-bold text-white shadow-[0_20px_55px_rgba(0,105,255,0.32)] hover:from-[#23bcff] hover:to-[#1474ff]"
        >
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : "Entrar"}
          {!loading && <ArrowRight size={28} strokeWidth={1.8} />}
        </Button>

        <p className="pt-2 text-center text-[16px] text-white/78">
          Não tem conta?{" "}
          <Link to="/auth/signup" className="font-semibold text-[#18a7ff] hover:underline">
            Criar conta
          </Link>
        </p>
      </form>
    </>
  );
}

type SignupFormProps = {
  confirmPassword: string;
  email: string;
  loading: boolean;
  name: string;
  password: string;
  setConfirmPassword: (value: string) => void;
  setEmail: (value: string) => void;
  setName: (value: string) => void;
  setPassword: (value: string) => void;
  setShowConfirmPassword: (value: boolean) => void;
  setShowPassword: (value: boolean) => void;
  setTermsAccepted: (value: boolean) => void;
  showConfirmPassword: boolean;
  showPassword: boolean;
  signUp: (event: FormEvent<HTMLFormElement>) => void;
  termsAccepted: boolean;
};

function SignupForm({
  confirmPassword,
  email,
  loading,
  name,
  password,
  setConfirmPassword,
  setEmail,
  setName,
  setPassword,
  setShowConfirmPassword,
  setShowPassword,
  setTermsAccepted,
  showConfirmPassword,
  showPassword,
  signUp,
  termsAccepted,
}: SignupFormProps) {
  return (
    <form onSubmit={signUp} className="space-y-4">
      <div className="mb-5">
        <h1 className="text-[40px] font-bold leading-none tracking-normal text-white">Criar conta</h1>
        <p className="mt-3 text-[18px] leading-7 text-[#c1d2f1]">Preencha seus dados para começar.</p>
      </div>

      <AuthField
        icon={<User size={27} strokeWidth={1.8} />}
        label="Nome completo"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Seu nome completo"
      />

      <AuthField
        icon={<Mail size={27} strokeWidth={1.8} />}
        label="E-mail"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="seu@email.com"
      />

      <PasswordField
        label="Senha"
        value={password}
        onChange={setPassword}
        placeholder="Crie uma senha"
        show={showPassword}
        setShow={setShowPassword}
      />

      <PasswordField
        label="Confirmar senha"
        value={confirmPassword}
        onChange={setConfirmPassword}
        placeholder="Confirme sua senha"
        show={showConfirmPassword}
        setShow={setShowConfirmPassword}
      />

      <label className="flex items-start gap-3 pt-1 text-[16px] font-medium leading-6 text-white">
        <Checkbox
          checked={termsAccepted}
          onCheckedChange={(value) => setTermsAccepted(value === true)}
          className="mt-0.5 h-[28px] w-[28px] rounded-[7px] border-[#dbe8ff] bg-transparent text-white data-[state=checked]:border-[#0e8cff] data-[state=checked]:bg-[#0e8cff]"
        />
        <span>
          Concordo com os{" "}
          <a href="#" onClick={(event) => event.preventDefault()} className="font-semibold text-[#18a7ff]">
            Termos de Uso
          </a>{" "}
          e a{" "}
          <a href="#" onClick={(event) => event.preventDefault()} className="font-semibold text-[#18a7ff]">
            Política de Privacidade.
          </a>
        </span>
      </label>

      <Button
        type="submit"
        disabled={loading}
        className="mt-2 h-[58px] w-full rounded-[14px] bg-gradient-to-r from-[#00adff] to-[#0067ff] text-[21px] font-bold text-white shadow-[0_20px_55px_rgba(0,105,255,0.32)] hover:from-[#23bcff] hover:to-[#1474ff]"
      >
        {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : "Criar conta"}
        {!loading && <ArrowRight size={28} strokeWidth={1.8} />}
      </Button>

      <div className="pt-3">
        <div className="h-px w-full bg-[#7d98c4]/45" />
        <p className="pt-4 text-center text-[16px] text-white/82">
          Já tem conta?{" "}
          <Link to="/auth" className="font-semibold text-[#18a7ff] hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </form>
  );
}

type ForgotPasswordFormProps = {
  email: string;
  loading: boolean;
  recoverPassword: (event: FormEvent<HTMLFormElement>) => void;
  resetSent: boolean;
  setEmail: (value: string) => void;
};

function ForgotPasswordForm({ email, loading, recoverPassword, resetSent, setEmail }: ForgotPasswordFormProps) {
  return (
    <form onSubmit={recoverPassword} className="space-y-5">
      <div className="mb-6">
        <h1 className="text-[38px] font-bold leading-tight tracking-normal text-white">Recuperar senha</h1>
        <p className="mt-3 text-[19px] leading-7 text-[#c1d2f1]">Informe seu e-mail para receber o link.</p>
      </div>

      <AuthField
        icon={<Mail size={27} strokeWidth={1.8} />}
        label="E-mail"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="seu@email.com"
      />

      {resetSent && (
        <div className="rounded-[12px] border border-[#18a7ff]/45 bg-[#0d65d8]/18 px-4 py-3 text-[14px] leading-5 text-[#d5e5ff]">
          Link enviado. Verifique seu e-mail para criar uma nova senha.
        </div>
      )}

      <Button
        type="submit"
        disabled={loading}
        className="h-[58px] w-full rounded-[14px] bg-gradient-to-r from-[#00adff] to-[#0067ff] text-[20px] font-bold text-white shadow-[0_20px_55px_rgba(0,105,255,0.32)] hover:from-[#23bcff] hover:to-[#1474ff]"
      >
        {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : "Solicitar redefinição"}
        {!loading && <ArrowRight size={27} strokeWidth={1.8} />}
      </Button>

      <div className="pt-4">
        <div className="h-px w-full bg-[#7d98c4]/45" />
        <p className="pt-4 text-center text-[16px] text-white/82">
          Voltar para{" "}
          <Link to="/auth" className="font-semibold text-[#18a7ff] hover:underline">
            entrar
          </Link>
        </p>
      </div>
    </form>
  );
}

type ResetPasswordFormProps = {
  checkingRecovery: boolean;
  confirmPassword: string;
  email: string;
  loading: boolean;
  password: string;
  recoveryReady: boolean;
  setConfirmPassword: (value: string) => void;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setShowConfirmPassword: (value: boolean) => void;
  setShowPassword: (value: boolean) => void;
  showConfirmPassword: boolean;
  showPassword: boolean;
  updatePassword: (event: FormEvent<HTMLFormElement>) => void;
};

function ResetPasswordForm({
  checkingRecovery,
  confirmPassword,
  email,
  loading,
  password,
  recoveryReady,
  setConfirmPassword,
  setEmail,
  setPassword,
  setShowConfirmPassword,
  setShowPassword,
  showConfirmPassword,
  showPassword,
  updatePassword,
}: ResetPasswordFormProps) {
  return (
    <form onSubmit={updatePassword} className="space-y-5">
      <div className="mb-6">
        <h1 className="text-[38px] font-bold leading-tight tracking-normal text-white">Criar nova senha</h1>
        <p className="mt-3 text-[19px] leading-7 text-[#c1d2f1]">Atualize seu acesso.</p>
      </div>

      <AuthField
        icon={<Mail size={27} strokeWidth={1.8} />}
        label="E-mail"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="seu@email.com"
      />

      <PasswordField
        label="Nova senha"
        value={password}
        onChange={setPassword}
        placeholder="Crie uma nova senha"
        show={showPassword}
        setShow={setShowPassword}
        hint="Mínimo de 8 caracteres, com letras e números."
      />

      <PasswordField
        label="Confirmar nova senha"
        value={confirmPassword}
        onChange={setConfirmPassword}
        placeholder="Confirme sua nova senha"
        show={showConfirmPassword}
        setShow={setShowConfirmPassword}
      />

      {checkingRecovery && (
        <div className="flex items-center gap-3 rounded-[12px] border border-white/12 bg-white/[0.04] px-4 py-3 text-[14px] text-[#d5e5ff]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Validando link de redefinição.
        </div>
      )}

      {!checkingRecovery && !recoveryReady && (
        <div className="rounded-[12px] border border-[#ffcf4c]/35 bg-[#ffcf4c]/10 px-4 py-3 text-[14px] leading-5 text-[#ffe8a3]">
          Solicite um link de redefinição antes de criar uma nova senha.
        </div>
      )}

      <Button
        type="submit"
        disabled={loading || checkingRecovery || !recoveryReady}
        className="h-[58px] w-full rounded-[14px] bg-gradient-to-r from-[#00adff] to-[#0067ff] text-[20px] font-bold text-white shadow-[0_20px_55px_rgba(0,105,255,0.32)] hover:from-[#23bcff] hover:to-[#1474ff]"
      >
        {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : "Redefinir senha"}
        {!loading && <ArrowRight size={27} strokeWidth={1.8} />}
      </Button>

      <div className="pt-4">
        <div className="h-px w-full bg-[#7d98c4]/45" />
        <p className="pt-4 text-center text-[16px] text-white/82">
          Voltar para{" "}
          <Link to="/auth" className="font-semibold text-[#18a7ff] hover:underline">
            entrar
          </Link>
        </p>
      </div>
    </form>
  );
}

type SuccessModalProps = {
  onClose: () => void;
};

function SuccessModal({ onClose }: SuccessModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020816]/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-[390px] rounded-[22px] border border-[#2b86ff]/35 bg-[#06132a] p-7 text-center shadow-[0_28px_90px_rgba(0,72,255,0.36)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#0e8cff]/18 text-[#58c7ff]">
          <CheckCircle2 size={32} strokeWidth={1.9} />
        </div>
        <h2 className="mt-5 text-[26px] font-bold text-white">Senha alterada</h2>
        <p className="mt-2 text-[15px] leading-6 text-[#c1d2f1]">Sua senha foi atualizada com sucesso.</p>
        <Button
          type="button"
          onClick={onClose}
          className="mt-7 h-12 w-full rounded-[12px] bg-gradient-to-r from-[#00adff] to-[#0067ff] text-[16px] font-bold text-white hover:from-[#23bcff] hover:to-[#1474ff]"
        >
          Concluir
          <Check size={18} />
        </Button>
      </div>
    </div>
  );
}
