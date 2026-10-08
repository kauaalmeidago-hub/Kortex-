import { useState } from "react";
import { downloadOperationArtifact } from "@/services/automationApi";

export function KoaArtifactDownload({ operationId, fileName, label }: { operationId: string; fileName: string; label: string }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setError(undefined);
    try {
      await downloadOperationArtifact(operationId, fileName);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível baixar o arquivo. Tente novamente.");
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className="mt-3">
      <button type="button" onClick={download} disabled={downloading} className="inline-flex h-9 items-center justify-center rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60">
        {downloading ? "Baixando..." : label}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
