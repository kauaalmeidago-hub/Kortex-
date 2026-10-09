import pg from "pg";
import type {
  OperationArtifact,
  OperationError,
  OperationEvent,
  OperationRecord,
  OperationResult,
  OperationStatus,
  OperationType,
  PortalName,
} from "../types.js";
import type { PersistentAutomationQueueRepository } from "./AutomationOperationRepository.js";
import { redact } from "../security/redaction.js";

const { Pool } = pg;

type OperationRow = {
  id: string;
  operation_type: OperationType;
  status: OperationStatus;
  workspace_id: string;
  company_id: string;
  requested_by: string;
  credential_id: string | null;
  operator: PortalName;
  credential_ref: string;
  payload: Record<string, unknown>;
  result: OperationResult | null;
  error_code: string | null;
  error_message: string | null;
  current_step: string | null;
  progress_metadata: Record<string, unknown>;
  cancel_requested_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
};

type ArtifactRow = {
  id: string;
  operation_id: string;
  type: string;
  storage_provider: string;
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | string | null;
  checksum: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
};

type EventRow = {
  id: string;
  operation_id: string;
  event_type: OperationEvent["type"];
  step: string | null;
  message: string | null;
  payload: Record<string, unknown> | null;
  created_at: Date | string;
};

function toIso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function isTerminalStatus(status: OperationStatus) {
  return (
    status === "success" ||
    status === "error" ||
    status === "cancelled" ||
    status === "manual_review" ||
    status === "awaiting_human_verification" ||
    status === "awaiting_confirmation" ||
    status === "submission_confirmed"
  );
}

export const UPDATE_OPERATION_SQL = `UPDATE public.automation_operations
       SET status = $2::public.automation_operation_status,
           current_step = $3,
           result = $4::jsonb,
           error_code = $5,
           error_message = $6,
           worker_id = CASE
             WHEN $2::public.automation_operation_status = 'queued'::public.automation_operation_status
             THEN NULL
             ELSE worker_id
           END,
           lease_expires_at = CASE
             WHEN $2::public.automation_operation_status = 'queued'::public.automation_operation_status
             THEN NULL
             ELSE lease_expires_at
           END,
           attempt = CASE
             WHEN $2::public.automation_operation_status = 'queued'::public.automation_operation_status
              AND status = 'awaiting_authentication'::public.automation_operation_status
             THEN 0
             ELSE attempt
           END,
           updated_at = $7,
           finished_at = $8,
           credential_ref = $9,
           credential_id = $10,
           payload = $11::jsonb,
           operator = $12
       WHERE id = $1
       RETURNING *`;

export const SET_OPERATION_STATUS_SQL = `UPDATE public.automation_operations
       SET status = $2::public.automation_operation_status,
           current_step = $3,
           worker_id = CASE
             WHEN $2::public.automation_operation_status = 'awaiting_authentication'::public.automation_operation_status
             THEN NULL
             ELSE COALESCE($4, worker_id)
           END,
           lease_expires_at = CASE
             WHEN $2::public.automation_operation_status = 'awaiting_authentication'::public.automation_operation_status
             THEN NULL
             ELSE lease_expires_at
           END,
           attempt = CASE
             WHEN $2::public.automation_operation_status = 'awaiting_authentication'::public.automation_operation_status
             THEN GREATEST(attempt - 1, 0)
             ELSE attempt
           END,
           error_code = CASE
             WHEN $2::public.automation_operation_status IN (
               'error'::public.automation_operation_status,
               'manual_review'::public.automation_operation_status
             )
             THEN error_code
             ELSE NULL
           END,
           error_message = CASE
             WHEN $2::public.automation_operation_status IN (
               'error'::public.automation_operation_status,
               'manual_review'::public.automation_operation_status
             )
             THEN error_message
             ELSE NULL
           END,
           updated_at = now(),
           finished_at = CASE
             WHEN $2::public.automation_operation_status IN (
               'success'::public.automation_operation_status,
               'error'::public.automation_operation_status,
               'cancelled'::public.automation_operation_status,
               'manual_review'::public.automation_operation_status,
               'awaiting_human_verification'::public.automation_operation_status,
               'awaiting_confirmation'::public.automation_operation_status,
               'submission_confirmed'::public.automation_operation_status
             )
             THEN now()
             ELSE NULL
           END
       WHERE id = $1
       RETURNING *`;

