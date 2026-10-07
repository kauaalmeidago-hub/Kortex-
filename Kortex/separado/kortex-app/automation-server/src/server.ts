import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AutomationConfig } from "./config.js";
import type { OperationRepository } from "./db/OperationRepository.js";
import type { OperationEventBus } from "./events/EventBus.js";
import type { OperationQueue } from "./queue/OperationQueue.js";
import type { CreateOperationRequest, OperationRecord, OperationType, PortalName } from "./types.js";
import { containsSensitiveKey, redact } from "./security/redaction.js";
import type { AutomationOperationRepository } from "./repositories/AutomationOperationRepository.js";
import type { CredentialResolver } from "./credentials/CredentialResolver.js";
import { CreateOperationSchema, validatePayload } from "./validation/operationSchemas.js";

interface ServerDeps {
  config: AutomationConfig;
  repository: AutomationOperationRepository;
  eventBus: OperationEventBus;
  queue: OperationQueue;
  credentialResolver: CredentialResolver;
}

const operationTypes: OperationType[] = [
  "CARD_ISSUE",
  "INCLUSION_HOLDER",
  "INCLUSION_DEPENDENT",
  "EXCLUSION_HOLDER",
  "EXCLUSION_DEPENDENT",
];

function isOperationType(value: unknown): value is OperationType {
  return typeof value === "string" && operationTypes.includes(value as OperationType);
}

function isPortal(value: unknown): value is PortalName {
  return value === "hapvida" || value === "ndi";
}

function readBearerToken(header: string | undefined) {
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : undefined;
}

