import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../dist/config.js";
import { ProcessSupervisor } from "../dist/runtime/ProcessSupervisor.js";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(serverDir);
const config = loadConfig();
const runtimeDir = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share"), "Kortex", "Runtime");
fs.mkdirSync(runtimeDir, { recursive: true });
const stopFile = path.join(runtimeDir, "stop.request");
const stateFile = path.join(runtimeDir, "status.json");
const runtimePort = Number(process.env.KOA_SUPERVISOR_PORT ?? 4776);
const desktopPort = Number(process.env.KOA_DESKTOP_PORT ?? 8080);
if (![runtimePort, desktopPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535) ||
    new Set([runtimePort, desktopPort, config.port]).size !== 3) {
  throw new Error("As portas do supervisor, aplicativo e worker precisam ser validas e diferentes.");
}
// The port is an instance guard, not an HTTP/API endpoint. Bind before starting any child.
const guard = net.createServer((socket) => socket.destroy());
try {
  await new Promise((resolve, reject) => {
    guard.once("error", reject);
    guard.listen(runtimePort, "127.0.0.1", resolve);
  });
} catch (error) {
  if (error?.code === "EADDRINUSE") process.exit(0);
  throw error;
}
const startedAt = new Date().toISOString();
const workerEnv = { ...process.env };
// The static UI server does not receive the worker's database or portal credentials.
const desktopEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA)$/i.test(key)));
desktopEnv.KOA_DESKTOP_PORT = String(desktopPort);
desktopEnv.NODE_ENV = "production";
let stopping;
const supervisor = new ProcessSupervisor([
  { name: "worker", entry: path.join(serverDir, "dist", "index.js"), cwd: serverDir, env: workerEnv },
  { name: "app", entry: path.join(serverDir, "dist", "runtime", "startDesktop.js"), cwd: serverDir, env: desktopEnv },
], { onChange: (services) => {
  const state = { supervisorPid: process.pid, startedAt, updatedAt: new Date().toISOString(),
    appUrl: `http://localhost:${desktopPort}`, workerUrl: `http://127.0.0.1:${config.port}`, services };
  try {
    fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state, null, 2));
    fs.renameSync(`${stateFile}.tmp`, stateFile);
  } catch { /* A temporarily locked status file must not stop the worker. */ }
} });
const shutdown = () => stopping ??= (async () => {
  clearInterval(stopWatch);
  await supervisor.stop();
  await new Promise((resolve) => guard.close(resolve));
})();
const stopWatch = setInterval(() => {
  if (fs.existsSync(stopFile)) void shutdown().then(() => process.exit(0), () => process.exit(1));
}, 500);
process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
if (fs.existsSync(stopFile)) {
  await shutdown();
} else {
  supervisor.start();
}
