import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, User } from "@supabase/supabase-js";
const controls = vi.hoisted(() => ({ user: null as User | null }));
const api = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: controls.user, loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: api } }));
vi.mock("@/features/auth/service", async (original) => ({
  ...(await original<typeof import("@/features/auth/service")>()),
  loadAuthSettings: vi.fn(),
  loadAuthProfile: vi.fn(),
  completeAuthProfile: vi.fn(),
  startGoogleAuth: vi.fn(),
  restoreAuthReturn: vi.fn(),
}));
vi.mock("@/features/auth/recovery", () => ({
  restoreRecoverySession: vi.fn(),
  saveRecoveredPassword: vi.fn(),
  finishRecovery: vi.fn(),
  RecoveryError: class extends Error {
    constructor(public reason: string) {
      super(reason);
    }
  },
}));
import * as recovery from "@/features/auth/recovery";
import * as service from "@/features/auth/service";
import AuthPage from "./AuthPage";
import { waRequest } from '@/features/whatsapp/api';
vi.mock('@/features/whatsapp/api', () => ({ waRequest: vi.fn(), WaError: class extends Error {} }));
const user: User = {
  id: "user-auth-qa",
  aud: "authenticated",
  created_at: "2026-10-15T12:00:00Z",
  user_metadata: { full_name: "Nome Legado Sobrenome" },
  app_metadata: { provider: "google" },
};
const session = {
  user,
  access_token: "test-only",
  refresh_token: "test-only",
} as Session;
const profile = {
  id: user.id,
  full_name: "Nome Legado Sobrenome",
  avatar_url: null,
  sector: "comercial" as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(waRequest).mockResolvedValue({ created: true, confirmationPending: true });
  controls.user = null;
  localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.mocked(service.loadAuthSettings).mockResolvedValue({
    google: true,
    signupEnabled: true,
    minPasswordLength: 6,
    verified: true,
  });
  vi.mocked(service.loadAuthProfile).mockResolvedValue(profile);
  vi.mocked(service.completeAuthProfile).mockResolvedValue(profile);
  vi.mocked(service.restoreAuthReturn).mockResolvedValue(session);
  vi.mocked(service.startGoogleAuth).mockResolvedValue(undefined);
  api.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
  api.signUp.mockResolvedValue({ data: { session: null, user }, error: null });
  api.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  vi.mocked(recovery.restoreRecoverySession).mockResolvedValue(session);
  vi.mocked(recovery.saveRecoveredPassword).mockResolvedValue(undefined);
  vi.mocked(recovery.finishRecovery).mockResolvedValue(undefined);
  api.updateUser.mockResolvedValue({ data: { user }, error: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup(path = "/auth/login") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/auth/whatsapp" element={<div>Pareamento de WhatsApp</div>} />
        <Route
          path="/auth/*"
          element={
            <StrictMode>
              <AuthPage />
            </StrictMode>
          }
        />
        <Route path="*" element={<h1>Destino permitido</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}
function fillEmail() {
  fireEvent.change(screen.getByLabelText("E-mail"), {
    target: { value: "pessoa@example.invalid" },
  });
}
function fillPasswords() {
  fireEvent.change(screen.getByLabelText("Senha", { exact: true }), {
    target: { value: "SenhaTeste!23" },
  });
  fireEvent.change(screen.getByLabelText("Confirmar senha", { exact: true }), {
    target: { value: "SenhaTeste!23" },
  });
}
async function chooseSector(label: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Setor" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("option", { name: label }));
}
describe("real authentication forms", () => {
  it("keeps invalid credentials contextual without clearing the email or navigating", async () => {
    api.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { code: "invalid_credentials" },
    });
    setup();
    fillEmail();
    fireEvent.change(screen.getByLabelText("Senha", { exact: true }), {
      target: { value: "incorreta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "E-mail ou senha incorretos",
    );
    expect(screen.getByLabelText("E-mail")).toHaveValue(
      "pessoa@example.invalid",
    );
    expect(screen.queryByText("Destino permitido")).not.toBeInTheDocument();
  });
  it("submits once, restores the requested destination and remembers only email", async () => {
    let finish!: (value: unknown) => void;
    api.signInWithPassword.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    setup("/auth/login?next=%2Fadmin%2Ftasks%3Fconversation%3D000A");
    fillEmail();
    fireEvent.change(screen.getByLabelText("Senha", { exact: true }), {
      target: { value: "SenhaTeste!23" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Lembrar de mim" }));
    const button = screen.getByRole("button", { name: "Entrar" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.signInWithPassword).toHaveBeenCalledTimes(1);
    finish({ data: { session }, error: null });
    expect(await screen.findByText("Destino permitido")).toBeInTheDocument();
    expect(localStorage.getItem("kortex-auth-email")).toBe(
      "pessoa@example.invalid",
    );
    expect(JSON.stringify(localStorage)).not.toContain("SenhaTeste");
  });
  it.each([
    ["Financeiro", "financeiro"],
    ["Relacionamento", "relacionamento"],
    ["Comercial", "comercial"],
  ])(
    "submits %s to the secure backend and opens pairing before email confirmation",
    async (label, value) => {
      setup("/auth/signup");
      fillEmail();
      fillPasswords();
      fireEvent.change(screen.getByLabelText("Nome", { exact: true }), {
        target: { value: "Nome Completo Teste" },
      });
      await chooseSector(label);
      fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
      expect(
        await screen.findByText("Pareamento de WhatsApp"),
      ).toBeInTheDocument();
      expect(waRequest).toHaveBeenCalledWith('signup', { body: { email: 'pessoa@example.invalid', password: 'SenhaTeste!23', name: 'Nome Completo Teste', sector: value } });
      expect(api.signUp).not.toHaveBeenCalled();
      expect(screen.queryByText("Destino permitido")).not.toBeInTheDocument();
      expect(service.completeAuthProfile).not.toHaveBeenCalled();
    },
  );
  it("rejects missing sector and mismatching passwords before signup", () => {
    setup("/auth/signup");
    fillEmail();
    fillPasswords();
    fireEvent.change(screen.getByLabelText("Nome", { exact: true }), {
      target: { value: "Nome Teste" },
    });
    fireEvent.change(
      screen.getByLabelText("Confirmar senha", { exact: true }),
      { target: { value: "OutraSenha" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(screen.getByText("Selecione seu setor.")).toBeInTheDocument();
    expect(
      screen.getByText("As senhas precisam ser iguais."),
    ).toBeInTheDocument();
    expect(api.signUp).not.toHaveBeenCalled();
  });
  it("toggles the two passwords independently without submitting", () => {
    setup("/auth/signup");
    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(screen.getByLabelText("Senha", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
    expect(
      screen.getByLabelText("Confirmar senha", { exact: true }),
    ).toHaveAttribute("type", "password");
    expect(api.signUp).not.toHaveBeenCalled();
  });
  it.each(["login", "signup"])("temporarily hides Google on %s even when the provider is configured", async (mode) => {
    setup(`/auth/${mode}?next=%2Ftasks`);
    await waitFor(() => expect(service.loadAuthSettings).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Continuar com Google" })).not.toBeInTheDocument();
    expect(screen.queryByText("ou", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/Acesso com Google/)).not.toBeInTheDocument();
    expect(service.startGoogleAuth).not.toHaveBeenCalled();
    expect(api.signUp).not.toHaveBeenCalled();
  });
  it("recovers a missing profile sector on the same Google account after a failed save", async () => {
    controls.user = user;
    vi.mocked(service.loadAuthProfile).mockResolvedValue({
      ...profile,
      sector: null,
    });
    vi.mocked(service.completeAuthProfile)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(profile);
    setup("/auth/callback");
    expect(
      await screen.findByRole("heading", { name: "Qual é seu setor?" }),
    ).toBeInTheDocument();
    await chooseSector("Comercial");
    fireEvent.click(screen.getByRole("button", { name: "Salvar e continuar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Seus dados foram preservados",
    );
    expect(screen.getByRole("combobox", { name: "Setor" })).toHaveTextContent(
      "Comercial",
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar e continuar" }));
    expect(await screen.findByText("Destino permitido")).toBeInTheDocument();
    expect(service.completeAuthProfile).toHaveBeenLastCalledWith(
      "comercial",
      "Nome Legado Sobrenome",
    );
    expect(api.signUp).not.toHaveBeenCalled();
  });
  it("preserves an existing Google profile without asking for sector again", async () => {
    controls.user = user;
    setup("/auth/callback");
    expect(await screen.findByText("Destino permitido")).toBeInTheDocument();
    expect(service.completeAuthProfile).not.toHaveBeenCalled();
  });
  it("reports a real recovery request without exposing account existence", async () => {
    setup("/auth/forgot-password?next=%2Ftasks");
    fillEmail();
    fireEvent.click(
      screen.getByRole("button", { name: "Enviar link de recuperação" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se houver uma conta",
    );
    expect(api.resetPasswordForEmail).toHaveBeenCalledWith(
      "pessoa@example.invalid",
      {
        redirectTo: expect.stringContaining(
          "/auth/reset-password?next=%2Ftasks",
        ),
      },
    );
  });
  it("validates recovery before updating the password and waits for real success", async () => {
    setup("/auth/reset-password?code=controlled");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Salvar nova senha" }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Nova senha", { exact: true }), {
      target: { value: "NovaSenhaTeste!45" },
    });
    fireEvent.change(
      screen.getByLabelText("Confirmar nova senha", { exact: true }),
      { target: { value: "NovaSenhaTeste!45" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(
      await screen.findByText(
        "Senha redefinida com sucesso. Faça login com sua nova senha.",
      ),
    ).toBeInTheDocument();
    expect(recovery.saveRecoveredPassword).toHaveBeenCalledWith(
      "NovaSenhaTeste!45",
      user.id,
    );
    expect(recovery.finishRecovery).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Destino permitido")).not.toBeInTheDocument();
    fillEmail();
    fireEvent.change(screen.getByLabelText("Senha", { exact: true }), {
      target: { value: "NovaSenhaTeste!45" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Entrar" }),
    );
    expect(await screen.findByText("Destino permitido")).toBeVisible();
  });
  it("keeps the existing account recoverable when profile loading fails", async () => {
    controls.user = user;
    vi.mocked(service.loadAuthProfile).mockRejectedValue({ code: "42703" });
    setup("/auth/callback");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sua conta foi preservada",
    );
    vi.mocked(service.loadAuthProfile).mockResolvedValue(profile);
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Destino permitido")).toBeInTheDocument();
    expect(api.signUp).not.toHaveBeenCalled();
  });
  it("blocks a reset link rejected by the provider despite another account being logged in", async () => {
    controls.user = user;
    vi.mocked(recovery.restoreRecoverySession).mockRejectedValue(
      new recovery.RecoveryError("invalid"),
    );
    setup("/auth/reset-password");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este link é inválido ou expirou",
    );
    expect(
      screen.getByRole("button", { name: "Salvar nova senha" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Solicitar novo link" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Voltar para o login" }),
    ).toBeVisible();
    expect(recovery.saveRecoveredPassword).not.toHaveBeenCalled();
    expect(screen.queryByText("Destino permitido")).not.toBeInTheDocument();
  });
  it("does not announce an email that the service refused and prevents duplicate requests", async () => {
    let finish!: (value: unknown) => void;
    api.resetPasswordForEmail.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    setup("/auth/forgot-password");
    fillEmail();
    const button = screen.getByRole("button", {
      name: "Enviar link de recuperação",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    finish({ error: { status: 429 } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Muitas tentativas",
    );
    expect(screen.queryByText(/Se houver uma conta/)).not.toBeInTheDocument();
  });
  it("validates eight characters, exact confirmation and independent visibility without updating", async () => {
    setup("/auth/reset-password");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Salvar nova senha" }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Nova senha", { exact: true }), {
      target: { value: "1234567" },
    });
    fireEvent.change(
      screen.getByLabelText("Confirmar nova senha", { exact: true }),
      { target: { value: "different" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Mostrar nova senha" }));
    expect(
      screen.getByLabelText("Nova senha", { exact: true }),
    ).toHaveAttribute("type", "text");
    expect(
      screen.getByLabelText("Confirmar nova senha", { exact: true }),
    ).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(screen.getAllByText("Use pelo menos 8 caracteres.")).toHaveLength(2);
    expect(screen.getByText("As senhas precisam ser iguais.")).toBeVisible();
    expect(recovery.saveRecoveredPassword).not.toHaveBeenCalled();
  });
  it("consumes a reset callback once in StrictMode and treats logout retry separately", async () => {
    vi.mocked(recovery.finishRecovery).mockRejectedValueOnce(
      new Error("network"),
    );
    setup("/auth/reset-password?code=one-use");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Salvar nova senha" }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Nova senha", { exact: true }), {
      target: { value: "Controlled!password8" },
    });
    fireEvent.change(
      screen.getByLabelText("Confirmar nova senha", { exact: true }),
      { target: { value: "Controlled!password8" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sua senha foi alterada",
    );
    expect(
      screen.queryByLabelText("Nova senha", { exact: true }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Voltar para o login" }),
    );
    expect(
      await screen.findByText(
        "Senha redefinida com sucesso. Faça login com sua nova senha.",
      ),
    ).toBeVisible();
    expect(recovery.saveRecoveredPassword).toHaveBeenCalledTimes(1);
    expect(recovery.restoreRecoverySession).toHaveBeenCalledTimes(1);
    expect(recovery.finishRecovery).toHaveBeenCalledTimes(2);
  });
});
