import { existsSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

/** Serves only the already-built UI. The worker configuration/secrets are outside this root. */
export async function createDesktopServer(buildDir: string) {
  const root = path.resolve(buildDir);
  if (!existsSync(path.join(root, "index.html"))) throw new Error("Compile o aplicativo antes de iniciar.");
  const server = Fastify({ logger: false });
  server.get("/health", () => ({ service: "kortex-desktop", status: "ok" }));
  await server.register(fastifyStatic, { root, dotfiles: "deny", index: "index.html", cacheControl: false,
    setHeaders: (response, filePath) => {
      response.header("Cache-Control", filePath.endsWith(".html") ? "no-store" : "no-cache");
      response.header("X-Content-Type-Options", "nosniff");
    },
  });
  server.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if ((request.method === "GET" || request.method === "HEAD") &&
      request.headers.accept?.includes("text/html") && !path.posix.extname(pathname) &&
      !pathname.startsWith("/api/") && !pathname.startsWith("/assets/") && !pathname.includes("/.")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });
  return server;
}
