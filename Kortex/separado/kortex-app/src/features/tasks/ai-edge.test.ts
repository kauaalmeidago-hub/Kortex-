// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTaskAiHandler,
  normalizeDraft,
  normalizeCollection,
  type Client,
  type Row,
  type Catalog,
} from "../../../supabase/functions/_shared/task-ai-core";
const ids = {
  user: "20000000-0000-4000-8000-000000000001",
  workspace: "10000000-0000-4000-8000-000000000001",
  message: "40000000-0000-4000-8000-000000000001",
  conversation: "40000000-0000-4000-8000-000000000002",
  draft: "50000000-0000-4000-8000-000000000001",
};
const key = "sk-test-not-a-real-key-123456789";
const board = {
  board_id: "board",
  board_name: "Fila",
  sector_id: "sector",
  sector_name: "Financeiro",
  workspace_id: ids.workspace,
  kind: "tasks",
  can_dispatch: true,
};
const valid = {
  title: "Preparar documentação",
  description: "Conferir os dados.",
  board_id: "board",
  sector_id: "sector",
  stage_id: "todo",
  assigned_to: "",
  company_id: "",
  operational_code: "",
  operator: "",
  project: "",
  due_date: "2026-10-20",
  priority: "medium",
  unresolved: [],
};
const catalog: Catalog = {
  currentBoard: "board",
  boards: [board],
  stages: [{ id: "todo", board_id: "board", archived: false }],
  companies: [],
  people: [],
};
let client: Client,
  admin: Client,
  upstream: ReturnType<typeof vi.fn>,
  authenticate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  client = {
    rpc: vi.fn(async (name, args) => ({
      data:
        name === "task_ai_status"
          ? { configured: true, model: "gpt-4.1-mini" }
          : name === "task_admin_access"
            ? true
            : name === "business_contexts"
              ? [board]
              : name === "business_people"
                ? []
                : name === "task_batch_context"
                  ? { revision: 0, drafts: [], messages: [] }
                  : name === "task_apply_interpretation"
                    ? { draft_ids: [ids.draft] }
                    : null,
      error: null,
    })),
    read: vi.fn(async (table) =>
      table === "task_messages"
        ? [
            {
              id: ids.message,
              conversation_id: ids.conversation,
              role: "user",
              content: "Preparar documentação",
            },
          ]
        : table === "task_conversations"
          ? [
              {
                id: ids.conversation,
                created_by: ids.user,
                workspace_id: ids.workspace,
                board_id: "board",
              },
            ]
          : table === "task_stages"
            ? catalog.stages
            : [],
    ),
  };
  admin = {
    rpc: vi.fn(async (name) => ({
      data:
        name === "task_ai_batch_claim"
          ? { state: "pending", revision: 0, lease_id: "lease" }
          : name === "task_ai_secret"
            ? { api_key: key, model: "gpt-4.1-mini" }
            : null,
      error: null,
    })),
    read: vi.fn(),
  };
  upstream = vi.fn(async () =>
    Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                reply: "Confira os rascunhos.",
                changes: [{ draft_id: "", version: 0, payload: valid }],
              }),
            },
          ],
        },
      ],
    }),
  );
  authenticate = vi.fn(async () => ({ id: ids.user, client }));
});
const request = (
  body: Row,
  auth = "Bearer user-jwt",
  origin = "https://kortex-usuarios.vercel.app",
) =>
  new Request("https://edge.invalid/task-ai", {
    method: "POST",
    headers: {
      authorization: auth,
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
const handler = () =>
  createTaskAiHandler({
    authenticate,
    admin,
    fetch: upstream as typeof fetch,
    now: () => new Date("2026-10-16T15:00:00Z"),
  });
describe("task AI server boundary", () => {
  it("requires a real user session rather than a public or secret API key", async () => {
    for (const token of [
      "",
      "Bearer sb_publishable_abc",
      "Bearer sb_secret_abc",
    ])
      expect((await handler()(request({}, token))).status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
  it("rejects an unrelated origin and forbidden organization before contacting OpenAI", async () => {
    expect(
      (
        await handler()(
          request(
            { action: "connect" },
            "Bearer user-jwt",
            "https://attacker.invalid",
          ),
        )
      ).status,
    ).toBe(403);
    client.rpc = vi.fn(async () => ({ data: null, error: { code: "42501" } }));
    const r = await handler()(
      request({
        action: "connect",
        workspace_id: ids.workspace,
        api_key: key,
        model: "gpt-4.1-mini",
        user_id: "forged",
      }),
    );
    expect(r.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("validates a model without generating tokens, saves only for the authenticated actor and never echoes the key", async () => {
    upstream.mockResolvedValue(Response.json({ id: "gpt-4.1-mini" }));
    const r = await handler()(
      request({
        action: "connect",
        workspace_id: ids.workspace,
        api_key: key,
        model: "gpt-4.1-mini",
        user_id: "forged",
      }),
    );
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain(key);
    expect(upstream.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/models/gpt-4.1-mini",
    );
    expect(admin.rpc).toHaveBeenCalledWith("task_ai_configure", {
      p_user: ids.user,
      p_workspace: ids.workspace,
      p_key: key,
      p_model: "gpt-4.1-mini",
    });
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("does not save a rejected key or reveal raw upstream errors", async () => {
    upstream.mockResolvedValue(
      Response.json(
        { error: { message: "credential " + key } },
        { status: 401 },
      ),
    );
    const r = await handler()(
      request({
        action: "connect",
        workspace_id: ids.workspace,
        api_key: key,
        model: "gpt-4.1-mini",
      }),
    );
    expect(r.status).toBe(422);
    expect(await r.text()).not.toContain(key);
    expect(admin.rpc).not.toHaveBeenCalledWith(
      "task_ai_configure",
      expect.anything(),
    );
  });
  it("persists only a draft with the reserved identity and leaves task creation for confirmation", async () => {
    const r = await handler()(
      request({ action: "interpret", message_id: ids.message }),
    );
    expect(r.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith(
      "task_apply_interpretation",
      expect.objectContaining({
        p_message: ids.message,
        p_lease: "lease",
        p_changes: [{ draft_id: "", version: 0, payload: valid }],
      }),
    );
    expect(client.rpc).not.toHaveBeenCalledWith(
      "task_confirm_batch",
      expect.anything(),
    );
    const payload = JSON.parse(upstream.mock.calls[0][1].body);
    expect(payload.store).toBe(false);
    expect(payload.tools).toBeUndefined();
    expect(payload.text.format.strict).toBe(true);
  });
  it("reuses the persisted operation after a lost response without another provider call", async () => {
    admin.rpc = vi.fn(async () => ({
      data: { state: "complete", draft_ids: [ids.draft] },
      error: null,
    }));
    const r = await handler()(
      request({ action: "interpret", message_id: ids.message }),
    );
    expect(await r.json()).toEqual({ draft_ids: [ids.draft], reused: true });
    expect(upstream).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalledWith(
      "task_save_draft",
      expect.anything(),
    );
  });
  it("keeps the existing message and marks the lease failed after a provider limit", async () => {
    upstream.mockResolvedValue(
      Response.json({ error: { message: key } }, { status: 429 }),
    );
    const r = await handler()(
      request({ action: "interpret", message_id: ids.message }),
    );
    expect(r.status).toBe(429);
    expect(await r.text()).not.toContain(key);
    expect(client.rpc).not.toHaveBeenCalledWith(
      "task_save_draft",
      expect.anything(),
    );
    expect(admin.rpc).toHaveBeenCalledWith("task_ai_batch_fail", {
      p_user: ids.user,
      p_message: ids.message,
      p_lease: "lease",
    });
  });
  it("rejects a forged message ID before reading any provider secret", async () => {
    client.read = vi.fn(async () => []);
    expect(
      (
        await handler()(
          request({ action: "interpret", message_id: ids.message }),
        )
      ).status,
    ).toBe(403);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
});
describe('attachment interpretation', () => {
  const fileId = '60000000-0000-4000-8000-000000000001';
  const bytes = new TextEncoder().encode('Preparar documentação da Empresa A.');
  const file = {id:fileId,workspace_id:ids.workspace,draft_id:ids.draft,task_id:null,
    name:'pedido.txt',mime_type:'text/plain',size_bytes:bytes.length,storage_path:`${ids.workspace}/${ids.draft}/pedido.txt`};
  const review = {id:fileId,readable:true,summary:'Documentação da Empresa A.',evidence:'Preparar documentação da Empresa A.',issues:[]};
  function setupFile(overrides:Row={}) {
    const originalRead = client.read;
    client.read = vi.fn(async (table,columns,filters,limit) => table === 'task_attachments' ? [{...file,...overrides}] : originalRead(table,columns,filters,limit));
    const originalRpc = client.rpc;
    client.rpc = vi.fn(async(name,args) => name === 'task_batch_context'
      ? {data:{revision:0,drafts:[{id:ids.draft,version:2,position:1,payload:valid}],messages:[]},error:null}
      : originalRpc(name,args));
    client.download = vi.fn(async()=>bytes);
    upstream.mockImplementation(async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({
      reply:'Confira os dados lidos e o destino antes de confirmar.',changes:[{draft_id:ids.draft,payload:valid}],file_reviews:[review],
    })}]}]}));
  }
  it('reads authenticated storage bytes and updates the existing attached draft',async()=>{
    setupFile();
    const result=await handler()(request({action:'interpret',message_id:ids.message}));
    expect(result.status).toBe(200);
    expect(client.download).toHaveBeenCalledWith('task-attachments',file.storage_path);
    const input=JSON.parse(upstream.mock.calls[0][1].body);
    expect(input.input[0].content[1]).toEqual({type:'input_file',filename:file.name,file_data:`data:text/plain;base64,${Buffer.from(bytes).toString('base64')}`});
    expect(JSON.parse(input.input[0].content[0].text).anexos_disponiveis[0]).toMatchObject({id:fileId,draft_id:ids.draft});
    expect(input.text.format.schema.required).toContain('file_reviews');
    expect(input.instructions).toContain('LEITURA E VALIDAÇÃO DE ARQUIVOS');
    expect(input.instructions).not.toContain('Não há conteúdo de anexos disponível');
    expect(client.rpc).toHaveBeenCalledWith('task_apply_interpretation',expect.objectContaining({p_changes:[{draft_id:ids.draft,version:2,payload:valid}]}));
  });
  it('rejects another draft or a forged storage path before downloading',async()=>{
    setupFile({draft_id:'other'});
    expect((await handler()(request({action:'interpret',message_id:ids.message}))).status).toBe(403);
    expect(client.download).not.toHaveBeenCalled();expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects corrupt bytes before the provider and preserves the draft',async()=>{
    setupFile({name:'fake.pdf',mime_type:'application/pdf'});
    const r=await handler()(request({action:'interpret',message_id:ids.message}));
    expect(r.status).toBe(422);expect((await r.json()).error).toBe('INVALID_FILE');
    expect(upstream).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalledWith('task_apply_interpretation',expect.anything());
  });
  it.each([
    {reviews:[{...review,readable:false}],code:'FILE_REVIEW_REQUIRED'},
    {reviews:[{...review,issues:['Há dados conflitantes sobre a empresa.']}],code:'FILE_REVIEW_REQUIRED'},
    {reviews:[{...review,id:'forged'}],code:'FILE_REVIEW_INVALID'},
    {reviews:[],code:'FILE_REVIEW_INVALID'},
  ])('blocks changes when the provider cannot validate every file ($code)',async({reviews,code})=>{
    setupFile();
    upstream.mockResolvedValue(Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({reply:'Pronto',changes:[{draft_id:ids.draft,payload:valid}],file_reviews:reviews})}]}]}));
    const result=await handler()(request({action:'interpret',message_id:ids.message}));
    expect(result.status).toBe(422);
    expect((await result.json()).error).toBe(code);
    expect(client.rpc).not.toHaveBeenCalledWith('task_apply_interpretation',expect.anything());
    expect(admin.rpc).toHaveBeenCalledWith('task_ai_batch_fail',expect.objectContaining({p_message:ids.message}));
  });
  it('explains incompatible model/file errors without exposing provider diagnostics',async()=>{
    setupFile();upstream.mockResolvedValue(Response.json({error:{message:key}},{status:400}));
    const result=await handler()(request({action:'interpret',message_id:ids.message}));
    expect(result.status).toBe(422);const body=await result.text();
    expect(body).toContain('modelo configurado');expect(body).not.toContain(key);
  });
});
describe("untrusted AI output", () => {
  it("normalizes explicit Brazilian dates without accepting impossible days or guessing other formats", () => {
    expect(
      normalizeDraft({ ...valid, due_date: "20/11/2026" }, catalog).due_date,
    ).toBe("2026-11-20");
    expect(
      normalizeDraft({ ...valid, due_date: "30/02/2026" }, catalog).due_date,
    ).toBe("");
    expect(
      normalizeDraft({ ...valid, due_date: "11/20/2026" }, catalog).unresolved,
    ).toContain("Informe uma data de vencimento válida.");
  });
  it("keeps six independent requests as six changes, with one structured response and no task confirmation", async () => {
    upstream.mockResolvedValue(
      Response.json({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  reply: "Confira os seis pedidos.",
                  changes: Array.from({ length: 6 }, (_, i) => ({
                    draft_id: "",
                    version: 0,
                    payload: { ...valid, title: "Pedido " + (i + 1) },
                  })),
                }),
              },
            ],
          },
        ],
      }),
    );
    const r = await handler()(
      request({ action: "interpret", message_id: ids.message }),
    );
    expect(r.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith(
      "task_apply_interpretation",
      expect.objectContaining({
        p_changes: expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({ title: "Pedido 6" }),
          }),
        ]),
      }),
    );
    const call = vi
      .mocked(client.rpc)
      .mock.calls.find((c) => c[0] === "task_apply_interpretation")!;
    expect(call[1].p_changes).toHaveLength(6);
    expect(upstream).toHaveBeenCalledOnce();
    expect(client.rpc).not.toHaveBeenCalledWith(
      "task_confirm_batch",
      expect.anything(),
    );
  });
  it("allows a greeting response without fabricating a task", () => {
    expect(
      normalizeCollection(
        { reply: "Olá! Qual tarefa deseja preparar?", changes: [] },
        catalog,
        { drafts: [] },
      ),
    ).toEqual({ reply: "Olá! Qual tarefa deseja preparar?", changes: [] });
  });
  it("edits only an existing reviewed ID/version and rejects foreign or repeated references", () => {
    const context = {
      drafts: [{ id: ids.draft, version: 3, position: 2, payload: valid }],
    };
    const change = {
      draft_id: ids.draft,
      version: 3,
      payload: { ...valid, due_date: "2026-11-24" },
    };
    expect(
      normalizeCollection(
        { reply: "Ajuste", changes: [{ draft_id: ids.draft, payload: valid }] },
        catalog,
        context,
      ).changes[0].version,
    ).toBe(3);
    expect(
      normalizeCollection(
        { reply: "Prazo ajustado.", changes: [change] },
        catalog,
        context,
      ).changes[0].draft_id,
    ).toBe(ids.draft);
    expect(() =>
      normalizeCollection(
        { reply: "Ajuste", changes: [{ ...change, version: 2 }] },
        catalog,
        context,
      ),
    ).toThrow(/atuais/);
    expect(() =>
      normalizeCollection(
        { reply: "Ajuste", changes: [change, change] },
        catalog,
        context,
      ),
    ).toThrow(/atuais/);
    expect(() =>
      normalizeCollection(
        { reply: "Ajuste", changes: [{ ...change, draft_id: "foreign" }] },
        catalog,
        context,
      ),
    ).toThrow(/atuais/);
  });
  it("removes foreign identifiers and inconsistent corporate fields and requires a manual review", () => {
    const result = normalizeDraft(
      {
        ...valid,
        board_id: "foreign",
        company_id: "foreign-company",
        assigned_to: "foreign-user",
        operator: "invented",
        project: "invented",
      },
      catalog,
    );
    expect(result).toMatchObject({
      board_id: "",
      sector_id: "",
      assigned_to: "",
      company_id: "",
      operator: "",
      project: "",
    });
    expect(result.unresolved.length).toBeGreaterThan(0);
  });
  it("rejects oversized text and flags impossible calendar dates without silently changing the day", () => {
    expect(() =>
      normalizeDraft({ ...valid, description: "x".repeat(501) }, catalog),
    ).toThrow(/limites/);
    const result = normalizeDraft(
      { ...valid, due_date: "2026-02-30" },
      catalog,
    );
    expect(result.due_date).toBe("");
    expect(result.unresolved).toContain(
      "Informe uma data de vencimento válida.",
    );
    expect(normalizeDraft(valid, catalog).due_date).toBe("2026-10-20");
  });
});