function safeTokenEquals(received: string | undefined, expected: string) {
  if (!received) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

function validateCreateOperation(body: unknown): CreateOperationRequest {
  const parsed = CreateOperationSchema.parse(body);
  const input = validatePayload(parsed.type, parsed.input);
  if (containsSensitiveKey(input)) throw new Error("input contem chave sensivel.");
  if (!isOperationType(parsed.type)) throw new Error("Tipo de operacao invalido.");
  if (!isPortal(parsed.portal)) throw new Error("portal invalido.");
  return { ...parsed, input };
}

function disabledWorkflowMessage(config: AutomationConfig, type: OperationType) {
  if (type === "CARD_ISSUE" && !config.features.cardIssue) return "FEATURE_KOA_CARD_ISSUE=false";
  if ((type === "INCLUSION_HOLDER" || type === "INCLUSION_DEPENDENT") && !config.features.inclusion) {
    return "FEATURE_KOA_INCLUSION=false";
  }
  if ((type === "EXCLUSION_HOLDER" || type === "EXCLUSION_DEPENDENT") && !config.features.exclusion) {
    return "FEATURE_KOA_EXCLUSION=false";
  }
  return undefined;
}

function operationResponse(operation: OperationRecord) {
  return redact({
    operationId: operation.id,
    status: operation.status,
    type: operation.type,
    companyId: operation.companyId,
    portal: operation.portal,
    input: operation.input,
    currentStep: operation.currentStep,
    result: operation.result,
    error: operation.error,
    artifacts: operation.artifacts.map((artifact) => ({
      id: artifact.id,
      fileName: artifact.fileName,
      mimeType: artifact.mimeType,
      kind: artifact.kind,
      createdAt: artifact.createdAt,
      url: `/api/operations/${operation.id}/artifacts/${encodeURIComponent(artifact.fileName)}`,
    })),
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    finishedAt: operation.finishedAt,
  });
}

export async function createServer({ config, repository, eventBus, queue, credentialResolver }: ServerDeps) {
  const app = fastify({ logger: false });
  const authClient: SupabaseClient | undefined =
    config.supabaseUrl && config.supabaseServiceRoleKey
      ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : undefined;

  await app.register(cors, {
    origin: [/^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/localhost:\d+$/],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-koa-automation-token"],
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health" || request.url === "/ready") return;

    const headerToken = request.headers["x-koa-automation-token"];
    const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
    const bearer = readBearerToken(request.headers.authorization);
    const queryToken = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`).searchParams.get("token") ?? undefined;

    if (safeTokenEquals(token ?? bearer ?? queryToken, config.apiToken)) {
      return;
    }

    const jwt = bearer ?? queryToken;
    if (jwt && authClient) {
      const { data, error } = await authClient.auth.getUser(jwt);
      if (!error && data.user) {
        (request as FastifyRequest & { userId?: string }).userId = data.user.id;
        return;
      }
    }

    return reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async () => ({
    database: "ok",
    storage: config.supabaseUrl && config.supabaseServiceRoleKey ? "ok" : "local",
    secrets: config.secretProviderMode === "remote" ? "remote" : "configured",
    worker: "ok",
  }));

  app.post("/api/operations", async (request, reply) => {
    let payload: CreateOperationRequest;
    try {
      payload = validateCreateOperation(request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Body invalido." });
    }

    const requestUserId = (request as FastifyRequest & { userId?: string }).userId;
    payload.requestedBy ??= requestUserId;

    const disabledReason = disabledWorkflowMessage(config, payload.type);
    if (disabledReason) {
      return reply.code(409).send({
        error: "workflow_disabled",
        details: `${payload.type} ainda nao esta habilitado para automacao real. ${disabledReason}`,
      });
    }

    if (config.repositoryMode === "postgres" && (!payload.workspaceId || !payload.requestedBy)) {
      return reply.code(400).send({ error: "workspaceId e requestedBy sao obrigatorios no modo Postgres." });
    }

    const resolvedCredential = await credentialResolver.resolve({
      companyId: payload.companyId,
      operator: payload.operator ?? payload.portal,
      credentialRef: payload.credentialRef,
    });

    const now = new Date().toISOString();
    const operation: OperationRecord = {
      id: crypto.randomUUID(),
      type: payload.type,
      status: "queued",
      workspaceId: payload.workspaceId,
      companyId: payload.companyId,
      portal: payload.portal,
      requestedBy: payload.requestedBy,
      credentialId: resolvedCredential.credentialId,
      credentialRef: resolvedCredential.credentialRef,
      input: payload.input ?? {},
      artifacts: [],
      createdAt: now,
      updatedAt: now,
    };

    await repository.create(operation);
    const event = await repository.appendEvent({
      operationId: operation.id,
      type: "operation.status",
      status: "queued",
      step: "Operacao recebida",
      createdAt: now,
    });
    eventBus.publish(event);
    if (config.repositoryMode === "sqlite") {
      queue.enqueue(operation.id);
    }

    return reply.code(202).send(operationResponse(operation));
  });

  app.get<{ Params: { id: string } }>("/api/operations/:id", async (request, reply) => {
    const operation = await repository.get(request.params.id);
    if (!operation) return reply.code(404).send({ error: "operation_not_found" });
    return operationResponse(operation);
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/api/operations/:id/events", async (request, reply) => {
    const operation = await repository.get(request.params.id);
    if (!operation) return reply.code(404).send({ error: "operation_not_found" });

    setupSse(reply);
    const afterId = Number(request.query.after ?? 0);

    for (const event of await repository.getEvents(operation.id, Number.isFinite(afterId) ? afterId : 0)) {
      writeSse(reply, event);
    }

    const unsubscribe = eventBus.subscribe(operation.id, (event) => writeSse(reply, event));
    const keepAlive = setInterval(() => {
      reply.raw.write(": keep-alive\n\n");
    }, 15000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.post<{ Params: { id: string } }>("/api/operations/:id/cancel", async (request, reply) => {
    const result = await queue.cancel(request.params.id);
    if (!result.ok && result.reason === "not_found") return reply.code(404).send({ error: "operation_not_found" });
    if (!result.ok) return reply.code(409).send({ error: result.reason, operation: result.operation ? operationResponse(result.operation) : undefined });

    const operation = await repository.get(request.params.id);
    return reply.send(operation ? operationResponse(operation) : { ok: true });
  });

  app.get<{ Params: { id: string; fileName: string } }>("/api/operations/:id/artifacts/:fileName", async (request, reply) => {
    const operation = await repository.get(request.params.id);
    if (!operation) return reply.code(404).send({ error: "operation_not_found" });

    const fileName = path.basename(decodeURIComponent(request.params.fileName));
    const artifact = operation.artifacts.find((item) => item.fileName === fileName);
    if (!artifact || !existsSync(artifact.path)) return reply.code(404).send({ error: "artifact_not_found" });

    return reply.header("content-type", artifact.mimeType ?? "application/octet-stream").send(createReadStream(artifact.path));
  });

  return app;
}

function setupSse(reply: FastifyReply) {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

function writeSse(reply: FastifyReply, event: unknown) {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}
