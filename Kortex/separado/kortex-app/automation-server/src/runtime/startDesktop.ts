import path from "node:path";
import { createDesktopServer } from "./createDesktopServer.js";

const server = await createDesktopServer(path.resolve(process.cwd(), "..", "dist"));
let closing: Promise<void> | undefined;
const shutdown = () => {
  closing ??= server.close();
  void closing.then(() => process.exit(0), () => process.exit(1));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.on("message", (message) => { if (message === "shutdown") shutdown(); });
if (process.send) process.once("disconnect", shutdown);
await server.listen({ host: "127.0.0.1", port: Number(process.env.KOA_DESKTOP_PORT ?? 8080) });
process.send?.("ready");
