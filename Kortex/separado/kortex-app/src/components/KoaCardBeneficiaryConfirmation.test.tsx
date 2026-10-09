import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KoaCardBeneficiaryConfirmation } from "./KoaCardBeneficiaryConfirmation";
const confirmation = { id: "choice", beneficiaryName: "BENEFICIARIO DE TESTE", options: [
  { id: "first", beneficiaryName: "BENEFICIARIO DE TESTE", cardNumbers: ["900000000001"], description: "PLANO A" },
  { id: "second", beneficiaryName: "BENEFICIARIO DE TESTE", cardNumbers: ["900000000002"], description: "PLANO B" },
] };
describe("beneficiary card choice in the chat", () => {
  it("shows both records and requires an explicit choice", () => {
    const confirm = vi.fn(); render(<KoaCardBeneficiaryConfirmation confirmation={confirmation} onConfirm={confirm} onCancel={vi.fn()} />);
    expect(screen.getByText("PLANO A")).toBeInTheDocument(); expect(screen.getByText("PLANO B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Emitir carteirinha escolhida" })).toBeDisabled();
    expect(screen.getAllByRole("radio").every(input => !(input as HTMLInputElement).checked)).toBe(true); expect(confirm).not.toHaveBeenCalled();
  });
  it("sends only the chosen record and blocks duplicate submissions", async () => {
    let finish!: (value: string | undefined) => void;
    const confirm = vi.fn(() => new Promise<string | undefined>(resolve => { finish = resolve; }));
    render(<KoaCardBeneficiaryConfirmation confirmation={confirmation} onConfirm={confirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Emitir carteirinha escolhida" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuando..." }));
    expect(confirm).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledWith("choice", "second");
    finish("Falha temporária."); await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Emitir carteirinha escolhida" })).toBeEnabled());
  });
  it("cancels without choosing a beneficiary", () => {
    const confirm = vi.fn(), cancel = vi.fn(); render(<KoaCardBeneficiaryConfirmation confirmation={confirmation} onConfirm={confirm} onCancel={cancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
  });
});
