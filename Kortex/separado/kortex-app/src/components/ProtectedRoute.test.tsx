import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";

const auth = vi.hoisted(() => ({ loading: false, user: null as { id: string } | null, session: null as { access_token?: string } | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

function LoginDestination() {
  const { state } = useLocation();
  const from = state?.from;
  return <div>Login Kortex: {from && `${from.pathname}${from.search}${from.hash}`}</div>;
}

function renderInbox() {
  return render(<MemoryRouter initialEntries={["/inbox?conversation=test#pedido"]}>
    <Routes>
      <Route path="/auth" element={<LoginDestination />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/inbox" element={<div>Inbox autorizado</div>} />
      </Route>
    </Routes>
  </MemoryRouter>);
}

describe("Inbox login protection", () => {
  beforeEach(() => { auth.loading = false; auth.user = null; auth.session = null; });
  afterEach(cleanup);

  it("requires Kortex login before showing the Inbox and preserves the destination", () => {
    renderInbox();
    expect(screen.getByText("Login Kortex: /inbox?conversation=test#pedido")).toBeInTheDocument();
    expect(screen.queryByText("Inbox autorizado")).not.toBeInTheDocument();
  });

  it("keeps an authenticated user in the Inbox", () => {
    auth.user = { id: "user-test" }; auth.session = { access_token: "user-jwt" };
    renderInbox();
    expect(screen.getByText("Inbox autorizado")).toBeInTheDocument();
  });

  it("waits for saved session recovery before deciding where to navigate", () => {
    auth.loading = true;
    renderInbox();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByText(/Login Kortex/)).not.toBeInTheDocument();
  });

  it("requires login again if the user exists but the session was cleared", () => {
    auth.user = { id: "user-test" };
    renderInbox();
    expect(screen.getByText(/Login Kortex/)).toBeInTheDocument();
  });
});
