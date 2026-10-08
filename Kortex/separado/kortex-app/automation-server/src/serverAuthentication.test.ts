import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationConfig } from "./config.js";
import type { AutomationOperationRepository } from "./repositories/AutomationOperationRepository.js";
import type { OperationQueue } from "./queue/OperationQueue.js";
import type { CredentialResolver } from "./credentials/CredentialResolver.js";
import { OperationEventBus } from "./events/EventBus.js";
import { createServer } from "./server.js";

const getUser = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser } }) }));

describe("Kortex session authorization before operation creation", () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  const create = vi.fn();
  const enqueue = vi.fn();
  const resolve = vi.fn();
  async function server(authConfigured = true) {
    app = await createServer({
      config: { apiToken: "local-server-token", features: {}, ...(authConfigured
        ? { supabaseUrl: "https://project.supabase.test", supabaseSecretKey: "synthetic-server-key" } : {}) } as AutomationConfig,
      repository: { create } as unknown as AutomationOperationRepository,
      queue: { enqueue } as unknown as OperationQueue,
      eventBus: new OperationEventBus(), credentialResolver: { resolve } as unknown as CredentialResolver,
    });
    return app;
  }
  afterEach(async () => { await app?.close(); vi.clearAllMocks(); });

  it("rejects an anonymous order before saving or queueing anything", async () => {
    const response = await (await server()).inject({ method: "POST", url: "/api/operations", payload: {} });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "KORTEX_SESSION_REQUIRED" });
    expect(getUser).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled();
  });

  it("reports missing worker auth configuration separately from a rejected user session", async () => {
    const response = await (await server(false)).inject({ method: "POST", url: "/api/operations", headers: { authorization: "Bearer user-jwt" }, payload: {} });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "KORTEX_AUTH_NOT_CONFIGURED" });
    expect(create).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects an invalid JWT before reading the submitted operation", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    const response = await (await server()).inject({ method: "POST", url: "/api/operations", headers: { authorization: "Bearer rejected-jwt" }, payload: {} });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "KORTEX_SESSION_INVALID" });
    expect(getUser).toHaveBeenCalledWith("rejected-jwt");
    expect(create).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
  });

  it("accepts the verified session and then validates the operation payload", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-test" } }, error: null });
    const response = await (await server()).inject({ method: "POST", url: "/api/operations", headers: { authorization: "Bearer current-jwt" }, payload: {} });
    expect(getUser).toHaveBeenCalledWith("current-jwt");
    expect(response.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("does not label an unavailable authentication service as an expired password", async () => {
    getUser.mockRejectedValue(new Error("synthetic upstream failure"));
    const response = await (await server()).inject({ method: "POST", url: "/api/operations", headers: { authorization: "Bearer current-jwt" }, payload: {} });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "KORTEX_AUTH_UNAVAILABLE" });
    expect(JSON.stringify(response.json())).not.toContain("synthetic upstream failure");
    expect(create).not.toHaveBeenCalled();
  });
});
