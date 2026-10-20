import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({ production: true }));
vi.mock("@/theme-policy", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/theme-policy")>();
  return {
    ...original,
    get lightPortal() {
      return config.production;
    },
    resolveTheme: (saved: string | null) =>
      original.resolveTheme(saved, config.production),
  };
});
import { ThemeProvider, useTheme } from "./ThemeContext";
function View() {
  const theme = useTheme();
  return (
    <>
      <output>{theme.mode}</output>
      <button disabled={theme.forcedLight} onClick={theme.toggleMode}>
        Trocar tema
      </button>
    </>
  );
}
afterEach(() => {
  cleanup();
  config.production = true;
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
describe("central theme policy", () => {
  it("forces the user portal light while preserving a saved dark preference", () => {
    localStorage.setItem("crm-theme-mode", "dark");
    document.documentElement.classList.add("dark");
    render(
      <ThemeProvider>
        <View />
      </ThemeProvider>,
    );
    expect(screen.getByText("light")).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(localStorage.getItem("crm-theme-mode")).toBe("dark");
    expect(screen.getByRole("button")).toBeDisabled();
  });
  it("supports a full dark theme and switching in staging/development", () => {
    config.production = false;
    localStorage.setItem("crm-theme-mode", "dark");
    render(
      <ThemeProvider>
        <View />
      </ThemeProvider>,
    );
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(screen.getByText("light")).toBeInTheDocument();
    expect(localStorage.getItem("crm-theme-mode")).toBe("light");
  });
});
