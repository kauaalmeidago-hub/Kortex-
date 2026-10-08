import type { Page } from "playwright";
import {
  type AttachmentMetadata,
  type CancellationReasonOption,
  mapCancellationReasonOption,
  sanitizePortalFileName,
  validateAttachmentMetadata,
} from "../exclusionUtils.js";

export interface HolderCancellationReview {
  companyName?: string;
  contractCode?: string;
  holderName?: string;
  holderCpf?: string;
  effectiveCancellationDate?: string;
  dependents: Array<{
    code?: string;
    name?: string;
    birthDate?: string;
  }>;
}

export class HapvidaHolderCancellationReviewPage {
  constructor(private readonly page: Page) {}

  heading() {
    return this.page.getByText(/pr[eé]-?cancelamento.*contrato\s+ativo|informa[cç][oõ]es\s+sobre\s+o\s+contrato/i).first();
  }

  reasonSelect() {
    return this.page
      .getByLabel(/motivo\s+cancelamento/i)
      .or(this.page.locator("select[name*='motivo' i], select[id*='motivo' i]").first())
      .or(this.page.locator("select").first());
  }

  attachmentInput() {
    return this.page.locator("input[type='file']").first();
  }

  sendImageButton() {
    return this.page
      .getByRole("button", { name: /enviar\s+imagem/i })
      .or(this.page.locator("input[value*='ENVIAR IMAGEM' i], input[value*='Enviar imagem' i]").first());
  }

  finalProceedButton() {
    return this.page
      .getByRole("button", { name: /^prosseguir$/i })
      .or(this.page.locator("input[value*='PROSSEGUIR' i]").first());
  }

  async waitForLoaded() {
    await this.heading().or(this.reasonSelect()).waitFor({ state: "visible" });
  }

  async readReview(): Promise<HolderCancellationReview> {
    const bodyText = ((await this.page.locator("body").innerText().catch(() => "")) ?? "").trim();

    return {
      companyName: extractLabelValue(bodyText, /NOME/i),
      contractCode: extractLabelValue(bodyText, /C[OÓ]DIGO\s+CONTRATO/i),
      holderName: extractLabelValue(bodyText, /NOME\s+USU[AÁ]RIO\s+TITULAR/i),
      holderCpf: extractLabelValue(bodyText, /CPF\s+USU[AÁ]RIO\s+TITULAR/i),
      effectiveCancellationDate: extractLabelValue(bodyText, /DATA\s+DO\s+PR[EÉ]-?CANCELAMENTO/i) ?? extractFirstDate(bodyText),
      dependents: extractDependents(bodyText),
    };
  }

  async readReasonOptions(): Promise<CancellationReasonOption[]> {
    const select = this.reasonSelect();
    return select.locator("option").evaluateAll((options) =>
      options.map((option) => {
        const item = option as unknown as { value: string; label?: string; textContent?: string | null };
        return {
          value: item.value,
          label: (item.label || item.textContent || "").trim(),
        };
      }),
    );
  }

  async selectCancellationReason(requestedReason: string) {
    const option = mapCancellationReasonOption(await this.readReasonOptions(), requestedReason);
    await this.reasonSelect().selectOption(option.value);
    return option;
  }

  async uploadAttachment(attachment: AttachmentMetadata & { localPath: string }) {
    const validated = validateAttachmentMetadata(attachment);
    const portalFileName = sanitizePortalFileName(validated.fileName);

    await this.attachmentInput().setInputFiles({
      name: portalFileName,
      mimeType: attachment.mimeType ?? "application/octet-stream",
      buffer: await import("node:fs/promises").then((fs) => fs.readFile(attachment.localPath)),
    });
    await this.sendImageButton().click();

    return validated;
  }
}

function extractLabelValue(text: string, label: RegExp) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!label.test(line)) continue;
    const inline = line.split(":").slice(1).join(":").trim();
    if (inline) return inline;
    return lines[index + 1]?.trim();
  }

  return undefined;
}

function extractFirstDate(text: string) {
  return /\b\d{2}\/\d{2}\/\d{4}\b/.exec(text)?.[0];
}

function extractDependents(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const dependents: HolderCancellationReview["dependents"] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/DEPENDENTE/i.test(lines[index]!)) continue;
    const windowText = lines.slice(index, index + 8).join("\n");
    dependents.push({
      code: extractLabelValue(windowText, /C[OÓ]DIGO/i),
      name: extractLabelValue(windowText, /NOME/i),
      birthDate: extractLabelValue(windowText, /DATA\s+NASCIMENTO/i),
    });
  }

  return dependents.filter((dependent) => dependent.code || dependent.name || dependent.birthDate);
}
