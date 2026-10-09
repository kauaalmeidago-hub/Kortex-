import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KoaCardDependentConfirmation } from "./KoaCardDependentConfirmation";

const confirmation = { id: "choice-1", beneficiaryName: "TITULAR DE TESTE", dependentNames: ["PRIMEIRO DEPENDENTE", "SEGUNDO DEPENDENTE"] };

describe("dependent card choice in the chat", () => {
  it("shows the beneficiary and every dependent before any emission is authorized", () => {
    const confirm = vi.fn();
    render(<KoaCardDependentConfirmation confirmation={confirmation} onConfirm={confirm} onCancel={vi.fn()} />);
    expect(screen.getByText(/Encontrei dependentes de TITULAR DE TESTE/)).toBeInTheDocument();
    for (const name of confirmation.dependentNames) expect(screen.getByText(name)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });
  it.each([true, false])("sends the explicit choice includeDependents=%s", async include => {
    const confirm = vi.fn(async () => undefined);
    render(<KoaCardDependentConfirmation confirmation={confirmation} onConfirm={confirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: include ? "Com dependentes" : "Sem dependentes" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith("choice-1", include));
  });
  it("blocks a second choice while the first response is pending and permits retry after a failure", async () => {
    let finish!: (value: string | undefined) => void;
    const confirm = vi.fn(() => new Promise<string | undefined>(resolve => { finish = resolve; }));
    render(<KoaCardDependentConfirmation confirmation={confirmation} onConfirm={confirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Com dependentes" }));
    fireEvent.click(screen.getByRole("button", { name: "Sem dependentes" }));
    expect(confirm).toHaveBeenCalledOnce();
    finish("Falha temporária ao registrar a escolha.");
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Sem dependentes" }));
    expect(confirm).toHaveBeenLastCalledWith("choice-1", false);
  });
  it("cancels without authorizing any card", () => {
    const confirm = vi.fn(), cancel = vi.fn();
    render(<KoaCardDependentConfirmation confirmation={confirmation} onConfirm={confirm} onCancel={cancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
  });
});
