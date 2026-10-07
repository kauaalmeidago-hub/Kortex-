import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { loadConfig } from "../config.js";
import { protectWithDpapi } from "../security/DpapiProtector.js";

const { Pool } = pg;

interface CompanyOption {
  id: string;
  name: string;
  workspace_id: string;
  workspace_name: string;
}

interface WorkspaceOption {
  id: string;
  name: string;
  owner_id: string;
}

function safeFileName(ref: string) {
  return Buffer.from(ref, "utf8").toString("base64url");
}

function maskUsername(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "***";
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

async function promptHidden(label: string) {
  if (!input.isTTY) {
    throw new Error("PASSWORD_PROMPT_REQUIRES_TTY");
  }

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const previousRawMode = input.isRaw;

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(previousRawMode);
      output.write("\n");
    };

    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString("utf8");
      for (const char of text) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Operacao cancelada pelo operador."));
          return;
        }

        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }

        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }

        value += char;
      }
    };

    output.write(label);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function askRequired(rl: ReturnType<typeof createInterface>, question: string, fallback?: string) {
  const suffix = fallback ? ` (${fallback})` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  const value = answer || fallback;
  if (!value) throw new Error(`${question} obrigatorio.`);
  return value;
}

async function chooseOrCreateWorkspace(rl: ReturnType<typeof createInterface>, pool: pg.Pool) {
  const workspaces = await pool.query<WorkspaceOption>(
    `SELECT id, name, owner_id
     FROM public.workspaces
     ORDER BY created_at
     LIMIT 200`,
  );

  if ((workspaces.rowCount ?? 0) > 0) {
    console.log("");
    console.log("Workspaces encontrados:");
    workspaces.rows.forEach((workspace, index) => {
      console.log(`[${index + 1}] ${workspace.name}`);
    });
    console.log("");

    const selected = await askRequired(rl, "Digite o numero do workspace");
    const index = Number.parseInt(selected, 10);
    if (!Number.isInteger(index) || index < 1 || index > workspaces.rows.length) {
      throw new Error("Workspace invalido.");
    }

    const workspace = workspaces.rows[index - 1];
    if (!workspace) throw new Error("Workspace invalido.");
    return workspace;
  }

  const config = loadConfig();
  if (!config.supabaseUrl || !config.supabaseSecretKey) {
    throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  }

  console.log("");
  console.log("Nenhum workspace encontrado. Vou criar um bootstrap tecnico para iniciar o Koa.");
  console.log("A senha desse usuario tecnico sera gerada localmente e nao sera exibida.");
  console.log("");

  const email = await askRequired(rl, "Email tecnico para owner do workspace", `koa-worker-${Date.now()}@kortex.local`);
  const workspaceName = await askRequired(rl, "Nome do workspace", "Kortex Relacionamento");
  const confirm = await askRequired(rl, "Criar usuario tecnico e workspace inicial? Digite CRIAR");
  if (confirm !== "CRIAR") throw new Error("Operacao cancelada pelo operador.");

  const admin = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        "User-Agent": "KortexAutomationWorker/1.0",
      },
    },
  });

  const generatedPassword = `${crypto.randomBytes(24).toString("base64url")}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: generatedPassword,
    email_confirm: true,
    user_metadata: {
      full_name: workspaceName,
    },
  });
  if (error || !data.user) {
    throw new Error(`AUTH_BOOTSTRAP_FAILED: ${error?.message ?? "usuario nao criado"}`);
  }

  const workspace = await pool.query<WorkspaceOption>(
    `SELECT id, name, owner_id
     FROM public.workspaces
     WHERE owner_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [data.user.id],
  );

  if (workspace.rows[0]) return workspace.rows[0];

  const slug = `${workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${data.user.id.slice(0, 8)}`;
  const inserted = await pool.query<WorkspaceOption>(
    `INSERT INTO public.workspaces (name, slug, owner_id)
     VALUES ($1, $2, $3)
     RETURNING id, name, owner_id`,
    [workspaceName, slug, data.user.id],
  );
  return inserted.rows[0]!;
}

