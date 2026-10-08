import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "Kortex runtime test com espaços "));
const fixtureServer = path.join(dir, "app", "automation-server");
fs.mkdirSync(path.join(fixtureServer, "scripts"), { recursive: true });
fs.cpSync(path.join(serverDir, "dist"), path.join(fixtureServer, "dist"), { recursive: true });
fs.copyFileSync(path.join(serverDir, "scripts", "permanent-runtime.mjs"), path.join(fixtureServer, "scripts", "permanent-runtime.mjs"));
fs.symlinkSync(path.join(serverDir, "node_modules"), path.join(fixtureServer, "node_modules"), "junction");
fs.writeFileSync(path.join(fixtureServer, "package.json"), '{"type":"module"}');
fs.mkdirSync(path.join(dir, "app", "dist"));
fs.writeFileSync(path.join(dir, "app", "dist", "index.html"), "<!doctype html><title>Offline Kortex test</title>");
const runtimeDir = path.join(dir, "local", "Kortex", "Runtime");
const stateFile = path.join(runtimeDir, "status.json");
const children = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function eventually(check, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { await check(); return; } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw lastError;
}
const state = () => JSON.parse(fs.readFileSync(stateFile, "utf8"));
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE)$/i.test(key)));
Object.assign(env, { LOCALAPPDATA: path.join(dir, "local"), KOA_AUTOMATION_HOME: path.join(dir, "automation"),
  KOA_BROWSER_PROFILE_DIR: path.join(dir, "browser"), KOA_AUTOMATION_PORT: String(await freePort()),
  KOA_DESKTOP_PORT: String(await freePort()), KOA_SUPERVISOR_PORT: String(await freePort()),
  KOA_WORKER_ID: "offline-runtime-test", AUTOMATION_MODE: "api-worker", FEATURE_KOA_CARD_ISSUE: "false" });
function launch() {
  const child = spawn(process.execPath, [path.join(fixtureServer, "scripts", "permanent-runtime.mjs")],
    { cwd: fixtureServer, env, stdio: "ignore", windowsHide: true });
  children.push(child);
  return child;
}
let supervisor;
try {
  supervisor = launch();
  await eventually(async () => {
    const current = state();
    assert.equal(current.services.length, 2);
    assert(current.services.every((service) => service.state === "running"));
    assert((await fetch(`${current.workerUrl}/ready`)).ok);
    assert.equal((await (await fetch(`${current.appUrl}/health`)).json()).service, "kortex-desktop");
  });
  console.log("BACKGROUND_WORKER_AND_APP = OK");
  const first = state();
  const duplicate = launch();
  const duplicateExit = await new Promise((resolve) => duplicate.once("exit", resolve));
  assert.equal(duplicateExit, 0);
  assert.equal(state().supervisorPid, first.supervisorPid);
  assert.deepEqual(state().services.map((service) => service.pid), first.services.map((service) => service.pid));
  console.log("SINGLE_SUPERVISOR = OK");
  for (const role of ["worker", "app"]) {
    const original = state().services.find((service) => service.name === role);
    // Only a child started by this isolated test is interrupted.
    process.kill(original.pid, "SIGKILL");
    await eventually(async () => {
      const current = state();
      const replacement = current.services.find((service) => service.name === role);
      assert.equal(replacement.state, "running");
      assert(replacement.pid && replacement.pid !== original.pid);
      assert.equal(replacement.restarts, 1);
      assert((await fetch(role === "worker" ? `${current.workerUrl}/ready` : `${current.appUrl}/health`)).ok);
    });
    console.log(`${role.toUpperCase()}_CRASH_RECOVERY = OK`);
  }
  const ownedPids = state().services.map((service) => service.pid);
  fs.writeFileSync(path.join(runtimeDir, "stop.request"), "stop\n");
  await eventually(() => assert.equal(supervisor.exitCode, 0));
  assert(state().services.every((service) => service.state === "stopped"));
  assert(ownedPids.every((pid) => !alive(pid)));
  console.log("GRACEFUL_STOP_AND_NO_ORPHANS = OK");
} finally {
  if (supervisor && supervisor.exitCode === null) {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "stop.request"), "stop\n");
    try { await eventually(() => assert.notEqual(supervisor.exitCode, null), 5000); }
    catch { supervisor.kill("SIGKILL"); }
  }
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  fs.rmSync(dir, { recursive: true, force: true });
}
