import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusinessContext } from "@/integrations/supabase/businessTypes";
import type { LeadRow } from "@/features/pipeline/service";
const scope={board_id:"board",pipeline_id:"00000000-0000-4000-8000-000000000010",workspace_id:"workspace",sector_id:"sector",sector_name:"Relacionamento",kind:"pipeline",can_write:true,can_manage:false} as BusinessContext;
const data={stages:[{id:"stage-a",name:"Etapa A"},{id:"stage-b",name:"Etapa B"}],leads:[
 {id:"lead-a",title:"Empresa Alfa",stage_id:"stage-a",assigned_to:"user",expected_close_date:"2020-01-01"},
 {id:"lead-b",title:"Empresa Beta",stage_id:"stage-b",assigned_to:"other",expected_close_date:null},
]};
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({user:{id:"user"}})}));
vi.mock("@/features/access/BusinessAccess",()=>({BusinessContextPicker:()=>null,useBusinessAccess:()=>({
 contexts:[scope],selected:()=>scope,key:(_kind:string,r:string)=>["env",r],retry:vi.fn(),token:"token",isCurrent:()=>true,
})}));
vi.mock("@/features/pipeline/service",()=>({pipelineData:vi.fn(async()=>data),moveLead:vi.fn()}));
vi.mock("@/features/pipeline/PipelineBoard",()=>({default:({filtered,onAddRecord}:{filtered:LeadRow[],onAddRecord:(id:string)=>void})=><><div aria-label="Cards do quadro">{filtered.map(l=><span key={l.id}>{l.title}</span>)}</div><button onClick={()=>onAddRecord("stage-b")}>Adicionar na etapa B</button></>}));
vi.mock("@/features/pipeline/LeadEditor",()=>({LeadEditor:({initialStage,quick,onClose}:{initialStage:string,quick:boolean,onClose:()=>void})=><div role="dialog">{quick?"Criação rápida":"Criação completa"} · {initialStage}<button onClick={onClose}>Cancelar</button></div>}));
import PipelinePage from "./PipelinePage";
function setup(search=""){
 return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[`/pipeline/${scope.pipeline_id}${search}`]}><Routes><Route path="/pipeline/:pipelineId" element={<PipelinePage/>}/></Routes></MemoryRouter></QueryClientProvider>);
}
afterEach(cleanup);
describe("pipeline views and scoped creation",()=>{
 it("applies filters on confirmation, combines search and keeps the same results in List",async()=>{
  setup();await screen.findByText("Empresa Alfa");
  fireEvent.click(screen.getByRole("button",{name:"Filtros da pipeline"}));
  fireEvent.change(screen.getByLabelText("Responsável"),{target:{value:"mine"}});
  fireEvent.change(screen.getByLabelText("Previsão"),{target:{value:"dated"}});
  expect(screen.getByText("Empresa Beta")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Aplicar filtros"}));
  await waitFor(()=>expect(screen.queryByText("Empresa Beta")).not.toBeInTheDocument());
  fireEvent.change(screen.getByRole("textbox",{name:"Buscar registros"}),{target:{value:"Beta"}});
  expect(screen.queryByText("Empresa Alfa")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox",{name:"Buscar registros"}),{target:{value:"Alfa"}});
  fireEvent.click(screen.getByRole("button",{name:"Lista"}));
  const link=screen.getByRole("link",{name:"Empresa Alfa"});
  const destination=new URL(link.getAttribute("href")!,"https://example.invalid");
  expect(destination.searchParams.get("return")).toContain("owner=mine");
  expect(destination.searchParams.get("return")).toContain("view=list");
  expect(screen.queryByText("Empresa Beta")).not.toBeInTheDocument();
  expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
 });
 it("uses the clicked stage for quick creation and the same editor for New",async()=>{
  setup();await screen.findByText("Empresa Alfa");
  fireEvent.click(screen.getByRole("button",{name:"Adicionar na etapa B"}));
  expect(screen.getByRole("dialog")).toHaveTextContent("Criação rápida · stage-b");
  fireEvent.click(screen.getByRole("button",{name:"Cancelar"}));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Novo"}));
  expect(screen.getByRole("dialog")).toHaveTextContent("Criação completa · stage-a");
 });
});
