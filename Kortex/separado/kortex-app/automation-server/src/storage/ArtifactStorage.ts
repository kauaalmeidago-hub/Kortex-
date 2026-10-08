export interface SaveArtifactInput {
  operationId: string;
  workspaceId?: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  type: "card_pdf" | "confirmation_pdf" | "screenshot" | "status_screenshot" | "movement_status_evidence" | "receipt" | "document";
  metadata?: Record<string, unknown>;
}

export interface SavedArtifact {
  storageProvider: string;
  bucket: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

export interface ArtifactStorage {
  save(input: SaveArtifactInput): Promise<SavedArtifact>;
  read(storagePath: string): Promise<Buffer>;
  getSignedUrl(storagePath: string, expiresInSeconds?: number): Promise<string>;
  delete(storagePath: string): Promise<void>;
}

