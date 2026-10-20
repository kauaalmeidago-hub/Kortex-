import { supabase } from "@/integrations/supabase/client";
import type {
  Company,
  CompanyRow,
  CompanyValues,
  CompanyContact,
  CompanyNote,
  CompanyFile,
} from "./model";
import { digits, validateCompany } from "./model";

const bucket = () => supabase.storage.from("company-media");
type Scope = { workspaceId: string; userId: string; sectorId?:string };
function requireScope(scope: Scope) {
  if (!scope.workspaceId || !scope.userId)
    throw new Error("Entre em um workspace para salvar os dados.");
}
function failure(error: unknown, action: string): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "23505")
    throw new Error("Já existe uma empresa com este CNPJ neste workspace.");
  if (["42P01", "42703", "PGRST204"].includes(code))
    throw new Error(
      "O cadastro aguarda a atualização da integração. Tente novamente após a atualização.",
    );
  if (code === "PGRST116")
    throw new Error(
      "O registro foi alterado ou não está mais disponível. Seu rascunho foi preservado; confira os dados antes de tentar novamente.",
    );
  throw new Error(`Não foi possível ${action}. Tente novamente.`);
}
async function withAvatars(rows: CompanyRow[]): Promise<Company[]> {
  const paths = rows.flatMap((r) => (r.avatar_path ? [r.avatar_path] : []));
  const { data } = paths.length
    ? await bucket().createSignedUrls(paths, 60)
    : { data: [] };
  const urls = new Map((data ?? []).map((r) => [r.path, r.signedUrl]));
  return rows.map((row) => ({
    ...row,
    avatarUrl: row.avatar_path ? (urls.get(row.avatar_path) ?? null) : null,
  }));
}
export async function listCompanies(workspaceId: string): Promise<Company[]> {
  const rows: CompanyRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name")
      .order("id")
      .range(offset, offset + 499);
    if (error) failure(error, "carregar as empresas");
    rows.push(...data);
    if (data.length < 500) break;
  }
  return withAvatars(rows);
}
export async function getCompany(
  workspaceId: string,
  id: string,
  signal?: AbortSignal,
): Promise<Company | null> {
  const request = supabase
    .from("companies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  const { data, error } = await (signal ? request.abortSignal(signal) : request).maybeSingle();
  if (error) failure(error, "carregar a empresa");
  return data ? (await withAvatars([data]))[0] : null;
}
export function validateImage(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Selecione uma imagem PNG, JPG ou WebP.");
  if (file.size > 5 * 1024 * 1024)
    throw new Error("A imagem deve ter até 5 MB.");
}
export async function saveCompany(
  scope: Scope,
  values: CompanyValues,
  previous?: Company,
  image?: File | null,
  removeImage = false,
): Promise<Company> {
  requireScope(scope);
  const invalid = validateCompany(values);
  if (invalid) throw new Error(invalid);
  const id = previous?.id ?? crypto.randomUUID();
  const avatarPath = removeImage ? null : (previous?.avatar_path ?? null);
  if(image)validateImage(image);
  const optional = (value: string) => value.trim() || null;
  const payload = {
    name: values.name.trim(),
    cnpj: values.cnpj.trim() ? digits(values.cnpj) : null,
    phone: optional(values.phone),
    email: optional(values.email),
    city: optional(values.city),
    project: optional(values.project),
    responsible_name: optional(values.responsible_name),
    industry: optional(values.industry),
    website: optional(values.website),
    address: optional(values.address),
    notes: optional(values.notes),
    offerings: values.offerings
      .filter((o) => o.product.trim() && o.operator.trim())
      .map((o) => ({ product: o.product.trim(), operator: o.operator.trim() })),
    avatar_path: avatarPath,
  };
  const result = previous
    ? await supabase
        .from("companies")
        .update(payload)
        .eq("workspace_id", scope.workspaceId)
        .eq("id", id)
        .eq("updated_at", previous.updated_at)
        .select("*")
        .single()
    : await supabase
        .from("companies")
        .insert({
          ...payload,
          id,
          workspace_id: scope.workspaceId,
          created_by: scope.userId,
          sector_id:scope.sectorId,
        })
        .select("*")
        .single();
  if(result.error)failure(result.error,"salvar a empresa");
  let saved=result.data;
  if(image){
    const path=`${scope.workspaceId}/${id}/avatar/${crypto.randomUUID()}.${{"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[image.type]}`;
    const upload=await bucket().upload(path,image,{contentType:image.type,upsert:false});
    if(upload.error)return {...(await withAvatars([saved]))[0],mediaWarning:"Os campos foram salvos. A imagem não foi enviada; tente alterá-la no perfil da empresa."};
    const media=await supabase.from("companies").update({avatar_path:path}).eq("workspace_id",scope.workspaceId).eq("id",id).eq("updated_at",saved.updated_at).select("*").single();
    if(media.error){await bucket().remove([path]);return {...(await withAvatars([saved]))[0],mediaWarning:"Os campos foram salvos. A imagem não foi vinculada; atualize o perfil e tente novamente."};}
    saved=media.data;
  }
  return (await withAvatars([saved]))[0];
}
async function allRows<T>(
  read: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  action: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await read(offset);
    if (error) failure(error, action);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}
export async function listCompanyContacts(
  workspaceId: string,
  companyId: string,
): Promise<CompanyContact[]> {
  const contacts = await allRows<CompanyContact>(
    (offset) =>
      supabase
        .from("contacts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("company_id", companyId)
        .order("full_name", { ascending: true })
        .order("id")
        .range(offset, offset + 499),
    "carregar os contatos",
  );
  return Promise.all(contacts.map(async contact => {
    const permission = await supabase.rpc("business_can_contact", { p_id: contact.id, p_write: true });
    if (permission.error) failure(permission.error, "validar as permissões do contato");
    return { ...contact, can_edit: permission.data === true };
  }));
}
export type ContactValues = Pick<
  CompanyContact,
  "full_name" | "job_title" | "phone" | "email"
>;
export async function unassignedCompanyContacts(workspaceId: string) {
  return allRows<CompanyContact>(
    (offset) =>
      supabase
        .from("contacts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("company_id", null)
        .order("full_name", { ascending: true })
        .order("id")
        .range(offset, offset + 499),
    "carregar contatos disponíveis",
  );
}
export async function linkCompanyContact(
  scope: Scope,
  companyId: string,
  contactId: string,
) {
  requireScope(scope);
  const { data, error } = await supabase
    .from("contacts")
    .update({ company_id: companyId })
    .eq("workspace_id", scope.workspaceId)
    .eq("id", contactId)
    .is("company_id", null)
    .select("*")
    .single();
  if (error) failure(error, "vincular o contato");
  return data;
}
export async function saveCompanyContact(
  scope: Scope,
  companyId: string,
  values: ContactValues,
  id?: string,
) {
  requireScope(scope);
  if (!values.full_name.trim()) throw new Error("Informe o nome do contato.");
  const payload = {
    full_name: values.full_name.trim(),
    job_title: values.job_title?.trim() || null,
    email: values.email?.trim() || null,
    phone: values.phone?.trim() || null,
  };
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) throw new Error("Informe um e-mail válido.");
  if (payload.phone && !/^\d{10,13}$/.test(digits(payload.phone))) throw new Error("Informe um telefone válido, incluindo DDD.");
  const result = id
    ? await supabase
        .from("contacts")
        .update(payload)
        .eq("workspace_id", scope.workspaceId)
        .eq("company_id", companyId)
        .eq("id", id)
        .select("*")
        .single()
    : await supabase
        .from("contacts")
        .insert({
          ...payload,
          company_id: companyId,
          workspace_id: scope.workspaceId,
          created_by: scope.userId,
          sector_id:scope.sectorId,
        })
        .select("*")
        .single();
  if (result.error) failure(result.error, "salvar o contato");
  return result.data;
}
export async function listCompanyNotes(
  workspaceId: string,
  companyId: string,
): Promise<CompanyNote[]> {
  return allRows<CompanyNote>(
    (offset) =>
      supabase
        .from("notes")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + 499),
    "carregar as notas",
  );
}
export async function saveCompanyNote(
  scope: Scope,
  companyId: string,
  content: string,
  id?: string,
) {
  requireScope(scope);
  if (!content.trim()) throw new Error("Escreva a nota antes de salvar.");
  const result = id
    ? await supabase
        .from("notes")
        .update({ content: content.trim() })
        .eq("workspace_id", scope.workspaceId)
        .eq("company_id", companyId)
        .eq("id", id)
        .select("*")
        .single()
    : await supabase
        .from("notes")
        .insert({
          workspace_id: scope.workspaceId,
          company_id: companyId,
          user_id: scope.userId,
          content: content.trim(),
        })
        .select("*")
        .single();
  if (result.error) failure(result.error, "salvar a nota");
  return result.data;
}
export async function listCompanyFiles(
  workspaceId: string,
  companyId: string,
): Promise<CompanyFile[]> {
  return allRows<CompanyFile>(
    (offset) =>
      supabase
        .from("company_files")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + 499),
    "carregar os arquivos",
  );
}
export async function uploadCompanyFile(
  scope: Scope,
  companyId: string,
  file: File,
) {
  requireScope(scope);
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error("Selecione um arquivo não vazio de até 20 MB.");
  const path = `${scope.workspaceId}/${companyId}/files/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error: uploadError } = await bucket().upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploadError) failure(uploadError, "enviar o arquivo");
  const { data, error } = await supabase
    .from("company_files")
    .insert({
      company_id: companyId,
      workspace_id: scope.workspaceId,
      name: file.name,
      storage_path: path,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      created_by: scope.userId,
    })
    .select("*")
    .single();
  if (error) {
    await bucket().remove([path]);
    failure(error, "registrar o arquivo enviado");
  }
  return data;
}
export async function companyFileUrl(file: CompanyFile) {
  const { data, error } = await bucket().createSignedUrl(
    file.storage_path,
    60,
    { download: file.name },
  );
  if (error) failure(error, "acessar o arquivo");
  return data.signedUrl;
}
export async function removeCompanyFile(scope: Scope, file: CompanyFile) {
  requireScope(scope);
  if (file.workspace_id !== scope.workspaceId) throw new Error("Arquivo indisponível para esta conta.");
  const stored = await bucket().remove([file.storage_path]);
  if (stored.error) failure(stored.error, "remover o arquivo");
  const row = await supabase.from("company_files").delete()
    .eq("workspace_id", scope.workspaceId).eq("company_id", file.company_id).eq("id", file.id).select("id").single();
  if (row.error) failure(row.error, "remover o vínculo do arquivo");
}
