import { describe, expect, it } from "vitest";
import { DomainAllowlist } from "./DomainAllowlist.js";

describe("DomainAllowlist", () => {
  it("allows only configured automation portal hosts", () => {
    const allowlist = new DomainAllowlist(["webhap.hapvida.com.br", "sigo.sh.srv.br"]);

    expect(allowlist.isAllowed("https://webhap.hapvida.com.br/pls/webhap/pk_carteira_provisoria.login_empresa_form")).toBe(true);
    expect(allowlist.isAllowed("https://sigo.sh.srv.br/pls/webmin/pk_carteira_provisoria.login_empresa_form")).toBe(true);
    expect(allowlist.isAllowed("about:blank")).toBe(true);
    expect(allowlist.isAllowed("https://accounts.google.com/")).toBe(false);
    expect(allowlist.isAllowed("https://passwords.google.com/")).toBe(false);
  });

  it("throws DOMAIN_NOT_ALLOWED for non-allowlisted hosts", () => {
    const allowlist = new DomainAllowlist(["webhap.hapvida.com.br"]);

    expect(() => allowlist.assertAllowed("https://example.com", "CARD_ISSUE")).toThrow(/Dominio bloqueado/);
  });

  it("permits the portal's HTTPS reCAPTCHA resources without allowing Google navigation", () => {
    const allowlist = new DomainAllowlist(["webhap.hapvida.com.br"]);
    const portal = "https://webhap.hapvida.com.br/pls/webhap/pk_carteira_provisoria.login_empresa_form";
    for (const url of [
      "https://www.google.com/recaptcha/api.js?render=public-key",
      "https://www.gstatic.com/recaptcha/releases/release/recaptcha__pt_br.js",
      "https://recaptcha.google.com/recaptcha/api2/anchor",
      "https://www.recaptcha.net/recaptcha/api2/reload",
    ]) {
      expect(allowlist.isAllowedHapvidaRecaptchaResource(url, portal)).toBe(true);
      expect(allowlist.isAllowed(url)).toBe(false);
    }
  });

  it("rejects unrelated origins, paths, schemes and non-portal initiators", () => {
    const allowlist = new DomainAllowlist(["webhap.hapvida.com.br"]);
    const portal = "https://webhap.hapvida.com.br/pls/webhap/login";
    for (const url of [
      "https://www.google.com/search?q=recaptcha", "https://accounts.google.com/recaptcha/api.js",
      "https://www.gstatic.com/unrelated.js", "https://www.google.com/recaptcha-other/api.js",
      "https://www.google.com.evil.test/recaptcha/api.js", "http://www.google.com/recaptcha/api.js",
      "https://www.google.com:444/recaptcha/api.js", "https://user:secret@www.google.com/recaptcha/api.js",
    ]) expect(allowlist.isAllowedHapvidaRecaptchaResource(url, portal)).toBe(false);
    for (const page of ["about:blank", "https://example.test/", "https://sigo.sh.srv.br/", "http://webhap.hapvida.com.br/"]) {
      expect(allowlist.isAllowedHapvidaRecaptchaResource("https://www.google.com/recaptcha/api.js", page)).toBe(false);
    }
    expect(new DomainAllowlist([]).isAllowedHapvidaRecaptchaResource("https://www.google.com/recaptcha/api.js", portal)).toBe(false);
  });
});

