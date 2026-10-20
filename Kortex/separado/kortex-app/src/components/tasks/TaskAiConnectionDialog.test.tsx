import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  connectTaskAi: vi.fn(),
  disconnectTaskAi: vi.fn(),
}));
vi.mock("@/features/tasks/ai", () => api);
import TaskAiConnectionDialog from "./TaskAiConnectionDialog";
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it("masks the key, validates once while pending and clears it after a successful connection", async () => {
  let resolve!: (v: unknown) => void;
  api.connectTaskAi.mockReturnValue(new Promise((r) => (resolve = r)));
  const saved = vi.fn().mockResolvedValue(undefined);
  render(
    <TaskAiConnectionDialog
      workspace="organization"
      onClose={vi.fn()}
      onSaved={saved}
    />,
  );
  const key = screen.getByLabelText("Chave de API OpenAI");
  expect(key).toHaveAttribute("type", "password");
  fireEvent.change(key, {
    target: { value: "sk-test-not-a-real-secret-12345" },
  });
  const button = screen.getByRole("button", { name: "Conectar OpenAI" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(api.connectTaskAi).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  expect(document.body.textContent).not.toContain("sk-test-not-a-real-secret");
  resolve({
    configured: true,
    model: "gpt-4.1-mini",
    updated_at: "2026-10-16",
  });
  await screen.findByText(/OpenAI conectada/);
  expect(key).toHaveValue("");
  expect(saved).toHaveBeenCalledTimes(1);
});
it("reports a failed validation without claiming the provider is connected", async () => {
  api.connectTaskAi.mockRejectedValue(
    new Error("A OpenAI não aceitou a chave informada."),
  );
  render(
    <TaskAiConnectionDialog
      workspace="organization"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Chave de API OpenAI"), {
    target: { value: "sk-test-not-a-real-secret-12345" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Conectar OpenAI" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/não aceitou/);
  expect(screen.getByText("Nenhuma chave configurada.")).toBeInTheDocument();
});
it("disconnects only the configured account and keeps the secret out of the UI", async () => {
  api.disconnectTaskAi.mockResolvedValue({
    configured: false,
    model: null,
    updated_at: null,
  });
  render(
    <TaskAiConnectionDialog
      workspace="organization"
      connection={{ configured: true, model: "gpt-4.1-mini", updated_at: null }}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
  await waitFor(() =>
    expect(api.disconnectTaskAi).toHaveBeenCalledWith("organization"),
  );
  await screen.findByText("Nenhuma chave configurada.");
});
