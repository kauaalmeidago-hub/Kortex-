import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDesktopServer } from "./createDesktopServer.js";

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kortex-static-"));
  directories.push(dir);
  const root = path.join(dir, "dist");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>Kortex</title>");
  fs.writeFileSync(path.join(root, "assets", "app.js"), "window.kortex = true;");
  fs.writeFileSync(path.join(dir, ".env.local"), "DATABASE_URL=synthetic-secret");
  return createDesktopServer(root);
}

describe("permanent desktop UI", () => {
  it("serves compiled assets and deep links without caching an old page", async () => {
    const server = await fixture();
    try {
      const page = await server.inject({ url: "/chat", headers: { accept: "text/html" } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain("<title>Kortex</title>");
      expect(page.headers["cache-control"]).toBe("no-store");
      const asset = await server.inject("/assets/app.js");
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["content-type"]).toContain("javascript");
    } finally { await server.close(); }
  });
  it("does not expose environment files or return the UI for missing API/assets", async () => {
    const server = await fixture();
    try {
      for (const url of ["/.env.local", "/../.env.local", "/assets/missing.js", "/api/operations"]) {
        const response = await server.inject({ url, headers: { accept: "text/html" } });
        if (url.includes(".env.local")) expect([403, 404]).toContain(response.statusCode);
        else expect(response.statusCode).toBe(404);
        expect(response.body).not.toContain("synthetic-secret");
        expect(response.body).not.toContain("<title>Kortex</title>");
      }
      expect((await server.inject("/health")).json()).toEqual({ service: "kortex-desktop", status: "ok" });
    } finally { await server.close(); }
  });
});
