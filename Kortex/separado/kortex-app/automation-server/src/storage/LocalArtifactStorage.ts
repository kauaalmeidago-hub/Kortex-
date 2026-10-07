import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ArtifactStorage, SaveArtifactInput } from "./ArtifactStorage.js";

export class LocalArtifactStorage implements ArtifactStorage {
  constructor(private readonly artifactsDir: string) {}

  async save(input: SaveArtifactInput) {
    const operationDir = path.join(this.artifactsDir, input.operationId);
    mkdirSync(operationDir, { recursive: true });
    const safeFileName = path.basename(input.fileName);
    const filePath = path.join(operationDir, safeFileName);
    writeFileSync(filePath, input.bytes);

    return {
      storageProvider: "local",
      bucket: "local",
      storagePath: filePath,
      fileName: safeFileName,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      checksum: createHash("sha256").update(input.bytes).digest("hex"),
    };
  }

  async getSignedUrl(storagePath: string) {
    return `file://${storagePath}`;
  }

  async delete(storagePath: string) {
    rmSync(storagePath, { force: true });
  }
}
