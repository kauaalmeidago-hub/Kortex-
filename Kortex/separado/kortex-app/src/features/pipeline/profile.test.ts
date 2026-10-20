import{beforeEach,describe,expect,it,vi}from"vitest";
const update=vi.hoisted(()=>vi.fn());
vi.mock("@/integrations/supabase/client",()=>({supabase:{from:()=>({update})}}));
import{leadProfilePatch,leadProfileValues,saveLeadProfile,validateLeadProfile}from"./profile";
import type{LeadRow}from"./service";import type{BusinessContext}from"@/integrations/supabase/businessTypes";
const lead={id:"lead",title:"Nome real",company_id:null,contact_id:null,stage_id:"stage",value:null,status:"new",updated_at:"v1",description:"Preservada"}as LeadRow;
beforeEach(()=>update.mockReset());
describe("lead-owned optional profile fields",()=>{
 it("normalizes absent values to empty controls and retains explicit empty overrides",()=>{
  expect(leadProfileValues(lead)).toMatchObject({title:"Nome real",phone:"",email:"",project:"",city:"",offerings:[],value:""});
  const contact={phone:"3133334444",email:"contact@example.invalid"};
  expect(leadProfileValues({...lead,phone:"",email:""},contact as never)).toMatchObject({phone:"",email:""});
  expect(leadProfileValues(lead,contact as never)).toMatchObject(contact);
  expect(leadProfileValues(lead,null,{id:"resolved-company"}as never).company_id).toBe("resolved-company");
 });
 it("patches only changed fields, without clearing a shared company or copying inherited values",()=>{
  const baseline=leadProfileValues(lead,null,{phone:"3133334444",project:"PME",city:"Cidade"}as never);
  expect(leadProfilePatch(baseline,{...baseline,title:" Nome atualizado "})).toEqual({title:"Nome atualizado"});
  expect(leadProfilePatch(baseline,{...baseline,phone:""})).toEqual({phone:""});
  expect(leadProfilePatch(baseline,baseline)).toEqual({});
 });
 it("allows a companyless lead and validates optional values only when supplied",()=>{
  const baseline=leadProfileValues(lead);expect(validateLeadProfile(baseline)).toBeNull();
  expect(validateLeadProfile({...baseline,email:"bad"})).toContain("e-mail");expect(validateLeadProfile({...baseline,phone:"12"})).toContain("telefone");
  expect(validateLeadProfile({...baseline,offerings:[{product:"Saúde",operator:""}]})).toContain("produto");
 });
 it("uses the original row version and scope when saving and surfaces conflicts",async()=>{
  const chain={eq:vi.fn().mockReturnThis(),select:vi.fn().mockReturnThis(),single:vi.fn().mockResolvedValue({data:null,error:{code:"PGRST116"}})};update.mockReturnValue(chain);
  const baseline=leadProfileValues(lead);await expect(saveLeadProfile({workspace_id:"ws",sector_id:"sector",pipeline_id:"pipeline"}as BusinessContext,lead,baseline,{...baseline,project:"Projeto real"})).rejects.toThrow(/alterados/);
  expect(update).toHaveBeenCalledWith({project:"Projeto real"});expect(chain.eq).toHaveBeenCalledWith("updated_at","v1");expect(chain.eq).toHaveBeenCalledWith("pipeline_id","pipeline");
 });
});
