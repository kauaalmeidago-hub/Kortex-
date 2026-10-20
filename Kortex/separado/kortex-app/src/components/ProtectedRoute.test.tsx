import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const gate = vi.hoisted(() => ({ required: false, error: false }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: () => ({ abortSignal: async () => ({ data: gate.required, error: gate.error ? new Error('unavailable') : null }) }) } }));

const auth = vi.hoisted(() => ({ loading: false, user: null as { id: string } | null, session: null as { access_token?: string } | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

function renderInbox() {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={["/inbox?conversation=test#pedido"]}>
    <Routes>
      <Route path="/auth/login" element={<div>Login</div>} /><Route path="/auth/whatsapp" element={<div>Pareamento pendente</div>} />
      <Route element={<ProtectedRoute />}>
        <Route path="/inbox" element={<div>Inbox autorizado</div>} />
      </Route>
    </Routes>
  </MemoryRouter></QueryClientProvider>);
}

describe("Inbox login protection", () => {
  it('cannot skip a pending new-account pairing by manually entering a protected route', async () => {
    auth.user={id:'new'}; auth.loading=false; gate.required=true;
    renderInbox();
    expect(await screen.findByText('Pareamento pendente')).toBeInTheDocument();
    expect(screen.queryByText('Inbox autorizado')).not.toBeInTheDocument();
  });
  it('keeps the portal closed when onboarding recovery cannot be validated', async () => {
    auth.user={id:'new'}; auth.loading=false; gate.error=true;
    renderInbox();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível recuperar');
    expect(screen.queryByText('Inbox autorizado')).not.toBeInTheDocument();
  });
  beforeEach(() => { auth.loading = false; auth.user = null; auth.session = null; gate.required=false; gate.error=false; });
  afterEach(cleanup);

  it("redirects an unauthenticated Inbox visit to login", () => {
    renderInbox();
    expect(screen.getByText("Login")).toBeInTheDocument();
  });

  it("keeps an authenticated user in the Inbox", async () => {
    auth.user = { id: "user-test" }; auth.session = { access_token: "user-jwt" };
    renderInbox();
    expect(await screen.findByText("Inbox autorizado")).toBeInTheDocument();
  });

  it("waits for saved session recovery before deciding where to navigate", () => {
    auth.loading = true;
    renderInbox();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Inbox autorizado")).not.toBeInTheDocument();
  });

  it("keeps the user in the Inbox if the session was cleared", async () => {
    auth.user = { id: "user-test" };
    renderInbox();
    expect(await screen.findByText("Inbox autorizado")).toBeInTheDocument();
  });
});
