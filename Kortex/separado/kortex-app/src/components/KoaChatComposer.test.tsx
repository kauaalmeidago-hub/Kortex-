import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KoaChatComposer from "./KoaChatComposer";

afterEach(cleanup);

describe("shared KOA composer", () => {
  it("supports multiline text, Shift+Enter and composition without accidental sending", () => {
    const submit = vi.fn();
    const attach = vi.fn();
    render(
      <KoaChatComposer
        multiline
        value="Mensagem"
        onChange={() => {}}
        onSubmit={submit}
        onAttach={attach}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Mensagem para o KOA" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Anexar arquivo" }));
    expect(attach).toHaveBeenCalledTimes(1);
  });
  it("disables blank multiline submissions and attachment actions without integration", () => {
    const submit = vi.fn();
    render(
      <KoaChatComposer
        multiline
        value="  "
        onChange={() => {}}
        onSubmit={submit}
      />,
    );
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Anexar arquivo" }),
    ).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
  });
  it("submits by click and Enter, and reports changes to its owner", () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    render(
      <KoaChatComposer
        value="Mensagem"
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Digite uma mensagem..."), {
      target: { value: "Novo texto" },
    });
    expect(onChange).toHaveBeenCalledWith("Novo texto");
    fireEvent.keyDown(screen.getByPlaceholderText("Digite uma mensagem..."), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
  it("does not submit by Enter while disabled or composing text", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <KoaChatComposer
        value="Mensagem"
        onChange={() => {}}
        onSubmit={onSubmit}
        disabled
      />,
    );
    fireEvent.keyDown(screen.getByPlaceholderText("Digite uma mensagem..."), {
      key: "Enter",
    });
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    rerender(
      <KoaChatComposer
        value="Mensagem"
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.keyDown(screen.getByPlaceholderText("Digite uma mensagem..."), {
      key: "Enter",
      isComposing: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
