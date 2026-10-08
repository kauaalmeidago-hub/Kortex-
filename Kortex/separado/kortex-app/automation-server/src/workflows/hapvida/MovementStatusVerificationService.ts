import { AutomationError, assertNotAborted } from "../../errors.js";
import type { OperationArtifact, OperationRecord } from "../../types.js";
import type { WorkflowContext } from "../WorkflowContext.js";
import { maskCpf } from "./exclusionUtils.js";
import { expectedMovementLabel, type MovementStatusMatchInput, type MovementStatusRecord } from "./movementStatusUtils.js";
import { HapvidaMovementMainMenuPage } from "./pageObjects/HapvidaMovementMainMenuPage.js";
import { HapvidaMovementStatusPage } from "./pageObjects/HapvidaMovementStatusPage.js";

interface MovementStatusVerificationServiceDeps {
  operation: OperationRecord;
  context: WorkflowContext;
  signal: AbortSignal;
  menuPage: HapvidaMovementMainMenuPage;
  statusPage: HapvidaMovementStatusPage;
}

export interface MovementStatusVerificationResult {
  submissionConfirmed: true;
  portalStatusCode?: string;
  portalStatusLabel?: string;
  evidenceArtifact: OperationArtifact;
  record: MovementStatusRecord;
}

export class MovementStatusVerificationService {
  constructor(private readonly deps: MovementStatusVerificationServiceDeps) {}

  async verify(input: MovementStatusMatchInput): Promise<MovementStatusVerificationResult> {
    const { operation, context, signal } = this.deps;

    await context.updateStatus("checking_movement_status", "Consultando Status Movimentacao");
    await context.emitEvent({
      operationId: operation.id,
      type: "movement.status.check_started",
      status: "checking_movement_status",
      step: "checking_movement_status",
      data: { workflow: input.workflow, expectedMovement: expectedMovementLabel(input.workflow) },
    });

    await this.deps.menuPage.openMovementStatus();
    await this.deps.statusPage.load();
    assertNotAborted(signal);

    const legend = await this.deps.statusPage.getLegend();
    await context.emitEvent({
      operationId: operation.id,
      type: "movement.status.page_loaded",
      status: "checking_movement_status",
      step: "checking_movement_status",
      data: { legendCount: legend.length },
    });

    let record: MovementStatusRecord | undefined;
    const maxAttempts = Math.max(1, context.config.movementStatusVerifyMaxAttempts);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      record = await this.deps.statusPage.findMovement(input);
      if (record) break;
      if (attempt < maxAttempts) {
        await this.deps.statusPage.load();
      }
    }

    if (!record) {
      await context.emitEvent({
        operationId: operation.id,
        type: "movement.status.not_found",
        status: "checking_movement_status",
        step: "checking_movement_status",
        data: { workflow: input.workflow },
      });
      throw new AutomationError("SUBMISSION_STATUS_UNKNOWN", "Nao consegui confirmar a movimentacao no Status Movimentacao.", {
        safeDetails: "A solicitacao pode ter sido enviada, mas o registro correspondente nao apareceu no portal.",
        step: "checking_movement_status",
        retryable: false,
      });
    }

    await context.emitEvent({
      operationId: operation.id,
      type: "movement.status.matched",
      status: "checking_movement_status",
      step: "checking_movement_status",
      data: {
        workflow: input.workflow,
        beneficiaryCpfMasked: maskCpf(input.beneficiaryCpf),
        portalStatusCode: record.portalStatusCode,
        portalStatusLabel: record.portalStatusLabel,
      },
    });

    await context.updateStatus("capturing_evidence", "Capturando comprovante do Status Movimentacao");
    const bytes = await this.deps.statusPage.captureEvidence(record).catch((error) => {
      throw new AutomationError("MOVEMENT_EVIDENCE_FAILED", "Falha ao capturar comprovante do Status Movimentacao.", {
        safeDetails: error instanceof Error ? error.message : undefined,
        step: "capturing_evidence",
        retryable: false,
      });
    });
    assertNotAborted(signal);

    const savedArtifact = await context.artifactStorage.save({
      operationId: operation.id,
      workspaceId: operation.workspaceId,
      fileName: `status-movimentacao-${operation.id}.png`,
      mimeType: "image/png",
      bytes,
      type: "movement_status_evidence",
      metadata: {
        operationId: operation.id,
        companyId: operation.companyId,
        operator: operation.portal,
        workflow: input.workflow,
        beneficiary: {
          name: input.beneficiaryName,
          cpfMasked: maskCpf(input.beneficiaryCpf),
        },
        capturedAt: new Date().toISOString(),
        portalStatusCode: record.portalStatusCode,
        portalStatusLabel: record.portalStatusLabel,
      },
    });

    const artifact: OperationArtifact = {
      id: crypto.randomUUID(),
      fileName: savedArtifact.fileName,
      path: savedArtifact.storagePath,
      storageProvider: savedArtifact.storageProvider,
      bucket: savedArtifact.bucket,
      storagePath: savedArtifact.storagePath,
      mimeType: savedArtifact.mimeType,
      sizeBytes: savedArtifact.sizeBytes,
      checksum: savedArtifact.checksum,
      kind: "screenshot",
      artifactType: "movement_status_evidence",
      metadata: {
        operationId: operation.id,
        companyId: operation.companyId,
        operator: operation.portal,
        workflow: input.workflow,
        beneficiary: {
          name: input.beneficiaryName,
          cpfMasked: maskCpf(input.beneficiaryCpf),
        },
        capturedAt: new Date().toISOString(),
        portalStatusCode: record.portalStatusCode,
        portalStatusLabel: record.portalStatusLabel,
      },
      createdAt: new Date().toISOString(),
    };

    const current = await context.repository.get(operation.id);
    await context.repository.update(operation.id, {
      artifacts: [...(current?.artifacts ?? []), artifact],
      updatedAt: new Date().toISOString(),
    });

    await context.emitEvent({
      operationId: operation.id,
      type: "movement.status.evidence_captured",
      status: "capturing_evidence",
      step: "capturing_evidence",
      data: {
        artifactId: artifact.id,
        portalStatusCode: record.portalStatusCode,
        portalStatusLabel: record.portalStatusLabel,
      },
    });

    await context.emitEvent({
      operationId: operation.id,
      type: "movement.status.confirmed",
      status: "submission_confirmed",
      step: "submission_confirmed",
      data: {
        submissionConfirmed: true,
        portalStatusCode: record.portalStatusCode,
        portalStatusLabel: record.portalStatusLabel,
      },
    });

    return {
      submissionConfirmed: true,
      portalStatusCode: record.portalStatusCode,
      portalStatusLabel: record.portalStatusLabel,
      evidenceArtifact: artifact,
      record,
    };
  }
}
