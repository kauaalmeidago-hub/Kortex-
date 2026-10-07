import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ArtifactStorage, SaveArtifactInput } from "./ArtifactStorage.js";
import { AutomationError } from "../errors.js";

export class SupabaseArtifactStorage implements ArtifactStorage {
  private readonly client: SupabaseClient;

  constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    private readonly bucket = "koa-artifacts",
  ) {
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async save(input: SaveArtifactInput) {
    const workspaceId = input.workspaceId ?? "workspace-unknown";
    const safeFileName = input.fileName.replace(/[^\w.-]+/g, "_");
    const storagePath = `operations/${workspaceId}/${input.operationId}/${safeFileName}`;
    const checksum = createHash("sha256").update(input.bytes).digest("hex");

    const { error } = await this.client.storage.from(this.bucket).upload(storagePath, input.bytes, {
      contentType: input.mimeType,
      upsert: false,
    });

    if (error) {
      throw new AutomationError("ARTIFACT_UPLOAD_FAILED", "Falha ao salvar artefato.", {
        safeDetails: error.message,
        retryable: false,
      });
    }

    return {
      storageProvider: "supabase",
      bucket: this.bucket,
      storagePath,
      fileName: safeFileName,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      checksum,
    };
  }

  async getSignedUrl(storagePath: string, expiresInSeconds = 300) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(storagePath, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new AutomationError("ARTIFACT_SIGNED_URL_FAILED", "Falha ao criar URL temporaria.", {
        safeDetails: error?.message,
        retryable: true,
      });
    }

    return data.signedUrl;
  }

  async delete(storagePath: string) {
    const { error } = await this.client.storage.from(this.bucket).remove([storagePath]);
    if (error) {
      throw new AutomationError("ARTIFACT_DELETE_FAILED", "Falha ao remover artefato.", {
        safeDetails: error.message,
        retryable: false,
      });
    }
  }
}
