import { describe, expect, it } from "vitest";
import { getKoaDepartment } from "../../../supabase/functions/_shared/koaDepartment";

describe("contexto setorial do KOA", () => {
  it.each(["comercial", "relacionamento", "financeiro"])("resolve o setor %s atribuído pelo backend", department => {
    expect(getKoaDepartment({ app_metadata: { department } })).toBe(department);
  });
  it("aceita a chave setor e normaliza sua apresentação", () => {
    expect(getKoaDepartment({ app_metadata: { setor: " Comercial " } })).toBe("comercial");
  });
  it("não concede contexto comercial a setores desconhecidos ou metadados editáveis", () => {
    const user = { app_metadata: {}, user_metadata: { department: "comercial" } };
    expect(getKoaDepartment(user)).toBeNull();
    expect(getKoaDepartment({ app_metadata: { department: "outro" } })).toBeNull();
  });
});
