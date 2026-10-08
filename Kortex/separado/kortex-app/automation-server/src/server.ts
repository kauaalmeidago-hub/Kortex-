import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AutomationConfig } from "./config.js";
import type { OperationRepository } from "./db/OperationRepository.js";
import type { OperationEventBus } from "./events/EventBus.js";
import type { OperationQueue } from "./queue/OperationQueue.js";
import type { CreateOperationRequest, OperationRecord, OperationType, PortalName } from "./types.js";
import { containsSensitiveKey, redact } from "./security/redaction.js";
import type { AutomationOperationRepository } from "./repositories/AutomationOperationRepository.js";
import type { CredentialResolver } from "./credentials/CredentialResolver.js";
import { CreateOperationSchema, validatePayload } from "./validation/operationSchemas.js";
import { sanitizeDiagnosticText } from "./security/redaction.js";
import type { EphemeralCredentialStore } from "./secrets/EphemeralCredentialStore.js";
import { authenticationAttemptLimitError, countAuthenticationFailures } from "./authentication/AuthenticationAttemptPolicy.js";

interface ServerDeps {
  config: AutomationConfig;
  repository: AutomationOperationRepository;
  eventBus: OperationEventBus;
  queue: OperationQueue;
  credentialResolver: CredentialResolver;
  ephemeralCredentialStore?: EphemeralCredentialStore;
}

const operationTypes: OperationType[] = [
  "CARD_ISSUE",
  "INCLUSION_HOLDER",
  "INCLUSION_DEPENDENT",
  "EXCLUSION_HOLDER",
  "EXCLUSION_DEPENDENT",
];

const SubmitOperationAuthenticationSchema = z
  .object({
    companyCode: z.string().trim().min(1).optional(),
    password: z.string().min(1),
    rememberOnDevice: z.boolean().default(false),
  })
  .strict();

function isOperationType(value: unknown): value is OperationType {
  return typeof value === "string" && operationTypes.includes(value as OperationType);
}

function isPortal(value: unknown): value is PortalName {
  return value === "hapvida" || value === "ndi";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function companyCodeFor(operation: OperationRecord, input: { companyCode?: string }) {
  return input.companyCode?.trim() || readString(operation.input.contractCode) || readString(operation.input.companyCode);
}

function credentialRefFor(operation: OperationRecord) {
  return operation.credentialRef || `${operation.portal}:${operation.companyId}`;
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
  if (type === "INCLUSION_HOLDER" && !config.features.inclusion && !config.features.inclusionPreview) {
    return "FEATURE_KOA_INCLUSION_PREVIEW=false";
  }
  if (type === "INCLUSION_DEPENDENT") {
    return "INCLUSION_DEPENDENT ainda nao esta mapeado para automacao real.";
  }
  if (type === "EXCLUSION_HOLDER" && !config.features.exclusion && !config.features.exclusionPreview) {
    return "FEATURE_KOA_EXCLUSION_PREVIEW=false";
  }
  if (type === "EXCLUSION_DEPENDENT") {
    return "EXCLUSION_DEPENDENT ainda nao esta mapeado para automacao real.";
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
      kind: artifact.artifactType ?? artifact.kind,
      createdAt: artifact.createdAt,
      url: `/api/operations/${operation.id}/artifacts/${encodeURIComponent(artifact.fileName)}`,
    })),
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    finishedAt: operation.finishedAt,
  });
}