describe("natural historical lookups",()=>{
 const none={kind:"none",intent:"view",query:"",from:"",to:"",limit:5};
 const output=(value:Row)=>Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(value)}]}]});
 it("never loads historical records for a greeting",async()=>{
  upstream.mockResolvedValue(output({reply:"Olá! Como posso ajudar?",changes:[],resolved:false,lookup:none}));
  expect((await handler()(request({action:"interpret",message_id:ids.message}))).status).toBe(200);
  expect(vi.mocked(client.rpc).mock.calls.some(c=>c[0]==="task_history_lookup")).toBe(false);
  expect(upstream).toHaveBeenCalledTimes(1);
 });
 it("looks up only requested authorized IDs and persists pointers rather than duplicating tasks",async()=>{
  const original=client.rpc;client.rpc=vi.fn(async(n,p)=>n==="task_history_lookup"?{data:[{id:ids.draft,title:"Tarefa real",due_date:"2026-10-21"}],error:null}:original(n,p));
  upstream.mockResolvedValueOnce(output({reply:"Consultando.",changes:[],resolved:false,lookup:{...none,kind:"tasks",intent:"revise",query:"Tarefa real",limit:2}})).mockResolvedValueOnce(output({reply:"Encontrei a tarefa. Revise a alteração.",changes:[],resolved:false,lookup:none}));
  expect((await handler()(request({action:"interpret",message_id:ids.message}))).status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(2);
  expect(client.rpc).toHaveBeenCalledWith("task_history_lookup",expect.objectContaining({p_kind:"tasks",p_query:"Tarefa real",p_limit:2}));
  expect(client.rpc).toHaveBeenCalledWith("task_apply_interpretation",expect.objectContaining({p_changes:[],p_history:{kind:"tasks",intent:"revise",ids:[ids.draft],resolved:false}}));
 });
 it("rejects a historical response that attempts to create another draft",async()=>{
  const original=client.rpc;client.rpc=vi.fn(async(n,p)=>n==="task_history_lookup"?{data:[],error:null}:original(n,p));
  upstream.mockResolvedValueOnce(output({reply:"Consultar.",changes:[],lookup:{...none,kind:"tasks"}})).mockResolvedValueOnce(output({reply:"Duplicar",changes:[{draft_id:"",version:0,payload:valid}],lookup:none}));
  expect((await handler()(request({action:"interpret",message_id:ids.message}))).status).toBe(502);
  expect(vi.mocked(client.rpc).mock.calls.some(c=>c[0]==="task_apply_interpretation")).toBe(false);
 });
});
