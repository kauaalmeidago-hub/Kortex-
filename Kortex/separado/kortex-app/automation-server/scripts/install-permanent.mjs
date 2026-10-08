import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.platform !== "win32") {
  console.error("A instalação permanente deve ser executada no computador Windows do worker, com o usuário que usa o Kortex.");
  process.exit(1);
}
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.dirname(serverDir);
const runtimeDir = path.join(process.env.LOCALAPPDATA, "Kortex", "Runtime");
const stateFile = path.join(runtimeDir, "status.json");
const stopFile = path.join(runtimeDir, "stop.request");
const powershell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const action = process.argv[2] ?? "install";
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
  throw new Error("Use Node.js 22.13 ou superior com npm para executar o worker.");
}

function run(executable, args, { cwd = serverDir, env = process.env, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true,
      stdio: [input === undefined ? "ignore" : "pipe", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`O comando terminou com código ${code}.`)));
    if (input !== undefined) { child.stdin.once("error", reject); child.stdin.end(input); }
  });
}
const npm = (args, cwd, env) => run(process.execPath, [npmCli, ...args], { cwd, env });
const ps = (args, input) => run(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  path.join(serverDir, "scripts", "register-startup.ps1"), ...args], { input });
function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return undefined; }
}
function alive(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function healthy(state) {
  if (!state || !alive(state.supervisorPid) || state.services?.length !== 2 ||
      state.services.some((service) => service.state !== "running" || !alive(service.pid))) return false;
  try {
    const [app, worker] = await Promise.all([
      fetch(`${state.appUrl}/health`, { signal: AbortSignal.timeout(2000) }),
      fetch(`${state.workerUrl}/ready`, { signal: AbortSignal.timeout(2000) }),
    ]);
    return app.ok && (await app.json()).service === "kortex-desktop" && worker.ok;
  } catch { return false; }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (action === "status") {
  const state = readState();
  console.log(JSON.stringify({ ...(state ?? {}), healthy: await healthy(state) }, null, 2));
} else if (action === "stop" || action === "remove") {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(stopFile, "stop\n");
  if (action === "remove") await ps(["-Action", "Remove"]);
  const state = readState();
  for (let attempt = 0; attempt < 60 && alive(state?.supervisorPid); attempt++) await sleep(500);
  if (alive(state?.supervisorPid)) {
    throw new Error("O encerramento ainda não terminou. Nenhum processo externo foi encerrado.");
  }
  console.log(action === "remove" ? "Inicialização automática removida. As credenciais foram preservadas." :
    "Kortex e worker encerrados. Use automation:install para reativar.");
} else if (action === "install") {
  if (alive(readState()?.supervisorPid)) {
    if (await healthy(readState())) {
      console.log(`O Kortex já está funcionando em segundo plano: ${readState().appUrl}`);
      process.exit(0);
    }
    throw new Error("Já existe um supervisor ativo. Consulte automation:status antes de instalar novamente.");
  }
  if (!fs.existsSync(npmCli)) throw new Error("Instale Node.js LTS com npm no computador do worker.");
  console.log("Preparando a instalação permanente, preservando a configuração e as credenciais existentes...");
  await npm(["ci", "--no-audit", "--no-fund"], serverDir);
  await npm(["run", "build"], serverDir);
  await npm(["ci", "--no-audit", "--no-fund"], appDir);
  process.chdir(serverDir);
  const { loadConfig } = await import("../dist/config.js");
  const config = loadConfig();
  if (config.automationMode === "api") throw new Error("AUTOMATION_MODE=api não inicia o worker. Configure local-worker ou api-worker.");
  // Resolve the frontend's Vite, rather than the version pulled in by backend test tools.
  const { loadEnv } = await import(pathToFileURL(path.join(appDir, "node_modules", "vite", "dist", "node", "index.js")).href);
  const frontendEnv = loadEnv("production", appDir, "VITE_");
  const publicKey = frontendEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
  let keyRole;
  try { keyRole = JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url").toString()).role; } catch { /* publishable key */ }
  if (!frontendEnv.VITE_SUPABASE_URL || !publicKey) {
    throw new Error("Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env.local de kortex-app.");
  }
  if (publicKey.startsWith("sb_secret_") || keyRole === "service_role") {
    throw new Error("A chave do frontend deve ser pública. Use a publishable/anon key do projeto.");
  }
  if (!config.supabaseUrl || !config.supabaseSecretKey) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY no backend para validar o login do Kortex. Use o mesmo projeto Supabase do aplicativo.");
  }
  if (new URL(frontendEnv.VITE_SUPABASE_URL).origin !== new URL(config.supabaseUrl).origin) {
    throw new Error("VITE_SUPABASE_URL do aplicativo e SUPABASE_URL do worker apontam para projetos diferentes. Ajuste a configuração antes de instalar.");
  }
  const desktopPort = Number(process.env.KOA_DESKTOP_PORT ?? 8080);
  const supervisorPort = Number(process.env.KOA_SUPERVISOR_PORT ?? 4776);
  if (![config.port, desktopPort, supervisorPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535) ||
      new Set([config.port, desktopPort, supervisorPort]).size !== 3) throw new Error("Configure três portas locais diferentes e válidas.");
  const buildEnv = { ...process.env, NODE_ENV: "production", VITE_AUTOMATION_PROVIDER: "local",
    VITE_AUTOMATION_API_URL: `http://127.0.0.1:${config.port}` };
  // Never inherit worker secrets into Vite's build environment.
  for (const key of Object.keys(buildEnv)) {
    if (/^(DATABASE_URL|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|KOA_AUTOMATION_TOKEN)$/.test(key)) delete buildEnv[key];
  }
  await npm(["run", "build"], appDir, buildEnv);
  // Only supported worker settings are captured. DPAPI protects shell-only settings across reboots.
  const runtimeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(KOA_|HAPVIDA_|NDI_|FEATURE_KOA_|WORKER_|MOVEMENT_STATUS_|RECEITA_CPF_LOOKUP_URL$|CNS_LOOKUP_URL$)/.test(key) ||
    /^(AUTOMATION_MODE|DATABASE_URL|SUPABASE_URL|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|SECRET_PROVIDER|BROWSER_PROVIDER|HEADLESS|TRACE_AUTH|ARTIFACT_BUCKET)$/.test(key)));
  runtimeEnv.KOA_WORKER_ID = config.workerId;
  runtimeEnv.NODE_ENV = "production";
  await ps(["-Action", "Install", "-NodeExecutable", process.execPath, "-RuntimeDir", runtimeDir,
    "-AppUrl", `http://localhost:${desktopPort}`], JSON.stringify(runtimeEnv));
  fs.rmSync(stopFile, { force: true });
  const runner = spawn(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File",
    path.join(serverDir, "scripts", "run-permanent.ps1"), "-NodeExecutable", process.execPath, "-RuntimeDir", runtimeDir],
    { cwd: serverDir, detached: true, windowsHide: true, stdio: "ignore" });
  runner.once("error", (error) => { console.error("Não foi possível iniciar o processo em segundo plano."); process.exitCode = 1; });
  runner.unref();
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await healthy(readState())) { ready = true; break; }
    await sleep(1000);
  }
  if (!ready) throw new Error("Inicialização automática registrada, mas os serviços não ficaram prontos. Feche o terminal da instância antiga e consulte automation:status.");
  console.log(`Instalação concluída. Abra o atalho Kortex ou http://localhost:${desktopPort}. Pode fechar este terminal.`);
  console.log("O aplicativo e o worker iniciarão ao entrar no Windows e reiniciarão automaticamente em caso de queda.");
} else {
  throw new Error("Ação inválida. Use install, status, stop ou remove.");
}
