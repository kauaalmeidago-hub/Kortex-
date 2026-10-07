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
});
