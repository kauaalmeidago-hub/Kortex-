import{cleanup,fireEvent,render,screen,waitFor}from"@testing-library/react";import{QueryClient,QueryClientProvider}from"@tanstack/react-query";import{Link,MemoryRouter,Route,Routes}from"react-router-dom";import{afterEach,beforeEach,describe,expect,it,vi}from"vitest";
import type{BusinessContext}from"@/integrations/supabase/businessTypes";
const mocks=vi.hoisted(()=>({record:vi.fn(),details:vi.fn(),catalog:vi.fn(),save:vi.fn(),select:vi.fn()}));
const scope={board_id:"board",pipeline_id:"00000000-0000-4000-8000-000000000010",workspace_id:"workspace",sector_id:"sector",board_name:"Pipeline personalizada",sector_name:"Relacionamento",kind:"pipeline"}as BusinessContext;
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({user:{id:"user"}})}));
vi.mock("@/features/access/BusinessAccess",()=>({useBusinessAccess:()=>({contexts:[scope],selected:()=>scope,select:mocks.select,token:"token",key:(_k:string,r:string)=>["env",r,"token"],isCurrent:()=>true,retry:vi.fn(async()=>{})})}));
vi.mock("@/features/pipeline/service",()=>({pipelineRecord:mocks.record,pipelineData:vi.fn(async()=>({stages:[{id:"stage",name:"Triagem"}],leads:[]})),deleteLead:vi.fn()}));
vi.mock("@/features/pipeline/profile",async original=>({...await original<typeof import("@/features/pipeline/profile")>(),leadProfileDetails:mocks.details,leadProfileCatalog:mocks.catalog,saveLeadProfile:mocks.save}));
vi.mock("@/features/pipeline/LeadRecordActivity",()=>({default:({tab,active}:{tab:string;active:boolean})=><div hidden={!active}>{tab==="notes"?"Notas reais do registro":tab==="files"?"Arquivos reais do registro":"Histórico"}</div>}));
import LeadDetailPage from"./LeadDetailPage";
const first="00000000-0000-4000-8000-000000000001",second="00000000-0000-4000-8000-000000000002";
const row=(id=first,companyId:string|null=null,edit=true)=>({lead:{id,title:id===first?"Lead independente":"Segundo lead",description:"Preservada",pipeline_id:scope.pipeline_id,workspace_id:scope.workspace_id,sector_id:scope.sector_id,company_id:companyId,can_edit:edit,stage_id:"stage",value:null,status:"new",updated_at:"v1",assigned_to:"user"},contact:null,companyId});
function setup(path=`/leads/${first}`){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}><Link to={`/leads/${second}`}>Abrir segundo</Link><Routes><Route path="/leads/:leadId" element={<LeadDetailPage/>}/><Route path="/pipeline/:pipelineId" element={<p>Pipeline restaurada</p>}/></Routes></MemoryRouter></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();mocks.record.mockResolvedValue(row());mocks.details.mockResolvedValue({company:null,contacts:[],people:[{user_id:"user",full_name:"Kauã"}]});mocks.catalog.mockResolvedValue({companies:[],contacts:[]});mocks.save.mockResolvedValue(row().lead);});afterEach(cleanup);
describe("complete lead profile",()=>{
 it("keeps all fields, sections, tabs and the disabled composer for a lead with no company or contacts",async()=>{
  setup();await screen.findByRole("heading",{name:"Lead independente"});
  expect(screen.getByLabelText("Nome do cliente *")).toHaveValue("Lead independente");
  for(const label of ["Telefone","E-mail","Projeto","Cidade"])expect(screen.getByLabelText(label)).toHaveValue("");
  expect(screen.getByLabelText("Empresa")).toHaveValue("");expect(screen.getByLabelText("Responsável")).toBeDisabled();
  expect(screen.getByText("Informações complementares")).toBeInTheDocument();expect(screen.getByText("Produtos e operadoras")).toBeInTheDocument();
  for(const label of ["Conversa","Notas","Arquivos"])expect(screen.getByRole("tab",{name:label})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Adicionar contato"})).toBeEnabled();expect(screen.getByRole("button",{name:"Enviar"})).toBeDisabled();expect(screen.getByPlaceholderText("Digite uma mensagem...")).toBeVisible();
  expect(screen.queryByText(/Este registro ainda não tem uma empresa/)).not.toBeInTheDocument();
 });
 it("preserves edits across tabs and on a recoverable save failure",async()=>{
  mocks.save.mockRejectedValueOnce(Error("Falha ao salvar"));setup();await screen.findByLabelText("Telefone");
  fireEvent.change(screen.getByLabelText("Telefone"),{target:{value:"31987654321"}});fireEvent.change(screen.getByLabelText("Projeto"),{target:{value:"Projeto real"}});
  fireEvent.click(screen.getByRole("tab",{name:"Notas"}));expect(screen.getByText("Notas reais do registro")).toBeVisible();fireEvent.click(screen.getByRole("tab",{name:"Arquivos"}));expect(screen.getByText("Arquivos reais do registro")).toBeVisible();
  expect(screen.getByLabelText("Projeto")).toHaveValue("Projeto real");fireEvent.click(screen.getByRole("button",{name:"Salvar alterações"}));await screen.findByText("Falha ao salvar");expect(screen.getByLabelText("Telefone")).toHaveValue("31987654321");
  expect(mocks.save.mock.calls[0][3]).toMatchObject({phone:"31987654321",project:"Projeto real",company_id:""});
 });
 it("sends one save on repeated clicks and preserves return filters",async()=>{
  let finish!:(v:unknown)=>void;mocks.save.mockImplementation(()=>new Promise(r=>{finish=r}));const back=`/pipeline/${scope.pipeline_id}?view=list&q=consulta&owner=mine`;setup(`/leads/${first}?return=${encodeURIComponent(back)}`);await screen.findByLabelText("Cidade");
  fireEvent.change(screen.getByLabelText("Cidade"),{target:{value:"Belo Horizonte"}});const button=screen.getByRole("button",{name:"Salvar alterações"});fireEvent.click(button);fireEvent.submit(button.closest("form")!);expect(mocks.save).toHaveBeenCalledTimes(1);expect(screen.getByRole("link",{name:"Voltar para pipeline"})).toHaveAttribute("href",back);finish({...row().lead,city:"Belo Horizonte"});await screen.findByText("Alterações salvas.");
 });
 it("loads linked source values without replacing the lead identity or exposing company editing",async()=>{
  mocks.record.mockResolvedValue(row(first,"company"));mocks.details.mockResolvedValue({company:{id:"company",name:"Empresa real",phone:"3133334444",project:"PME",city:"Cidade",offerings:[]},contacts:[],people:[]});mocks.catalog.mockResolvedValue({companies:[{id:"company",name:"Empresa real",offerings:[]}],contacts:[]});setup();await waitFor(()=>expect(screen.getByLabelText("Telefone")).toHaveValue("3133334444"));
  expect(screen.getByRole("heading",{name:"Lead independente"})).toBeInTheDocument();expect(screen.getByLabelText("Nome do cliente *")).toHaveValue("Lead independente");expect(screen.getByLabelText("Empresa")).toHaveValue("company");
 });
 it("ignores an older detail response after a rapid record switch",async()=>{
  let finish!:(v:unknown)=>void;mocks.record.mockImplementation(async id=>row(id,null,false));mocks.details.mockImplementation((_scope,lead)=>lead.id===first?new Promise(r=>{finish=r}):Promise.resolve({company:null,contacts:[],people:[]}));setup();await waitFor(()=>expect(mocks.details).toHaveBeenCalled());fireEvent.click(screen.getByRole("link",{name:"Abrir segundo"}));await screen.findByRole("heading",{name:"Segundo lead"});finish({company:{name:"Empresa antiga",phone:"3133334444"},contacts:[],people:[]});await waitFor(()=>expect(screen.getByLabelText("Telefone")).toHaveValue(""));expect(screen.queryByText("Empresa antiga")).not.toBeInTheDocument();
 });
 it("keeps the complete read-only structure and distinguishes denied loading from empty data",async()=>{
  mocks.record.mockResolvedValue(row(first,null,false));const view=setup();await screen.findByLabelText("Telefone");expect(screen.getByLabelText("Telefone")).toHaveAttribute("readonly");expect(screen.getByRole("button",{name:"Adicionar contato"})).toBeDisabled();view.unmount();mocks.record.mockResolvedValue(null);setup();await screen.findByText("Registro indisponível para esta conta.");expect(screen.queryByLabelText("Telefone")).not.toBeInTheDocument();
 });
});
