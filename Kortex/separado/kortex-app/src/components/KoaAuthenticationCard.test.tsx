import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KoaAuthenticationCard } from "./KoaAuthenticationCard";

describe("company code and portal password in the chat", () => {
  const props = () => ({ defaultCompanyCode: "0TEST", portal: "ndi" as const, onCancelOperation: vi.fn(), onSubmitAuthentication: vi.fn(async () => undefined as string | undefined) });
  it("keeps the request's company code above the password and out of editable autofill inputs", async () => {
    const p = props(); render(<KoaAuthenticationCard {...p} />);
    const code = screen.getByText("0TEST"), password = screen.getByLabelText("Senha NDI");
    expect(code.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.change(password, { target: { value: "synthetic-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar e continuar" }));
    await waitFor(() => expect(p.onSubmitAuthentication).toHaveBeenCalledWith({ companyCode: "0TEST", password: "synthetic-password", rememberOnDevice: true }));
    await waitFor(() => expect(password).toHaveValue(""));
    expect(screen.getByText("0TEST")).toBeInTheDocument();
  });
  it("allows an explicit code correction without replacing it with a stale response", async () => {
    const p = props(); const { rerender } = render(<KoaAuthenticationCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Alterar código" }));
    fireEvent.change(screen.getByLabelText("Código da empresa"), { target: { value: "0NEW" } });
    rerender(<KoaAuthenticationCard {...p} defaultCompanyCode="0OLD" />);
    expect(screen.getByLabelText("Código da empresa")).toHaveValue("0NEW");
    fireEvent.change(screen.getByLabelText("Senha NDI"), { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar e continuar" }));
    await waitFor(() => expect(p.onSubmitAuthentication).toHaveBeenCalledWith(expect.objectContaining({ companyCode: "0NEW" })));
  });
  it("updates the locked code from the operation and clears a password belonging to the previous portal", () => {
    const p = props(); const { rerender } = render(<KoaAuthenticationCard {...p} />);
    fireEvent.change(screen.getByLabelText("Senha NDI"), { target: { value: "ndi-password" } });
    rerender(<KoaAuthenticationCard {...p} defaultCompanyCode="0NEW" portal="hapvida" />);
    expect(screen.getByText("0NEW")).toBeInTheDocument();
    expect(screen.getByLabelText("Senha Hapvida")).toHaveValue("");
  });
  it("requires a separate company code when the request does not contain one", async () => {
    const p = props(); render(<KoaAuthenticationCard {...p} defaultCompanyCode={undefined} />);
    fireEvent.change(screen.getByLabelText("Senha NDI"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar e continuar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o código da empresa");
    expect(p.onSubmitAuthentication).not.toHaveBeenCalled();
  });
  it("submits once and clears the password on a transport failure", async () => {
    let reject!: (error: Error) => void;
    const p = props(); p.onSubmitAuthentication.mockImplementation(() => new Promise((_, failure) => { reject = failure; }));
    const { container } = render(<KoaAuthenticationCard {...p} />);
    fireEvent.change(screen.getByLabelText("Senha NDI"), { target: { value: "password" } });
    fireEvent.submit(container.querySelector("form")!); fireEvent.submit(container.querySelector("form")!);
    expect(p.onSubmitAuthentication).toHaveBeenCalledOnce(); reject(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não consegui enviar o acesso");
    expect(screen.getByLabelText("Senha NDI")).toHaveValue("");
  });
  it("distinguishes a successful search without a match from the other portal's rejected access", () => {
    const p = props(), review = vi.fn(); render(<KoaAuthenticationCard {...p} notFoundPortals={["hapvida"]} onReviewRequest={review} />);
    expect(screen.getByText(/O acesso funcionou em Hapvida, mas o beneficiário não foi encontrado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revisar nome e período" }));
    expect(review).toHaveBeenCalledOnce(); expect(p.onSubmitAuthentication).not.toHaveBeenCalled();
  });
});
