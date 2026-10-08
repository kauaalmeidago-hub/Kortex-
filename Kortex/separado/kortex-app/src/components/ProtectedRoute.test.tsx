import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";

const auth = vi.hoisted(() => ({ loading: false, user: null as { id: string } | null, session: null as { access_token?: string } | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

function renderInbox() {
  return render(<MemoryRouter initialEntries={["/inbox?conversation=test#pedido"]}>
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/inbox" element={<div>Inbox autorizado</div>} />
      </Route>
    </Routes>
  </MemoryRouter>);
}

describe("Inbox login protection", () => {
  beforeEach(() => { auth.loading = false; auth.user = null; auth.session = null; });
  afterEach(cleanup);

  it("opens the Inbox directly without requiring Kortex login", () => {
    renderInbox();
    expect(screen.getByText("Inbox autorizado")).toBeInTheDocument();
  });

  it("keeps an authenticated user in the Inbox", () => {
    auth.user = { id: "user-test" }; auth.session = { access_token: "user-jwt" };
    renderInbox();
    expect(screen.getByText("Inbox autorizado")).toBeInTheDocument();
  });

  it("waits for saved session recovery before deciding where to navigate", () => {
    auth.loading = true;
    renderInbox();
    expect(screen.getByText("Inbox autorizado")).toBeInTheDocument();
  });

  it("keeps the user in the Inbox if the session was cleared", () => {
    auth.user = { id: "user-test" };
    renderInbox();
    expect(screen.getByText("Inbox autorizado")).toBeInTheDocument();
  });
});
