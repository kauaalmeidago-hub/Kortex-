import { FormEvent, useMemo, useState } from "react";
import {
  Bell,
  Camera,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Globe2,
  Lock,
  Moon,
  User,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/integrations/supabase/client";
import SettingsLayout from "@/components/SettingsLayout";

type ProfileForm = {
  fullName: string;
  email: string;
  role: string;
  phone: string;
};

function getDisplayName(email?: string | null, metadataName?: string) {
  if (metadataName) return metadataName;
  if (!email) return "Usuário Kortex";
  const [name] = email.split("@");
  return name
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Usuário Kortex";
}

function initials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "UK"
  );
}

function ProfileInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-12 w-full rounded-xl border border-[#d5e1f0] bg-white px-4 text-base text-[#071451] outline-none transition",
        "placeholder:text-[#7a8aaa] focus:border-[#0d6efd] focus:ring-4 focus:ring-[#0d6efd]/10 disabled:bg-[#f3f6fb] disabled:text-[#7a8aaa]",
        props.className,
      ].filter(Boolean).join(" ")}
    />
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2 text-sm font-bold text-[#071451]">
      <span>{label}</span>
      {children}
    </label>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <Field label={label}>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7488b2]" />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          className="h-12 w-full rounded-xl border border-[#d5e1f0] bg-white pl-12 pr-12 text-base text-[#071451] outline-none transition placeholder:text-[#7a8aaa] focus:border-[#0d6efd] focus:ring-4 focus:ring-[#0d6efd]/10"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7488b2] transition hover:text-[#0d6efd]"
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        >
          {visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
    </Field>
  );
}

function PreferenceSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 min-w-[132px] appearance-none rounded-xl border border-[#d5e1f0] bg-white px-4 pr-10 text-sm font-semibold text-[#071451] outline-none transition focus:border-[#0d6efd] focus:ring-4 focus:ring-[#0d6efd]/10"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7488b2]" />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={checked}
      onClick={onChange}
      className={`relative h-8 w-14 rounded-full transition ${checked ? "bg-[#0d6efd]" : "bg-[#c7d3e3]"}`}
    >
      <span
        className={`absolute top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md transition ${
          checked ? "left-7" : "left-1"
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { mode, toggleMode } = useTheme();
  const metadata = user?.user_metadata as { full_name?: string; name?: string; phone?: string; role?: string } | undefined;
  const initialProfile = useMemo<ProfileForm>(() => {
    const fullName = getDisplayName(user?.email, metadata?.full_name || metadata?.name);
    return {
      fullName,
      email: user?.email || "usuario@kortex.com",
      role: metadata?.role || "Analista de Relacionamento",
      phone: metadata?.phone || "(11) 91234-5678",
    };
  }, [metadata?.full_name, metadata?.name, metadata?.phone, metadata?.role, user?.email]);

  const [profile, setProfile] = useState<ProfileForm>(initialProfile);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [language, setLanguage] = useState("Português");
  const [editingPassword, setEditingPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [passwords, setPasswords] = useState({
    current: "",
    next: "",
    confirm: "",
  });

  const currentThemeLabel = mode === "dark" ? "Escuro" : "Claro";

  const handleThemeChange = (value: string) => {
    if ((value === "Escuro" && mode === "light") || (value === "Claro" && mode === "dark")) {
      toggleMode();
    }
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");

    if (passwords.next.length < 8) {
      setPasswordError("Use pelo menos 8 caracteres para a nova senha.");
      return;
    }

    if (passwords.next !== passwords.confirm) {
      setPasswordError("A confirmação precisa ser igual à nova senha.");
      return;
    }

    setSavingPassword(true);
    try {
      if (user) {
        const { error } = await supabase.auth.updateUser({ password: passwords.next });
        if (error) throw error;
      }
      setShowSuccess(true);
      setPasswords({ current: "", next: "", confirm: "" });
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Não foi possível alterar a senha agora.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <SettingsLayout>
    <div className="h-full overflow-auto bg-background px-4 py-4 text-foreground scrollbar-thin sm:px-5 sm:py-5">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7">
          <h1 className="text-3xl font-black tracking-tight">Meu perfil</h1>
          <p className="mt-2 text-base text-[#5d6f91]">Gerencie suas informações pessoais e preferências da conta.</p>
        </header>

        <section className="rounded-2xl border border-[#d5e1f0] bg-white p-7 shadow-sm">
          <div className="mb-7">
            <h2 className="text-xl font-black">Informações da conta</h2>
            <p className="mt-1 text-sm text-[#5d6f91]">Seus dados pessoais são usados para identificação na plataforma.</p>
          </div>

          <div className="grid gap-8 lg:grid-cols-[180px_1fr] lg:items-center">
            <div className="flex justify-center lg:justify-start">
              <div className="relative">
                <div className="flex h-36 w-36 items-center justify-center rounded-full bg-[#e8f2ff] text-4xl font-medium text-[#0d6efd]">
                  {initials(profile.fullName)}
                </div>
                <button
                  type="button"
                  className="absolute bottom-3 right-1 flex h-11 w-11 items-center justify-center rounded-full border-4 border-white bg-[#0d6efd] text-white shadow-md transition hover:bg-[#095edb]"
                  aria-label="Alterar avatar"
                >
                  <Camera className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Nome completo">
                <ProfileInput
                  value={profile.fullName}
                  onChange={(event) => setProfile({ ...profile, fullName: event.target.value })}
                />
              </Field>
              <Field label="E-mail">
                <ProfileInput value={profile.email} disabled />
              </Field>
              <Field label="Cargo / Função">
                <ProfileInput
                  value={profile.role}
                  onChange={(event) => setProfile({ ...profile, role: event.target.value })}
                />
              </Field>
              <Field label="Telefone">
                <ProfileInput
                  value={profile.phone}
                  onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
                />
              </Field>
            </div>
          </div>
        </section>

        {!editingPassword ? (
          <section className="mt-6 rounded-2xl border border-[#d5e1f0] bg-white p-7 shadow-sm">
            <div className="mb-6">
              <h2 className="text-xl font-black">Segurança</h2>
              <p className="mt-1 text-sm text-[#5d6f91]">Mantenha sua conta protegida com uma senha segura.</p>
            </div>
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f2ff] text-[#0d6efd]">
                  <Lock className="h-7 w-7" />
                </div>
                <div>
                  <p className="font-black">Senha</p>
                  <p className="mt-1 text-sm text-[#5d6f91]">Altere sua senha periodicamente para manter sua conta segura.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingPassword(true)}
                className="h-12 rounded-xl border border-[#0d6efd] px-7 text-sm font-bold text-[#0d6efd] transition hover:bg-[#eaf3ff]"
              >
                Alterar senha
              </button>
            </div>
          </section>
        ) : (
          <section className="mt-6 rounded-2xl border border-[#d5e1f0] bg-white p-7 shadow-sm">
            <div className="mb-6 flex items-start gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#e8f2ff] text-[#0d6efd]">
                <Lock className="h-8 w-8" />
              </div>
              <div>
                <h2 className="text-2xl font-black">Alterar senha</h2>
                <p className="mt-2 text-sm text-[#5d6f91]">Mantenha sua conta protegida com uma senha segura.</p>
              </div>
            </div>

            <form onSubmit={handlePasswordSubmit} className="space-y-5">
              <PasswordField
                label="Senha atual"
                value={passwords.current}
                onChange={(value) => setPasswords({ ...passwords, current: value })}
                placeholder="Digite sua senha atual"
              />
              <PasswordField
                label="Nova senha"
                value={passwords.next}
                onChange={(value) => setPasswords({ ...passwords, next: value })}
                placeholder="Digite sua nova senha"
              />
              <p className="-mt-3 text-sm text-[#7082a9]">Use pelo menos 8 caracteres, incluindo letras e números.</p>
              <PasswordField
                label="Confirmar nova senha"
                value={passwords.confirm}
                onChange={(value) => setPasswords({ ...passwords, confirm: value })}
                placeholder="Digite novamente sua nova senha"
              />

              {passwordError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {passwordError}
                </div>
              )}

              <div className="flex flex-wrap gap-4 pt-2">
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="h-12 rounded-xl bg-[#0d6efd] px-9 text-sm font-bold text-white shadow-[0_14px_34px_rgba(13,110,253,0.22)] transition hover:bg-[#095edb] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingPassword ? "Salvando..." : "Salvar nova senha"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPassword(false);
                    setPasswordError("");
                    setPasswords({ current: "", next: "", confirm: "" });
                  }}
                  className="h-12 rounded-xl border border-[#d5e1f0] px-9 text-sm font-bold text-[#5d6f91] transition hover:border-[#0d6efd] hover:text-[#0d6efd]"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-[#d5e1f0] bg-white p-7 shadow-sm">
          <div className="mb-6">
            <h2 className="text-xl font-black">Preferências</h2>
            <p className="mt-1 text-sm text-[#5d6f91]">Personalize sua experiência na plataforma.</p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="flex items-center justify-between gap-5 lg:border-r lg:border-[#d5e1f0] lg:pr-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f2ff] text-[#0d6efd]">
                  <Bell className="h-7 w-7" />
                </div>
                <div>
                  <p className="font-black">Notificações</p>
                  <p className="mt-1 text-sm text-[#5d6f91]">Receba alertas sobre novas mensagens e atividades.</p>
                </div>
              </div>
              <Toggle
                checked={notificationsEnabled}
                onChange={() => setNotificationsEnabled((current) => !current)}
                ariaLabel="Ativar ou desativar notificações"
              />
            </div>

            <div className="flex items-center justify-between gap-5 lg:border-r lg:border-[#d5e1f0] lg:pr-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f2ff] text-[#0d6efd]">
                  <Moon className="h-7 w-7" />
                </div>
                <div>
                  <p className="font-black">Tema</p>
                  <p className="mt-1 text-sm text-[#5d6f91]">Escolha entre o tema claro ou escuro.</p>
                </div>
              </div>
              <PreferenceSelect value={currentThemeLabel} onChange={handleThemeChange}>
                <option>Claro</option>
                <option>Escuro</option>
              </PreferenceSelect>
            </div>

            <div className="flex items-center justify-between gap-5">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f2ff] text-[#0d6efd]">
                  <Globe2 className="h-7 w-7" />
                </div>
                <div>
                  <p className="font-black">Idioma</p>
                  <p className="mt-1 text-sm text-[#5d6f91]">Selecione o idioma da plataforma.</p>
                </div>
              </div>
              <PreferenceSelect value={language} onChange={setLanguage}>
                <option>Português</option>
                <option>English</option>
                <option>Español</option>
              </PreferenceSelect>
            </div>
          </div>
        </section>
      </div>

      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#06112a]/35 px-6 backdrop-blur-sm">
          <div className="relative w-full max-w-[440px] rounded-2xl bg-white px-10 py-9 text-center shadow-[0_28px_90px_rgba(7,20,81,0.2)]">
            <button
              type="button"
              onClick={() => setShowSuccess(false)}
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl text-[#7082a9] transition hover:bg-[#eef4fb] hover:text-[#071451]"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-50 text-green-600">
              <Check className="h-10 w-10" />
            </div>
            <h2 className="mt-7 text-2xl font-black text-[#071451]">Senha alterada</h2>
            <p className="mt-3 text-base text-[#5d6f91]">Sua senha foi atualizada com sucesso.</p>
            <button
              type="button"
              onClick={() => {
                setShowSuccess(false);
                setEditingPassword(false);
              }}
              className="mt-8 h-12 w-full rounded-xl bg-[#0d6efd] text-sm font-bold text-white shadow-[0_14px_34px_rgba(13,110,253,0.22)] transition hover:bg-[#095edb]"
            >
              Concluir
            </button>
          </div>
        </div>
      )}
    </div>
    </SettingsLayout>
  );
}
