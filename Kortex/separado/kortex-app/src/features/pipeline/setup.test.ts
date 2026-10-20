import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({supabase:{rpc}}));
import { createPipelineSetup, emptyPipelineSetup, PipelineSetupError, reorderSetup, validPipelineSetup } from "./setup";
const result={board_id:"board",pipeline_id:"pipeline",workspace_id:"workspace",sector_id:"sector"};
function response(data: unknown, error: unknown = null) { return {abortSignal:vi.fn().mockResolvedValue({data,error})}; }
function valid() {const d=emptyPipelineSetup("sector");return {...d,name:"  Atendimento  ",columns:d.columns.map((c,i)=>({...c,name:` Etapa ${i} `}))};}
beforeEach(()=>rpc.mockReset());
describe("pipeline setup draft and reconciliation",()=>{
 it("starts with three blank columns with stable independent identities",()=>{
  const d=emptyPipelineSetup();expect(d.name).toBe("");expect(d.columns.map(c=>c.name)).toEqual(["","",""]);
  expect(new Set(d.columns.map(c=>c.id)).size).toBe(3);expect(validPipelineSetup(d)).toBe(false);
  const filled=valid(), reordered=reorderSetup(filled.columns,filled.columns[0].id,filled.columns[2].id);
  expect(reordered).toEqual([filled.columns[1],filled.columns[2],filled.columns[0]]);
  expect(filled.columns[0].name).toBe(" Etapa 0 ");
 });
 it("requires all retained names, permits current duplicate-name policy and one column",()=>{
  const d=valid();expect(validPipelineSetup(d)).toBe(true);
  expect(validPipelineSetup({...d,columns:[]})).toBe(false);
  expect(validPipelineSetup({...d,columns:[{...d.columns[0],name:"   "}]})).toBe(false);
  expect(validPipelineSetup({...d,columns:[d.columns[0]]})).toBe(true);
  expect(validPipelineSetup({...d,columns:d.columns.map(c=>({...c,name:"Igual"}))})).toBe(true);
  expect(validPipelineSetup({...d,name:"x".repeat(101)})).toBe(false);
  expect(validPipelineSetup({...d,columns:Array.from({length:31},()=>d.columns[0])})).toBe(false);
 });
 it("never sends temporary IDs and trims without changing order",async()=>{
  rpc.mockReturnValueOnce(response([])).mockReturnValueOnce(response([result]));
  const d=valid();expect(await createPipelineSetup(d)).toEqual(result);
  expect(rpc).toHaveBeenNthCalledWith(2,"business_create_pipeline_setup",{p_sector:"sector",p_request:d.requestId,p_name:"Atendimento",p_columns:[{name:"Etapa 0"},{name:"Etapa 1"},{name:"Etapa 2"}],p_visibility:"personal"});
 });
 it("recovers a committed result after a timeout and retries with the same receipt",async()=>{
  const d=valid();rpc.mockReturnValueOnce(response([])).mockReturnValueOnce(response(null,{code:"TIMEOUT"})).mockReturnValueOnce(response([result]));
  expect(await createPipelineSetup(d)).toEqual(result);
  rpc.mockReset().mockReturnValue(response([result]));
  expect(await createPipelineSetup(d)).toEqual(result);expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("business_pipeline_setup_status",{p_request:d.requestId});
 });
 it("does not issue creation when reconciliation fails or validation is incomplete",async()=>{
  await expect(createPipelineSetup(emptyPipelineSetup("sector"))).rejects.toBeInstanceOf(PipelineSetupError);expect(rpc).not.toHaveBeenCalled();
  rpc.mockReturnValue(response(null,{code:"42501"}));
  await expect(createPipelineSetup(valid())).rejects.toMatchObject({uncertain:false});expect(rpc).toHaveBeenCalledTimes(1);
 });
});