export async function createServer({ config, repository, eventBus, queue, credentialResolver, ephemeralCredentialStore }: ServerDeps) {
  const app = fastify({ logger: false });
  const reauthInFlight = new Set<string>();
  const authClient: SupabaseClient | undefined =
    config.supabaseUrl && config.supabaseSecretKey
      ? createClient(config.supabaseUrl, config.supabaseSecretKey, {
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
    storage: config.supabaseUrl && config.supabaseSecretKey ? "ok" : "local",
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
    payload.requestedBy ??= requestUserId ?? config.defaultRequestedBy;

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

  app.post<{ Params: { id: string } }>("/api/operations/:id/reauth", async (request, reply) => {
    const parsed = SubmitOperationAuthenticationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "INVALID_AUTHENTICATION_PAYLOAD" });
    }

    const operation = await repository.get(request.params.id);
    if (!operation) return reply.code(404).send({ ok: false, error: "operation_not_found" });
    if (operation.type !== "CARD_ISSUE") return reply.code(409).send({ ok: false, error: "AUTHENTICATION_NOT_SUPPORTED" });
    if (operation.status !== "awaiting_authentication") {
      return reply.code(409).send({ ok: false, error: "OPERATION_NOT_AWAITING_AUTHENTICATION", operation: operationResponse(operation) });
    }

    const requestUserId = (request as FastifyRequest & { userId?: string }).userId;
    if (requestUserId && operation.requestedBy && requestUserId !== operation.requestedBy) {
      return reply.code(403).send({ ok: false, error: "forbidden" });
    }

    if (reauthInFlight.has(operation.id)) {
      return reply.code(409).send({ ok: false, error: "AUTHENTICATION_ALREADY_IN_PROGRESS" });
    }

    if (!ephemeralCredentialStore) {
      return reply.code(503).send({ ok: false, error: "EPHEMERAL_CREDENTIAL_STORE_UNAVAILABLE", operation: operationResponse(operation) });
    }

    const companyCode = companyCodeFor(operation, parsed.data);
    if (!companyCode) {
      return reply.code(400).send({ ok: false, error: "COMPANY_CODE_REQUIRED", operation: operationResponse(operation) });
    }

    reauthInFlight.add(operation.id);
    let credentialGeneration: number | undefined;
    try {
      const latest = await repository.get(operation.id);
      if (latest?.status !== "awaiting_authentication") {
        return reply.code(409).send({ ok: false, error: "OPERATION_NOT_AWAITING_AUTHENTICATION" });
      }
      const failedAttempts = countAuthenticationFailures(await repository.getEvents(operation.id));
      if (failedAttempts >= config.authMaxAttempts) {
        ephemeralCredentialStore.clear(operation.id);
        const reviewed = await repository.update(operation.id, {
          status: "manual_review",
          currentStep: "authentication_attempts_exceeded",
          error: authenticationAttemptLimitError(),
          updatedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });
        return reply.code(429).send({
          ok: false,
          error: "AUTHENTICATION_ATTEMPTS_EXCEEDED",
          operation: reviewed ? operationResponse(reviewed) : undefined,
        });
      }
      credentialGeneration = ephemeralCredentialStore.put(
        operation.id,
        credentialRefFor(operation),
        {
          username: companyCode,
          password: parsed.data.password,
          metadata: { rememberOnDevice: parsed.data.rememberOnDevice, submittedAt: new Date().toISOString() },
        },
        config.authChallengeTtlMinutes * 60 * 1000,
      );

      const submitted = await repository.appendEvent({
        operationId: operation.id,
        type: "authentication.submitted",
        status: "awaiting_authentication",
        step: "authentication_submitted",
        data: { rememberOnDevice: parsed.data.rememberOnDevice, attemptNumber: failedAttempts + 1 },
        createdAt: new Date().toISOString(),
      });
      eventBus.publish(submitted);

      const resumed = await repository.update(operation.id, {
        status: "queued",
        currentStep: "authentication_submitted",
        updatedAt: new Date().toISOString(),
      });
      const queued = await repository.appendEvent({
        operationId: operation.id,
        type: "operation.queued",
        status: "queued",
        step: "authentication_submitted",
        data: { resumed: true },
        createdAt: new Date().toISOString(),
      });
      eventBus.publish(queued);

      if (config.repositoryMode === "sqlite") {
        queue.enqueue(operation.id);
      }

      return reply.send({
        ok: true,
        status: "queued",
        operationId: operation.id,
        operation: resumed ? operationResponse(resumed) : undefined,
      });
    } catch (error) {
      if (credentialGeneration !== undefined) ephemeralCredentialStore.clear(operation.id, credentialGeneration);
      const waiting = await repository.update(operation.id, {
        status: "awaiting_authentication",
        currentStep: "authentication_submit_failed",
        updatedAt: new Date().toISOString(),
      });
      return reply.send({
        ok: false,
        error: "DATABASE_OPERATION_UPDATE_FAILED",
        safeDetails: sanitizeDiagnosticText(error instanceof Error ? error.message : undefined),
        operation: waiting ? operationResponse(waiting) : undefined,
      });
    } finally {
      reauthInFlight.delete(operation.id);
    }
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

