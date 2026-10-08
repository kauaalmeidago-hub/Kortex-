import { readFile } from "node:fs/promises";
import type { Page } from "playwright";
import { AutomationError } from "../../../errors.js";

export interface HolderDocumentUpload {
  filePath: string;
  originalFileName: string;
  normalizedFileName: string;
}

export class HapvidaHolderDocumentsPage {
  constructor(private readonly page: Page) {}

  heading() {
    return this.page.getByText(/documentos|anexos|imagens/i).first();
  }

  fileInput() {
    return this.page.locator("input[type='file']").first();
  }

  uploadButton() {
    return this.page
      .getByRole("button", { name: /enviar\s+imagem|enviar\s+arquivo|anexar|upload/i })
      .or(this.page.locator("input[value*='ENVIAR IMAGEM' i], input[value*='ANEXAR' i], input[type='submit']").first());
  }

  async waitForLoaded() {
    await this.heading().or(this.fileInput()).waitFor({ state: "visible" });
  }

  async uploadDocument(document: HolderDocumentUpload) {
    const input = this.fileInput();
    if (!(await input.isVisible().catch(() => false))) {
      throw new AutomationError("PORTAL_CHANGED", "Campo de anexo nao encontrado no portal.", {
        safeDetails: "Nao localizei o input de arquivo da inclusao de titular.",
        step: "uploading_documents",
        retryable: false,
      });
    }

    await input.setInputFiles({
      name: document.normalizedFileName,
      mimeType: this.mimeFromFileName(document.normalizedFileName),
      buffer: await readFile(document.filePath),
    });

    await this.uploadButton().click();
    await this.assertUploaded(document.normalizedFileName);
  }

  async assertUploaded(fileName: string) {
    const attached = this.page.getByText(new RegExp(this.escape(fileName), "i")).first();
    if (await attached.isVisible().catch(() => false)) return;

    const successMessage = this.page.getByText(/arquivo\s+enviado|imagem\s+enviada|anexo\s+inclu[ií]do|upload\s+realizado/i).first();
    if (await successMessage.isVisible().catch(() => false)) return;

    throw new AutomationError("ATTACHMENT_UPLOAD_FAILED", "Nao consegui confirmar o anexo no portal.", {
      safeDetails: "O arquivo foi enviado ao input, mas o portal nao confirmou o upload.",
      step: "uploading_documents",
      retryable: false,
    });
  }

  proceedButton() {
    return this.page
      .getByRole("button", { name: /prosseguir|avancar|avançar|continuar/i })
      .or(this.page.locator("input[value*='PROSSEGUIR' i], input[value*='AVANCAR' i], input[value*='AVANÇAR' i], input[value*='CONTINUAR' i]").first());
  }

  async proceed() {
    await this.proceedButton().click();
  }

  private mimeFromFileName(fileName: string) {
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (extension === "pdf") return "application/pdf";
    if (extension === "doc") return "application/msword";
    if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return "image/jpeg";
  }

  private escape(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