export class PostgresOperationRepository implements PersistentAutomationQueueRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 8,
      connectionTimeoutMillis: 10_000,
      query_timeout: 15_000,
      application_name: "kortex-automation-server",
    });
    // pg removes the failed idle client; the next query creates a fresh connection.
    this.pool.on("error", () => { console.warn("Koa: conexao ociosa com o banco foi interrompida; reconexao automatica ativa."); });
  }

  async close() {
    await this.pool.end();
  }

  async create(record: OperationRecord) {
    const result = await this.pool.query<OperationRow>(
      `INSERT INTO public.automation_operations (
        id, workspace_id, company_id, requested_by, credential_id, operator,
        operation_type, status, credential_ref, payload, result,
        error_code, error_message, current_step, progress_metadata,
        created_at, updated_at, finished_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10::jsonb, $11::jsonb,
        $12, $13, $14, $15::jsonb,
        $16, $17, $18
      ) RETURNING *`,
      [
        record.id,
        record.workspaceId,
        record.companyId,
        record.requestedBy,
        record.credentialId ?? null,
        record.portal,
        record.type,
        record.status,
        record.credentialRef,
        JSON.stringify(redact(record.input)),
        record.result ? JSON.stringify(redact(record.result)) : null,
        record.error?.code ?? null,
        record.error?.message ?? null,
        record.currentStep ?? null,
        JSON.stringify({}),
        record.createdAt,
        record.updatedAt,
        record.finishedAt ?? null,
      ],
    );

    return this.toOperation(result.rows[0]);
  }

  async get(id: string) {
    const result = await this.pool.query<OperationRow>("SELECT * FROM public.automation_operations WHERE id = $1", [id]);
    if (!result.rows[0]) return undefined;
    return this.toOperation(result.rows[0], await this.getArtifacts(id));
  }

  async update(
    id: string,
    patch: Partial<{
      portal: OperationRecord["portal"];
      status: OperationStatus;
      currentStep: string;
      result: OperationResult;
      error: OperationError;
      artifacts: OperationArtifact[];
      finishedAt: string;
      updatedAt: string;
      credentialRef: string;
      credentialId: string | undefined;
      input: Record<string, unknown>;
    }>,
  ) {
    const current = await this.get(id);
    if (!current) return undefined;

    const nextStatus = patch.status ?? current.status;
    const shouldClearError = !patch.error && nextStatus !== "error" && nextStatus !== "manual_review";
    const nextFinishedAt =
      patch.finishedAt !== undefined ? patch.finishedAt : patch.status && !isTerminalStatus(nextStatus) ? null : current.finishedAt ?? null;

    const result = await this.pool.query<OperationRow>(
      UPDATE_OPERATION_SQL,
      [
        id,
        nextStatus,
        patch.currentStep ?? current.currentStep ?? null,
        patch.result ? JSON.stringify(redact(patch.result)) : current.result ? JSON.stringify(redact(current.result)) : null,
        shouldClearError ? null : patch.error?.code ?? current.error?.code ?? null,
        shouldClearError ? null : patch.error?.message ?? current.error?.message ?? null,
        patch.updatedAt ?? new Date().toISOString(),
        nextFinishedAt,
        patch.credentialRef ?? current.credentialRef,
        "credentialId" in patch ? patch.credentialId ?? null : current.credentialId ?? null,
        JSON.stringify(redact(patch.input ?? current.input)),
        patch.portal ?? current.portal,
      ],
    );

    if (patch.artifacts?.length) {
      await this.replaceArtifacts(id, patch.artifacts);
    }

    return this.toOperation(result.rows[0], patch.artifacts ?? current.artifacts);
  }

  async appendEvent(event: OperationEvent) {
    const result = await this.pool.query<EventRow>(
      `INSERT INTO public.automation_events (operation_id, event_type, step, message, payload, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING *`,
      [
        event.operationId,
        event.type,
        event.step ?? null,
        event.data?.message ? String(event.data.message) : null,
        event.data ? JSON.stringify(redact(event.data)) : "{}",
        event.createdAt,
      ],
    );

    const row = result.rows[0];
    if (!row) throw new Error("Failed to append automation event.");
    return this.toEvent(row);
  }

  async getEvents(operationId: string, afterId = 0) {
    const result = await this.pool.query<EventRow>(
      `SELECT * FROM public.automation_events
       WHERE operation_id = $1
         AND created_at > COALESCE((SELECT created_at FROM public.automation_events WHERE id::text = $2 LIMIT 1), '-infinity'::timestamptz)
       ORDER BY created_at ASC`,
      [operationId, String(afterId)],
    );

    return result.rows.map((row) => this.toEvent(row));
  }

  async confirmCardDependents(id: string, confirmationId: string, decision: "with" | "without", approvedBy: string) {
    const result = await this.pool.query<OperationRow>(`UPDATE public.automation_operations
      SET status = 'queued'::public.automation_operation_status, current_step = 'card_dependents_confirmed',
          result = jsonb_set(result, '{cardDependentConfirmation}', (result->'cardDependentConfirmation') ||
            jsonb_build_object('decision', $3::text, 'approvedBy', $4::text, 'approvedAt', now())),
          error_code = NULL, error_message = NULL, finished_at = NULL, updated_at = now(),
          worker_id = NULL, lease_expires_at = NULL, attempt = GREATEST(attempt - 1, 0)
      WHERE id = $1 AND operation_type = 'CARD_ISSUE' AND status = 'awaiting_confirmation'
        AND cancel_requested_at IS NULL
        AND result->'cardDependentConfirmation'->>'id' = $2
        AND result->'cardDependentConfirmation'->>'decision' IS NULL
      RETURNING *`, [id, confirmationId, decision, approvedBy]);
    const row = result.rows[0];
    return row ? this.toOperation(row, await this.getArtifacts(id)) : undefined;
  }

  async confirmCardBeneficiary(id: string, confirmationId: string, optionId: string, approvedBy: string) {
    const result = await this.pool.query<OperationRow>(`UPDATE public.automation_operations
      SET status = 'queued'::public.automation_operation_status, current_step = 'card_beneficiary_confirmed',
          result = jsonb_set(result, '{cardBeneficiaryConfirmation}', (result->'cardBeneficiaryConfirmation') ||
            jsonb_build_object('selectedOptionId', $3::text, 'approvedBy', $4::text, 'approvedAt', now())),
          error_code = NULL, error_message = NULL, finished_at = NULL, updated_at = now(),
          worker_id = NULL, lease_expires_at = NULL, attempt = GREATEST(attempt - 1, 0)
      WHERE id = $1 AND operation_type = 'CARD_ISSUE' AND status = 'awaiting_confirmation'
        AND cancel_requested_at IS NULL
        AND result->'cardBeneficiaryConfirmation'->>'id' = $2
        AND result->'cardBeneficiaryConfirmation'->>'selectedOptionId' IS NULL
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(result->'cardBeneficiaryConfirmation'->'options') AS option
          WHERE option->>'id' = $3)
      RETURNING *`, [id, confirmationId, optionId, approvedBy]);
    const row = result.rows[0];
    return row ? this.toOperation(row, await this.getArtifacts(id)) : undefined;
  }

  async claimNext(workerId: string, leaseSeconds: number) {
    const result = await this.pool.query<OperationRow>("SELECT * FROM public.claim_next_automation_operation($1, $2)", [
      workerId,
      leaseSeconds,
    ]);

    const row = result.rows[0];
    return row?.id ? this.toOperation(row) : undefined;
  }

  async renewLease(operationId: string, workerId: string, leaseSeconds: number) {
    const result = await this.pool.query<{ renew_automation_operation_lease: boolean }>(
      "SELECT public.renew_automation_operation_lease($1, $2, $3)",
      [operationId, workerId, leaseSeconds],
    );
    return Boolean(result.rows[0]?.renew_automation_operation_lease);
  }

  async requestCancel(operationId: string, userId?: string) {
    const result = await this.pool.query<OperationRow>(
      `UPDATE public.automation_operations
       SET cancel_requested_at = now(),
           status = CASE
             WHEN status IN ('awaiting_confirmation', 'awaiting_human_verification', 'awaiting_authentication')
             THEN 'cancelled'::public.automation_operation_status
             WHEN status IN (
               'queued',
               'starting',
               'authenticating',
               'accessing_portal',
               'checking_active_users',
               'checking_cns',
               'checking_cpf',
               'awaiting_authentication',
               'awaiting_human_verification',
               'generating_cpf_document',
               'validating_documents',
               'opening_inclusion',
               'filling_registration',
               'selecting_plan',
               'uploading_documents',
               'filling_health_questionnaire',
               'processing',
               'submitting',
               'checking_movement_status',
               'capturing_evidence',
               'verifying'
             )
             THEN 'cancelling'::public.automation_operation_status
             ELSE status
           END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [operationId],
    );

    const row = result.rows[0];
    if (!row) return undefined;

    await this.appendEvent({
      operationId,
      type: "operation.cancel_requested",
      status: row.status,
      step: "cancel_requested",
      data: userId ? { userId } : undefined,
      createdAt: new Date().toISOString(),
    });

    return this.toOperation(row);
  }

  async acquireLock(lockKey: string, operationId: string, workerId: string, ttlSeconds: number) {
    const result = await this.pool.query<{ acquire_automation_lock: boolean }>(
      "SELECT public.acquire_automation_lock($1, $2, $3, $4)",
      [lockKey, operationId, workerId, ttlSeconds],
    );
    return Boolean(result.rows[0]?.acquire_automation_lock);
  }

  async releaseLock(lockKey: string, operationId: string, workerId: string) {
    const result = await this.pool.query<{ release_automation_lock: boolean }>(
      "SELECT public.release_automation_lock($1, $2, $3)",
      [lockKey, operationId, workerId],
    );
    return Boolean(result.rows[0]?.release_automation_lock);
  }

  async markStaleOperationsForReview() {
    const result = await this.pool.query<{ mark_stale_automation_operations_for_review: number }>(
      "SELECT public.mark_stale_automation_operations_for_review()",
    );
    return Number(result.rows[0]?.mark_stale_automation_operations_for_review ?? 0);
  }

  async upsertWorkerHeartbeat(workerId: string, status: "online" | "draining" | "offline", metadata: Record<string, unknown> = {}) {
    await this.pool.query(
      `INSERT INTO public.automation_workers (id, hostname, version, status, last_heartbeat_at, started_at, metadata)
       VALUES ($1, $2, $3, $4::public.automation_worker_status, now(), now(), $5::jsonb)
       ON CONFLICT (id) DO UPDATE
       SET hostname = EXCLUDED.hostname,
           version = EXCLUDED.version,
           status = EXCLUDED.status,
           last_heartbeat_at = now(),
           metadata = EXCLUDED.metadata`,
      [
        workerId,
        process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "unknown",
        process.env.npm_package_version ?? "0.1.0",
        status,
        JSON.stringify(redact(metadata)),
      ],
    );
  }

  async markWorkerOffline(workerId: string) {
    await this.upsertWorkerHeartbeat(workerId, "offline", { stoppedAt: new Date().toISOString() });
  }

  async setStatus(operationId: string, status: OperationStatus, step: string, workerId?: string) {
    const result = await this.pool.query<OperationRow>(
      SET_OPERATION_STATUS_SQL,
      [operationId, status, step, workerId ?? null],
    );

    return result.rows[0] ? this.toOperation(result.rows[0]) : undefined;
  }

  private async replaceArtifacts(operationId: string, artifacts: OperationArtifact[]) {
    for (const artifact of artifacts) {
      await this.pool.query(
        `INSERT INTO public.automation_artifacts (
          id, operation_id, type, storage_provider, bucket, storage_path,
          file_name, mime_type, size_bytes, checksum, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
        ON CONFLICT (id) DO NOTHING`,
        [
          artifact.id,
          operationId,
          this.toArtifactType(artifact),
          artifact.storageProvider ?? "local",
          artifact.bucket ?? "local",
          artifact.storagePath ?? artifact.path,
          artifact.fileName,
          artifact.mimeType ?? null,
          artifact.sizeBytes ?? null,
          artifact.checksum ?? null,
          JSON.stringify(redact(artifact.metadata ?? {})),
          artifact.createdAt,
        ],
      );
    }
  }

  private async getArtifacts(operationId: string): Promise<OperationArtifact[]> {
    const result = await this.pool.query<ArtifactRow>(
      `SELECT *
       FROM public.automation_artifacts
       WHERE operation_id = $1
       ORDER BY created_at ASC`,
      [operationId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      path: row.storage_path,
      storageProvider: row.storage_provider,
      bucket: row.bucket,
      storagePath: row.storage_path,
      mimeType: row.mime_type ?? undefined,
      sizeBytes: row.size_bytes == null ? undefined : Number(row.size_bytes),
      checksum: row.checksum ?? undefined,
      kind:
        row.type === "screenshot" || row.type === "status_screenshot" || row.type === "movement_status_evidence"
          ? "screenshot"
          : row.type === "document"
            ? "download"
            : "pdf",
      artifactType: row.type as OperationArtifact["artifactType"],
      metadata: row.metadata ?? undefined,
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    }));
  }

  private toArtifactType(artifact: OperationArtifact) {
    if (artifact.artifactType) return artifact.artifactType;
    if (artifact.kind === "pdf") return "card_pdf";
    if (artifact.kind === "screenshot") return "screenshot";
    if (artifact.kind === "download") return "document";
    return "document";
  }

  private toOperation(row: OperationRow | undefined, artifacts: OperationArtifact[] = []): OperationRecord {
    if (!row) {
      throw new Error("Operation row is required.");
    }

    return {
      id: row.id,
      type: row.operation_type,
      status: row.status,
      workspaceId: row.workspace_id,
      companyId: row.company_id,
      requestedBy: row.requested_by,
      credentialId: row.credential_id ?? undefined,
      portal: row.operator,
      credentialRef: row.credential_ref,
      input: row.payload ?? {},
      currentStep: row.current_step ?? undefined,
      result: row.result ?? undefined,
      error: row.error_code
        ? {
            code: row.error_code,
            message: row.error_message ?? "Erro na automacao.",
          }
        : undefined,
      artifacts,
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
      updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
      finishedAt: toIso(row.finished_at),
      cancelRequestedAt: toIso(row.cancel_requested_at),
    };
  }

  private toEvent(row: EventRow): OperationEvent {
    return {
      id: row.id,
      operationId: row.operation_id,
      type: row.event_type,
      step: row.step ?? undefined,
      data: row.payload ?? undefined,
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    };
  }
}

