import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
import { taskFailure } from "@/features/tasks/service";
import { digits, parseOfferings, type CompanyRow, type CompanyContact, type Offering } from "@/features/companies/model";
import { page, type LeadRow } from "./service";
export type LeadProfileValues = {
 title:string;phone:string;email:string;company_id:string;project:string;city:string;description:string;
 stage_id:string;value:string;expected_close_date:string;status:LeadRow["status"];offerings:Offering[];
};
export function leadProfileValues(lead:LeadRow,contact?:CompanyContact|null,company?:CompanyRow|null):LeadProfileValues{
 return {title:lead.title??"",phone:lead.phone??contact?.phone??company?.phone??"",email:lead.email??contact?.email??company?.email??"",
 company_id:lead.company_id??company?.id??"",project:lead.project??company?.project??"",city:lead.city??company?.city??"",description:lead.description??"",
 stage_id:lead.stage_id??"",value:lead.value==null?"":String(lead.value),expected_close_date:lead.expected_close_date??"",status:lead.status,
 offerings:parseOfferings(lead.offerings??company?.offerings)};
}
export function validateLeadProfile(v:LeadProfileValues){
 if(!v.title.trim()||v.title.trim().length>240)return "Informe o nome do cliente, com até 240 caracteres.";
 if(v.email.trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()))return "Informe um e-mail válido.";
 if(v.phone.trim()&&!/^\d{10,13}$/.test(digits(v.phone)))return "Informe um telefone válido, incluindo DDD.";
 if(v.value!==""&&(!Number.isFinite(Number(v.value))||Number(v.value)<0))return "Informe um valor estimado válido.";
 if(v.offerings.some(o=>!o.product.trim()||!o.operator.trim()))return "Preencha produto e operadora ou remova o vínculo vazio.";
 return null;
}
export function leadProfilePatch(baseline:LeadProfileValues,value:LeadProfileValues){
 const patch:Record<string,unknown>={};
 for(const key of Object.keys(value) as (keyof LeadProfileValues)[]){
  if(JSON.stringify(value[key])===JSON.stringify(baseline[key]))continue;
  const field=value[key];
  patch[key]=key==="offerings"?value.offerings.map(o=>({product:o.product.trim(),operator:o.operator.trim()})):
   key==="value"?(field===""?null:Number(field)):
   ["company_id","expected_close_date","stage_id"].includes(key)?field||null:typeof field==="string"?field.trim():field;
 }
 return patch as Database["public"]["Tables"]["leads"]["Update"];
}
export async function saveLeadProfile(scope:BusinessContext,lead:LeadRow,baseline:LeadProfileValues,values:LeadProfileValues){
 const error=validateLeadProfile({...values,phone:values.phone===baseline.phone?"":values.phone,email:values.email===baseline.email?"":values.email,offerings:JSON.stringify(values.offerings)===JSON.stringify(baseline.offerings)?[]:values.offerings});if(error)throw Error(error);
 const patch=leadProfilePatch(baseline,values);if(!Object.keys(patch).length)return lead;
 const r=await supabase.from("leads").update(patch).eq("id",lead.id).eq("workspace_id",scope.workspace_id)
  .eq("sector_id",scope.sector_id).eq("pipeline_id",scope.pipeline_id!).eq("updated_at",lead.updated_at).select("*").single();
 if(r.error)taskFailure(r.error);return {...r.data,can_edit:lead.can_edit} as LeadRow;
}
export type LeadContact=CompanyContact&{linked:boolean;primary:boolean};
export async function leadProfileDetails(scope:BusinessContext,lead:LeadRow,companyId:string|null,signal?:AbortSignal){
 const [company,links,people]=await Promise.all([
  companyId?supabase.from("companies").select("*").eq("workspace_id",scope.workspace_id).eq("sector_id",scope.sector_id).eq("id",companyId).abortSignal(signal).maybeSingle():Promise.resolve({data:null,error:null}),
  supabase.from("lead_contacts").select("contact_id").eq("lead_id",lead.id).abortSignal(signal),
  supabase.rpc("business_people",{p_board:scope.board_id}).abortSignal(signal),
 ]);for(const r of [company,links,people])if(r.error)taskFailure(r.error);
 const ids=[...new Set([lead.contact_id,...(links.data??[]).map(c=>c.contact_id)].filter((s):s is string=>Boolean(s)))];
 const [direct,companyContacts]=await Promise.all([
  ids.length?page(o=>supabase.from("contacts").select("*").eq("workspace_id",scope.workspace_id).eq("sector_id",scope.sector_id).in("id",ids).order("id").range(o,o+499).abortSignal(signal)):Promise.resolve([]),
  company.data?page(o=>supabase.from("contacts").select("*").eq("workspace_id",scope.workspace_id).eq("sector_id",scope.sector_id).eq("company_id",company.data!.id).order("id").range(o,o+499).abortSignal(signal)):Promise.resolve([]),
 ]);
 const contacts=await Promise.all([...new Map([...direct,...companyContacts].map(c=>[c.id,c])).values()].map(async c=>{
  const permission=await supabase.rpc("business_can_contact",{p_id:c.id,p_write:true}).abortSignal(signal);if(permission.error)taskFailure(permission.error);
  return {...c,can_edit:permission.data===true,linked:links.data?.some(l=>l.contact_id===c.id)??false,primary:lead.contact_id===c.id} as LeadContact;
 }));
 return {company:company.data,contacts,people:people.data??[]};
}
export async function leadProfileCatalog(scope:BusinessContext,signal?:AbortSignal){
 const [companies,contacts]=await Promise.all([
  page(o=>supabase.from("companies").select("id,name,project,offerings").eq("workspace_id",scope.workspace_id).eq("sector_id",scope.sector_id).order("name").order("id").range(o,o+499).abortSignal(signal)),
  page(o=>supabase.from("contacts").select("id,full_name,company_id").eq("workspace_id",scope.workspace_id).eq("sector_id",scope.sector_id).order("full_name").order("id").range(o,o+499).abortSignal(signal)),
 ]);return {companies,contacts};
}
export async function actLeadContact(leadId:string,contactId:string,action:"create"|"link"|"unlink"|"edit",values?:{full_name:string;job_title:string;email:string;phone:string},updated?:string){
 const r=await supabase.rpc("business_lead_contact",{p_lead:leadId,p_contact:contactId,p_action:action,p_values:values??{},p_updated:updated??null});
 if(r.error)taskFailure(r.error);return r.data;
}
