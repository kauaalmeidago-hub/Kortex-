import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyFixture } from "@/test/companyFixtures";
import { companyValues } from "./model";
const mock = vi.hoisted(() => ({ from: vi.fn(), storageFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mock.from, storage: { from: mock.storageFrom } },
}));
import {
  getCompany,
  listCompanies,
  saveCompany,
  saveCompanyNote,
  validateImage,
  uploadCompanyFile,
} from "./service";
let builder: Record<string, ReturnType<typeof vi.fn>>;
let storage: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  vi.clearAllMocks();
  builder = {};
  for (const key of ["select", "eq", "order", "insert", "update", "is"])
    builder[key] = vi.fn(() => builder);
  builder.single = vi
    .fn()
    .mockResolvedValue({ data: companyFixture, error: null });
  builder.maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: companyFixture, error: null });
  builder.range = vi
    .fn()
    .mockResolvedValue({ data: [companyFixture], error: null });
  mock.from.mockReturnValue(builder);
  storage = {
    upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  mock.storageFrom.mockReturnValue(storage);
});
describe("company persistence", () => {
  it("writes every registration field and preserves the paired offerings", async () => {
    await saveCompany(
      { workspaceId: "workspace-test", userId: "user-test" },
      companyValues(companyFixture),
    );
    const payload = builder.insert.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: companyFixture.name,
      cnpj: companyFixture.cnpj,
      email: companyFixture.email,
      city: companyFixture.city,
      responsible_name: companyFixture.responsible_name,
      project: "PME",
      offerings: companyFixture.offerings,
      workspace_id: "workspace-test",
      created_by: "user-test",
    });
  });
  it("scopes detail loading and partial updates by workspace and real identifier", async () => {
    await getCompany("workspace-test", companyFixture.id);
    expect(builder.eq).toHaveBeenCalledWith("workspace_id", "workspace-test");
    expect(builder.eq).toHaveBeenCalledWith("id", companyFixture.id);
    await saveCompany(
      { workspaceId: "workspace-test", userId: "user-test" },
      companyValues(companyFixture),
      companyFixture,
    );
    expect(builder.update.mock.calls[0][0]).not.toHaveProperty("workspace_id");
    expect(builder.update.mock.calls[0][0]).not.toHaveProperty("created_by");
    expect(builder.eq).toHaveBeenCalledWith(
      "updated_at",
      companyFixture.updated_at,
    );
  });
  it("does not query without an authenticated workspace or with invalid values", async () => {
    await expect(
      saveCompany(
        { workspaceId: "", userId: "" },
        companyValues(companyFixture),
      ),
    ).rejects.toThrow("workspace");
    await expect(
      saveCompany(
        { workspaceId: "workspace-test", userId: "user-test" },
        { ...companyValues(companyFixture), cnpj: "123" },
      ),
    ).rejects.toThrow("CNPJ");
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("does not upload a file when the scoped company row could not be saved",async()=>{
    builder.single.mockResolvedValue({data:null,error:{code:"23505"}});
    await expect(saveCompany({workspaceId:"workspace-test",userId:"user-test"},companyValues(companyFixture),companyFixture,new File(["png"],"avatar.png",{type:"image/png"}))).rejects.toThrow("CNPJ");
    expect(storage.upload).not.toHaveBeenCalled();expect(storage.remove).not.toHaveBeenCalled();
  });
  it("reports a partial media failure without inventing a failed company save",async()=>{
    storage.upload.mockResolvedValue({data:null,error:{code:"forbidden"}});
    const result=await saveCompany({workspaceId:"workspace-test",userId:"user-test"},companyValues(companyFixture),undefined,new File(["png"],"avatar.png",{type:"image/png"}));
    expect(result.id).toBe(companyFixture.id);expect(result.mediaWarning).toContain("campos foram salvos");expect(builder.insert).toHaveBeenCalledOnce();
  });
  it("paginates the real source instead of truncating at the API limit", async () => {
    builder.range
      .mockResolvedValueOnce({
        data: Array.from({ length: 500 }, () => companyFixture),
        error: null,
      })
      .mockResolvedValueOnce({ data: [companyFixture], error: null });
    expect(await listCompanies("workspace-test")).toHaveLength(501);
    expect(builder.range).toHaveBeenNthCalledWith(2, 500, 999);
  });
  it("keeps note edits bound to the selected company and workspace", async () => {
    await saveCompanyNote(
      { workspaceId: "workspace-test", userId: "user-test" },
      companyFixture.id,
      "Nota atualizada",
      "note-test",
    );
    expect(mock.from).toHaveBeenCalledWith("notes");
    expect(builder.eq).toHaveBeenCalledWith("company_id", companyFixture.id);
    expect(builder.eq).toHaveBeenCalledWith("workspace_id", "workspace-test");
    expect(builder.eq).toHaveBeenCalledWith("id", "note-test");
  });
  it("cleans up its file upload when metadata cannot be persisted", async () => {
    builder.single.mockResolvedValue({
      data: null,
      error: { code: "failure" },
    });
    await expect(
      uploadCompanyFile(
        { workspaceId: "workspace-test", userId: "user-test" },
        companyFixture.id,
        new File(["document"], "arquivo.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toThrow("registrar");
    expect(storage.remove).toHaveBeenCalledWith([
      storage.upload.mock.calls[0][0],
    ]);
  });
  it("rejects unsupported profile images before uploading", () => {
    expect(() =>
      validateImage(new File(["svg"], "image.svg", { type: "image/svg+xml" })),
    ).toThrow("PNG");
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
