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
  | "checking_active_users"
  | "checking_cns"
  | "checking_cpf"
  | "awaiting_authentication"
  | "awaiting_human_verification"
  | "generating_cpf_document"
  | "validating_documents"
  | "opening_inclusion"
  | "filling_registration"
  | "selecting_plan"
  | "uploading_documents"
  | "filling_health_questionnaire"
  | "processing"
  | "awaiting_confirmation"
  | "submitting"
  | "checking_movement_status"
  | "capturing_evidence"
  | "submission_confirmed"
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
  artifactType?:
    | "card_pdf"
    | "confirmation_pdf"
    | "screenshot"
    | "status_screenshot"
    | "movement_status_evidence"
    | "receipt"
    | "document";
  metadata?: Record<string, unknown>;
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
    | "preflight.active_users.started"
    | "preflight.active_users.loaded"
    | "preflight.beneficiary.found"
    | "preflight.beneficiary.not_found"
    | "preflight.beneficiary.validated"
    | "preflight.failed"
    | "movement.status.check_started"
    | "movement.status.page_loaded"
    | "movement.status.matched"
    | "movement.status.not_found"
    | "movement.status.confirmed"
    | "movement.status.evidence_captured"
    | "movement.status.manual_review"
    | "inclusion.started"
    | "inclusion.cns.started"
    | "inclusion.cns.found"
    | "inclusion.cns.failed"
    | "inclusion.cpf.started"
    | "inclusion.cpf.human_verification_required"
    | "inclusion.cpf.validated"
    | "inclusion.cpf.document_created"
    | "inclusion.registration.started"
    | "inclusion.registration.completed"
    | "inclusion.plan.selected"
    | "inclusion.document.uploaded"
    | "inclusion.health.started"
    | "inclusion.health.completed"
    | "inclusion.awaiting_confirmation"
    | "inclusion.submitted"
    | "inclusion.error"
    | "inclusion.cancelled"
    | "operation.success"
    | "operation.error"
    | "operation.cancel_requested"
    | "operation.cancelled"
    | "operation.recovered"
    | "operation.manual_review"
    | "authentication.required"
    | "authentication.submitted"
    | "authentication.started"
    | "authentication.succeeded"
    | "authentication.failed"
    | "authentication.saved_on_device"
    | "authentication.saved_in_database"
    | "exclusion.started"
    | "exclusion.company_access_selected"
    | "exclusion.active_users_loaded"
    | "exclusion.beneficiary_found"
    | "exclusion.holder_code_resolved"
    | "exclusion.contract_loaded"
    | "exclusion.contract_validated"
    | "exclusion.reason_selected"
    | "exclusion.attachment_uploaded"
    | "exclusion.awaiting_confirmation"
    | "exclusion.submitted"
    | "exclusion.verifying"
    | "exclusion.success"
    | "exclusion.error"
    | "exclusion.cancelled"
    | "exclusion.manual_review";
  status?: OperationStatus;
  step?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