async function createCompany(rl: ReturnType<typeof createInterface>, pool: pg.Pool, workspace: WorkspaceOption) {
  const companyName = await askRequired(rl, "Nome da empresa para vincular a credencial");
  const result = await pool.query<CompanyOption>(
    `INSERT INTO public.companies (workspace_id, name, created_by)
     VALUES ($1, $2, $3)
     RETURNING id, name, workspace_id, (SELECT name FROM public.workspaces WHERE id = $1) AS workspace_name`,
    [workspace.id, companyName, workspace.owner_id],
  );

  const company = result.rows[0];
  if (!company) throw new Error("COMPANY_BOOTSTRAP_FAILED");
  return company;
}

async function chooseCompany(rl: ReturnType<typeof createInterface>, pool: pg.Pool) {
  const result = await pool.query<CompanyOption>(
    `SELECT c.id, c.name, c.workspace_id, w.name AS workspace_name
     FROM public.companies c
     JOIN public.workspaces w ON w.id = c.workspace_id
     ORDER BY w.name, c.name
     LIMIT 200`,
  );

  if (result.rowCount === 0) {
    console.log("");
    console.log("Nenhuma empresa encontrada em public.companies.");
    const workspace = await chooseOrCreateWorkspace(rl, pool);
    return createCompany(rl, pool, workspace);
  }

  console.log("");
  console.log("Empresas encontradas:");
  result.rows.forEach((company, index) => {
    console.log(`[${index + 1}] ${company.name} | workspace: ${company.workspace_name}`);
  });
  console.log("");

  const selected = await askRequired(rl, "Digite o numero da empresa");
  const index = Number.parseInt(selected, 10);
  if (!Number.isInteger(index) || index < 1 || index > result.rows.length) {
    throw new Error("Empresa invalida.");
  }

  const company = result.rows[index - 1];
  if (!company) {
    throw new Error("Empresa invalida.");
  }

  return company;
}

async function main() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL_MISSING");
  }

  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 1,
    application_name: "kortex-credential-register",
  });
  const rl = createInterface({ input, output });

  try {
    const company = await chooseCompany(rl, pool);
    const operator = (await askRequired(rl, "Operadora", "hapvida")).toLowerCase();
    const defaultRef = `${operator}:${company.id}`;
    const credentialRef = await askRequired(rl, "CredentialRef", defaultRef);
    const username = await askRequired(rl, "Codigo/usuario do portal");
    const password = await promptHidden("Senha do portal (entrada oculta): ");
    if (!password.trim()) throw new Error("Senha obrigatoria.");

    const label = await askRequired(rl, "Rotulo para identificar no Kortex", `${operator} - ${company.name}`);
    const confirm = await askRequired(rl, `Salvar credencial local e metadata no Supabase para ${company.name}? Digite SALVAR`);
    if (confirm !== "SALVAR") {
      throw new Error("Operacao cancelada pelo operador.");
    }

    const payload = JSON.stringify({ username, password });
    const encrypted = await protectWithDpapi(payload);
    await mkdir(config.secretsDir, { recursive: true });
    const secretPath = path.join(config.secretsDir, `${safeFileName(credentialRef)}.credential.dpapi`);
    await writeFile(secretPath, encrypted, "utf8");

    const metadata = {
      source: "local_dpapi",
      store: "worker_local",
      registeredAt: new Date().toISOString(),
    };

    const upsert = await pool.query<{ id: string; status: string }>(
      `INSERT INTO public.automation_credentials (
         workspace_id,
         company_id,
         operator,
         credential_ref,
         label,
         username_hint,
         status,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'needs_verification', $7::jsonb)
       ON CONFLICT (credential_ref)
       DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         company_id = EXCLUDED.company_id,
         operator = EXCLUDED.operator,
         label = EXCLUDED.label,
         username_hint = EXCLUDED.username_hint,
         status = CASE
           WHEN public.automation_credentials.status = 'active' THEN 'active'::public.automation_credential_status
           ELSE 'needs_verification'::public.automation_credential_status
         END,
         metadata = public.automation_credentials.metadata || EXCLUDED.metadata,
         updated_at = now()
       RETURNING id, status`,
      [company.workspace_id, company.id, operator, credentialRef, label, maskUsername(username), JSON.stringify(metadata)],
    );

    const row = upsert.rows[0];
    console.log("");
    console.log("CREDENTIAL_REGISTERED");
    console.log(`credentialRef=${credentialRef}`);
    console.log(`metadataStatus=${row?.status ?? "unknown"}`);
    console.log("secret=local_dpapi_configured");
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
