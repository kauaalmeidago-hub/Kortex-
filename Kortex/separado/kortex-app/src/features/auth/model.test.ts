import { describe, expect, it } from "vitest";
import {
  authMode,
  authReturnUrl,
  profileSectors,
  safeAuthDestination,
  validateAuthFields,
} from "./model";
const fields = {
  name: "Pessoa Sobrenome",
  sector: "financeiro",
  email: "pessoa@example.invalid",
  password: "SenhaTeste!23",
  confirmPassword: "SenhaTeste!23",
};
describe("authentication values and redirects", () => {
  it.each(profileSectors)(
    "accepts $label without a separate surname or privileged sector",
    ({ value }) => {
      expect(
        validateAuthFields("signup", { ...fields, sector: value }),
      ).toEqual({});
    },
  );
  it("requires an explicit canonical sector and matching passwords", () => {
    expect(
      validateAuthFields("signup", {
        ...fields,
        sector: "",
        confirmPassword: "outra",
      }),
    ).toMatchObject({
      sector: expect.any(String),
      confirmPassword: expect.any(String),
    });
    expect(
      validateAuthFields("signup", { ...fields, sector: "admin" }).sector,
    ).toBeTruthy();
    expect(validateAuthFields("signup", fields, 16).password).toBeTruthy();
  });
  it("does not impose signup requirements on login or recovery", () => {
    expect(
      validateAuthFields("login", {
        ...fields,
        name: "",
        sector: "",
        password: "a",
        confirmPassword: "",
      }),
    ).toEqual({});
    expect(validateAuthFields("forgot", { ...fields, password: "" })).toEqual(
      {},
    );
  });
  it.each([
    "https://outside.invalid",
    "//outside.invalid",
    "/\\outside.invalid",
    "/auth/callback",
    "/auth/login?next=/tasks",
  ])("rejects an unsafe or looping return %s", (value) => {
    expect(safeAuthDestination(value, "https://kortex.example")).toBe("/");
  });
  it("preserves corporate routes, queries and anchors on the current environment", () => {
    const path = "/admin/tasks?conversation=000A#draft";
    const url = new URL(
      authReturnUrl("https://kortex.example", "/auth/callback", path),
    );
    expect(url.origin).toBe("https://kortex.example");
    expect(url.searchParams.get("next")).toBe(path);
  });
  it("distinguishes OAuth/email callbacks from password recovery", () => {
    expect(authMode("/auth/callback", "?code=opaque", "")).toBe("callback");
    expect(
      authMode("/auth/callback", "", "#access_token=opaque&type=signup"),
    ).toBe("callback");
    expect(authMode("/auth/reset-password", "?code=opaque", "")).toBe("reset");
    expect(authMode("/auth/login", "", "#type=recovery")).toBe("reset");
  });
});
