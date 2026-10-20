import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({user:"user",loading:false,error:null as string|null,scopes:vi.fn(),create:vi.fn(),status:vi.fn(),retry:vi.fn()}));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({user:{id:state.user},workspace:{id:"workspace"}})}));
vi.mock("@/features/access/BusinessAccess",()=>({useBusinessAccess:()=>({loading:state.loading,error:state.error,token:"token",selected:()=>null,retry:state.retry})}));
vi.mock("@/features/pipeline/setup",async importOriginal=>({...await importOriginal<typeof import("@/features/pipeline/setup")>(),pipelineSetupScopes:state.scopes,createPipelineSetup:state.create,pipelineSetupStatus:state.status}));
import PipelineSetupPage, { PipelineInitialState } from "./PipelineSetupPage";
import { PipelineSetupError } from "@/features/pipeline/setup";
const scope={workspace_id:"workspace",workspace_name:"Organização",sector_id:"sector",sector_name:"Relacionamento",can_create:true,can_create_shared:false};
function setup(initial=false,client=new QueryClient({defaultOptions:{queries:{retry:false}}}),cancelled=false){
 return {client,...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/pipeline/new?sector=sector"]}><Routes><Route path="/pipeline/new" element={initial?<PipelineInitialState workspaceId="workspace" sectorId="sector" cancelled={cancelled}/>:<PipelineSetupPage/>}/><Route path="/pipeline/new-form" element={<div>Formulário</div>}/><Route path="/pipeline/:pipelineId" element={<div>Quadro criado</div>}/><Route path="/pipeline" element={<div>Pipelines</div>}/></Routes></MemoryRouter></QueryClientProvider>)};
}
async function fill(){
 await screen.findByLabelText("Nome da pipeline");fireEvent.change(screen.getByLabelText("Nome da pipeline"),{target:{value:"Relacionamento"}});
 ["Entrada","Atendimento","Concluído"].forEach((name,i)=>fireEvent.change(screen.getByLabelText(`Nome da coluna ${i+1}`),{target:{value:name}}));
}
beforeEach(()=>{vi.clearAllMocks();state.user="user";state.loading=false;state.error=null;state.scopes.mockResolvedValue([scope]);state.status.mockResolvedValue(null);state.retry.mockResolvedValue(undefined);state.create.mockResolvedValue({pipeline_id:"created"});});
afterEach(cleanup);
describe("initial pipeline configuration",()=>{
 it("keeps draft and preview synchronized and focuses each newly added blank column",async()=>{
  setup();await screen.findByLabelText("Nome da pipeline");
  expect(screen.getByLabelText("Nome da pipeline")).toHaveValue("");expect(screen.getAllByPlaceholderText("Nome da coluna")).toHaveLength(3);
  const preview=screen.getByLabelText("Prévia das colunas");expect(within(preview).getAllByRole("heading")).toHaveLength(3);
  fireEvent.change(screen.getByLabelText("Nome da coluna 1"),{target:{value:"Contato inicial"}});
  expect(within(preview).getByText("Contato inicial")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Adicionar coluna"}));expect(screen.getByLabelText("Nome da coluna 4")).toHaveFocus();
  expect(screen.getByLabelText("Nome da coluna 4")).toHaveValue("");expect(within(preview).getAllByRole("heading")).toHaveLength(4);
  fireEvent.keyDown(screen.getByRole("button",{name:"Ordenar coluna 1"}),{key:"ArrowRight"});
  expect(screen.getByLabelText("Nome da coluna 2")).toHaveValue("Contato inicial");
  expect(within(preview).getAllByRole("heading")[1]).toHaveTextContent("Contato inicial");
  expect(state.create).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"Criar pipeline"})).toBeDisabled();
  within(preview).getAllByRole("button").forEach(b=>expect(b).toBeDisabled());
 });
 it("blocks duplicate submission and opens the confirmed real pipeline",async()=>{
  let finish!:(value:unknown)=>void;state.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  setup();await fill();const submit=screen.getByRole("button",{name:"Criar pipeline"});
  fireEvent.click(submit);fireEvent.submit(submit.closest("form")!);expect(state.create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button",{name:"Cancelar"})).toBeDisabled();
  finish({pipeline_id:"created"});await screen.findByText("Quadro criado");expect(state.retry).toHaveBeenCalledTimes(1);
 });
 it("respects reduced motion while focusing and revealing a newly added column",async()=>{
  const media=window.matchMedia("(prefers-reduced-motion: reduce)");const match=vi.spyOn(window,"matchMedia").mockReturnValue({...media,matches:true});
  const original=Element.prototype.scrollIntoView,scroll=vi.fn();Element.prototype.scrollIntoView=scroll;
  try{setup();await screen.findByLabelText("Nome da pipeline");fireEvent.click(screen.getByRole("button",{name:"Adicionar coluna"}));expect(screen.getByLabelText("Nome da coluna 4")).toHaveFocus();expect(scroll).toHaveBeenCalledWith({block:"nearest",inline:"nearest",behavior:"auto"});}
  finally{match.mockRestore();Element.prototype.scrollIntoView=original;}
 });
 it("removes only the selected draft column, updates preview and handles zero columns",async()=>{
  setup();await fill();
  fireEvent.keyDown(screen.getByRole("button",{name:"Ações da coluna 2"}),{key:"Enter"});fireEvent.click(await screen.findByRole("menuitem",{name:"Remover coluna"}));
  expect(screen.getByLabelText("Nome da coluna 1")).toHaveValue("Entrada");expect(screen.getByLabelText("Nome da coluna 2")).toHaveValue("Concluído");
  expect(within(screen.getByLabelText("Prévia das colunas")).queryByText("Atendimento")).not.toBeInTheDocument();
  for(let i=0;i<2;i++){fireEvent.keyDown(screen.getByRole("button",{name:"Ações da coluna 1"}),{key:"Enter"});fireEvent.click(await screen.findByRole("menuitem",{name:"Remover coluna"}));}
  expect(screen.getByRole("button",{name:"Criar pipeline"})).toBeDisabled();expect(screen.getByText("Adicione pelo menos uma coluna.")).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole("button",{name:"Adicionar coluna"})).toHaveFocus());expect(state.create).not.toHaveBeenCalled();
 });
 it("preserves values and request identity across failure and retry",async()=>{
  state.create.mockRejectedValueOnce(new PipelineSetupError("Falha de permissão"));setup();await fill();
  fireEvent.click(screen.getByRole("button",{name:"Criar pipeline"}));await screen.findByRole("alert");
  expect(screen.getByLabelText("Nome da coluna 2")).toHaveValue("Atendimento");
  const first=state.create.mock.calls[0][0];fireEvent.click(screen.getByRole("button",{name:"Criar pipeline"}));await screen.findByText("Quadro criado");
  expect(state.create.mock.calls[1][0].requestId).toBe(first.requestId);
 });
 it("can cancel without writes and preserves a draft when dismissal is refused",async()=>{
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);setup();await fill();
  fireEvent.click(screen.getByRole("button",{name:"Cancelar"}));expect(screen.getByLabelText("Nome da pipeline")).toHaveValue("Relacionamento");
  confirm.mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"Cancelar"}));await screen.findByText("Pipelines");
  expect(state.create).not.toHaveBeenCalled();confirm.mockRestore();
 });
 it("does not expose setup for loading, failed permission queries or denied access",async()=>{
  state.loading=true;const {unmount}=setup();expect(screen.getByRole("status")).toHaveTextContent("Carregando");expect(state.scopes).not.toHaveBeenCalled();unmount();
  state.loading=false;state.scopes.mockRejectedValueOnce(Error("Falha ao consultar"));const errorView=setup();await screen.findByRole("alert");expect(screen.queryByLabelText("Nome da pipeline")).not.toBeInTheDocument();errorView.unmount();
  state.scopes.mockResolvedValue([{...scope,can_create:false}]);setup();await screen.findByText(/Você não tem permissão/);expect(screen.queryByLabelText("Nome da pipeline")).not.toBeInTheDocument();
 });
 it("uses distinct memory drafts for distinct accounts and avoids cancelled setup loops",async()=>{
  const {client,unmount}=setup();await fill();unmount();state.user="another-user";const next=setup(false,client);await screen.findByLabelText("Nome da pipeline");expect(screen.getByLabelText("Nome da pipeline")).toHaveValue("");next.unmount();
  setup(true,undefined,true);await screen.findByRole("link",{name:"Configurar pipeline"});expect(screen.queryByLabelText("Nome da pipeline")).not.toBeInTheDocument();
 });
 it("reconciles an interrupted attempt after a remount instead of creating again",async()=>{
  state.create.mockRejectedValueOnce(new PipelineSetupError("Resposta interrompida",true));const view=setup();await fill();fireEvent.click(screen.getByRole("button",{name:"Criar pipeline"}));await screen.findByRole("alert");
  expect(screen.getByLabelText("Nome da pipeline")).toBeDisabled();view.unmount();state.status.mockResolvedValue({pipeline_id:"created"});
  setup(false,view.client);await waitFor(()=>expect(screen.getByText("Quadro criado")).toBeInTheDocument());expect(state.create).toHaveBeenCalledTimes(1);
 });
});
