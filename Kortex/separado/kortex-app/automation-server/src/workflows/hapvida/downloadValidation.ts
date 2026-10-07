import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AutomationError } from "../../errors.js";

export function validateCardPdfBytes(bytes: Buffer, fileName = "carteirinha.pdf") {
  if (bytes.byteLength <= 0) {
    throw new AutomationError("PDF_VALIDATION_FAILED", "PDF da carteirinha invalido.", {
      safeDetails: "O arquivo gerado esta vazio.",
      retryable: true,
    });
  }

  const firstBytes = bytes.subarray(0, Math.min(bytes.length, 512)).toString("latin1").trimStart();
  const extension = path.extname(fileName).toLowerCase();

  if (firstBytes.startsWith("<!doctype html") || firstBytes.startsWith("<html")) {
    throw new AutomationError("PDF_VALIDATION_FAILED", "A geracao da carteirinha retornou HTML em vez de PDF.", {
      safeDetails: "O portal pode ter retornado tela de erro ou sessao expirada.",
      retryable: true,
    });
  }

  if (extension !== ".pdf" && !firstBytes.startsWith("%PDF-")) {
    throw new AutomationError("PDF_VALIDATION_FAILED", "Arquivo gerado nao parece ser PDF.", {
      safeDetails: `Extensao: ${extension || "sem extensao"}.`,
      retryable: true,
    });
  }

  if (!firstBytes.startsWith("%PDF-")) {
    throw new AutomationError("PDF_VALIDATION_FAILED", "PDF gerado nao possui cabecalho valido.", {
      safeDetails: "O arquivo precisa comecar com %PDF- para ser aceito como carteirinha.",
      retryable: true,
    });
  }

  const text = bytes.toString("latin1");
  if (!/\/Type\s*\/Page\b/.test(text) && !/\/Count\s+[1-9]/.test(text)) {
    throw new AutomationError("PDF_VALIDATION_FAILED", "PDF gerado nao possui paginas detectaveis.", {
      safeDetails: "A carteirinha precisa ter ao menos uma pagina valida.",
      retryable: true,
    });
  }

  return bytes;
}

export async function readAndValidateCardPdf(filePath: string) {
  const fileStat = await stat(filePath).catch(() => undefined);
  if (!fileStat || !fileStat.isFile() || fileStat.size <= 0) {
    throw new AutomationError("DOWNLOAD_VALIDATION_FAILED", "Download da carteirinha invalido.", {
      safeDetails: "O arquivo baixado nao existe ou esta vazio.",
      retryable: true,
    });
  }

  const bytes = await readFile(filePath);
  return validateCardPdfBytes(bytes, path.basename(filePath));
}
