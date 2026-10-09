import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  OperationArtifact,
  OperationError,
  OperationEvent,
  OperationRecord,
  OperationResult,
  OperationStatus,
} from "../types.js";
import { redact } from "../security/redaction.js";
import type { AutomationOperationRepository } from "../repositories/AutomationOperationRepository.js";

type OperationRow = {
  id: string;
  type: OperationRecord["type"];
  status: OperationStatus;
  company_id: string;
  portal: OperationRecord["portal"];
  credential_ref: string;
  input_json: string;
  current_step: string | null;
  result_json: string | null;
  error_json: string | null;
  artifacts_json: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

type EventRow = {
  id: number;
  operation_id: string;
  type: OperationEvent["type"];
  status: OperationStatus | null;
  step: string | null;
  data_json: string | null;
  created_at: string;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(value) as T;
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

export class OperationRepository implements AutomationOperationRepository {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  create(record: OperationRecord) {
    this.db
      .prepare(
        `INSERT INTO operations (
          id, type, status, company_id, portal, credential_ref, input_json,
          current_step, result_json, error_json, artifacts_json, created_at,
          updated_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.type,
        record.status,
        record.companyId,
        record.portal,
        record.credentialRef,
        JSON.stringify(redact(record.input)),
        record.currentStep ?? null,
        record.result ? JSON.stringify(redact(record.result)) : null,
        record.error ? JSON.stringify(redact(record.error)) : null,
        JSON.stringify(record.artifacts),
        record.createdAt,
        record.updatedAt,
        record.finishedAt ?? null,
      );

    return record;
  }

  get(id: string) {
    const row = this.db.prepare("SELECT * FROM operations WHERE id = ?").get(id) as OperationRow | undefined;
    return row ? this.toOperation(row) : undefined;
  }

  update(
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
    const current = this.get(id);
    if (!current) return undefined;

    const nextStatus = patch.status ?? current.status;
    const shouldClearError = !patch.error && nextStatus !== "error" && nextStatus !== "manual_review";

    const next: OperationRecord = {
      ...current,
      portal: patch.portal ?? current.portal,
      credentialRef: patch.credentialRef ?? current.credentialRef,
      input: patch.input ?? current.input,
      status: nextStatus,
      currentStep: patch.currentStep ?? current.currentStep,
      result: patch.result ?? current.result,
      error: shouldClearError ? undefined : patch.error ?? current.error,
      artifacts: patch.artifacts ?? current.artifacts,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
      finishedAt: patch.finishedAt ?? (patch.status && !isTerminalStatus(nextStatus) ? undefined : current.finishedAt),
    };

    this.db
      .prepare(
        `UPDATE operations
         SET status = ?, current_step = ?, result_json = ?, error_json = ?,
             artifacts_json = ?, updated_at = ?, finished_at = ?, credential_ref = ?, input_json = ?, portal = ?
         WHERE id = ?`,
      )
      .run(
        next.status,
        next.currentStep ?? null,
        next.result ? JSON.stringify(redact(next.result)) : null,
        next.error ? JSON.stringify(redact(next.error)) : null,
        JSON.stringify(next.artifacts),
        next.updatedAt,
        next.finishedAt ?? null,
        next.credentialRef,
        JSON.stringify(redact(next.input)),
        next.portal,
        id,
      );

    return next;
  }

  confirmCardDependents(id: string, confirmationId: string, decision: "with" | "without", approvedBy: string) {
    const result = this.db.prepare(`UPDATE operations SET status = 'queued', current_step = 'card_dependents_confirmed',
      result_json = json_set(result_json, '$.cardDependentConfirmation.decision', ?, '$.cardDependentConfirmation.approvedBy', ?,
        '$.cardDependentConfirmation.approvedAt', ?), updated_at = ?, finished_at = NULL, error_json = NULL
      WHERE id = ? AND type = 'CARD_ISSUE' AND status = 'awaiting_confirmation'
        AND json_extract(result_json, '$.cardDependentConfirmation.id') = ?
        AND json_extract(result_json, '$.cardDependentConfirmation.decision') IS NULL`)
      .run(decision, approvedBy, new Date().toISOString(), new Date().toISOString(), id, confirmationId);
    return result.changes ? this.get(id) : undefined;
  }

  appendEvent(event: OperationEvent) {
    const result = this.db
      .prepare(
        `INSERT INTO operation_events (operation_id, type, status, step, data_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.operationId,
        event.type,
        event.status ?? null,
        event.step ?? null,
        event.data ? JSON.stringify(redact(event.data)) : null,
        event.createdAt,
      );

    return {
      ...event,
      id: Number(result.lastInsertRowid),
    };
  }

  getEvents(operationId: string, afterId = 0) {
    const rows = this.db
      .prepare("SELECT * FROM operation_events WHERE operation_id = ? AND id > ? ORDER BY id ASC")
      .all(operationId, afterId) as EventRow[];

    return rows.map((row) => this.toEvent(row));
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        company_id TEXT NOT NULL,
        portal TEXT NOT NULL,
        credential_ref TEXT NOT NULL,
        input_json TEXT NOT NULL,
        current_step TEXT,
        result_json TEXT,
        error_json TEXT,
        artifacts_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS operation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT,
        step TEXT,
        data_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(operation_id) REFERENCES operations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_operation_events_operation_id
      ON operation_events(operation_id, id);
    `);
  }

  private toOperation(row: OperationRow): OperationRecord {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      companyId: row.company_id,
      portal: row.portal,
      credentialRef: row.credential_ref,
      input: parseJson(row.input_json, {}),
      currentStep: row.current_step ?? undefined,
      result: parseJson<OperationResult | undefined>(row.result_json, undefined),
      error: parseJson<OperationError | undefined>(row.error_json, undefined),
      artifacts: parseJson<OperationArtifact[]>(row.artifacts_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at ?? undefined,
    };
  }

  private toEvent(row: EventRow): OperationEvent {
    return {
      id: row.id,
      operationId: row.operation_id,
      type: row.type,
      status: row.status ?? undefined,
      step: row.step ?? undefined,
      data: parseJson<Record<string, unknown> | undefined>(row.data_json, undefined),
      createdAt: row.created_at,
    };
  }
}

