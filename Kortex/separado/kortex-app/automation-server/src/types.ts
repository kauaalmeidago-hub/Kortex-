export type OperationType =
  | "CARD_ISSUE"
  | "INCLUSION_HOLDER"
  | "INCLUSION_DEPENDENT"
  | "EXCLUSION_HOLDER"
  | "EXCLUSION_DEPENDENT";

export type OperationStatus =
  | "queued"
  | "starting"
  | "authenticating"
  | "accessing_portal"
  | "processing"
  | "verifying"
  | "success"
  | "error"
  | "cancelling"
  | "cancelled"
  | "manual_review";

export type PortalName = "hapvida" | "ndi";

export interface PortalCredential {
  username: string;
  password: string;
  metadata?: Record<string, unknown>;
}

export interface OperationArtifact {
  id: string;
  fileName: string;
  path: string;
  mimeType?: string;
  kind: "pdf" | "screenshot" | "download" | "other";
  storageProvider?: string;
  bucket?: string;
  storagePath?: string;
  sizeBytes?: number;
  checksum?: string;
  createdAt: string;
}

export interface OperationError {
  code: string;
  message: string;
  safeDetails?: string;
  step?: string;
  retryable?: boolean;
}

export interface OperationResult {
  beneficiaryName?: string;
  portalStatus?: string;
  effectiveDate?: string;
  protocol?: string;
  [key: string]: unknown;
}

export interface CreateOperationRequest {
  type: OperationType;
  workspaceId?: string;
  companyId: string;
  portal: PortalName;
  requestedBy?: string;
  operator?: string;
  credentialRef?: string;
  input?: Record<string, unknown>;
}

export interface OperationRecord {
  id: string;
  type: OperationType;
  status: OperationStatus;
  workspaceId?: string;
  companyId: string;
  portal: PortalName;
  requestedBy?: string;
  credentialId?: string;
  credentialRef: string;
  input: Record<string, unknown>;
  currentStep?: string;
  result?: OperationResult;
  error?: OperationError;
  artifacts: OperationArtifact[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  cancelRequestedAt?: string;
}

export interface OperationEvent {
  id?: number | string;
  operationId: string;
  type:
    | "operation.created"
    | "operation.queued"
    | "operation.started"
    | "operation.authenticating"
    | "operation.portal_access"
    | "operation.processing"
    | "operation.verifying"
    | "operation.status"
    | "operation.step"
    | "artifact.created"
    | "operation.success"
    | "operation.error"
    | "operation.cancel_requested"
    | "operation.cancelled"
    | "operation.recovered"
    | "operation.manual_review";
  status?: OperationStatus;
  step?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}
