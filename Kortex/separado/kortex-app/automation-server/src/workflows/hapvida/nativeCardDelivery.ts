import type { Frame, Page } from "playwright";
import { AutomationError, assertNotAborted } from "../../errors.js";
import { waitForRenderedCards, type CardBeneficiary } from "./cardPreview.js";
import { extractPrintableCard } from "./singleCardCapture.js";
import { validateCardPdfBytes } from "./downloadValidation.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export async function createNativeCardDelivery(sourcePage: Page, frames: Frame[], beneficiaries: CardBeneficiary[],
  otherBeneficiaries: CardBeneficiary[], title: string, signal: AbortSignal) {
  if (!beneficiaries.length) throw new AutomationError("MISSING_REQUIRED_DATA", "Nao ha carteirinhas selecionadas para entregar.");
  const parentTitle = await sourcePage.title();
  const documents = [];
  for (const [index, beneficiary] of beneficiaries.entries()) {
    assertNotAborted(signal);
    documents.push(await extractPrintableCard(frames, beneficiary,
      [...beneficiaries.filter((_, otherIndex) => otherIndex !== index), ...otherBeneficiaries], parentTitle));
  }
  const printPage = await sourcePage.context().newPage();
  try {
    const sheets = documents.map((card, index) => {
      const content = `<!doctype html><html><head><meta charset="utf-8"><title>Carteira Provisoria</title>
        ${card.baseUri.startsWith("about:") ? "" : `<base href="${escapeHtml(card.baseUri)}">`}${card.styles}
        <style>html,body { margin:0!important;padding:0!important;background:white!important; }
        #koa-native-card { display:flow-root!important;width:${card.width + 48}px!important;padding:12px!important;box-sizing:border-box!important; }
        #koa-native-card, #koa-native-card * { break-before:auto!important;break-after:auto!important; }</style></head>
        <body><main id="koa-native-card">${card.html}</main></body></html>`;
      return `<section class="native-card-sheet"><iframe title="${escapeHtml(beneficiaries[index]!.beneficiaryName)}"
        srcdoc="${escapeHtml(content)}" style="width:${card.width + 48}px;height:10000px"></iframe></section>`;
    }).join("");
    await printPage.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
      @page { margin:0;size:auto; } html,body { margin:0;padding:0;background:white; }
      .native-card-sheet { break-after:page;break-inside:avoid; }
      .native-card-sheet:last-child { break-after:auto; }
      iframe { border:0;display:block; }
      </style></head><body>${sheets}</body></html>`, { waitUntil: "load", timeout: 30_000 });
    await printPage.emulateMedia({ media: "print" });
    const boxes = [];
    for (const iframe of await printPage.locator(".native-card-sheet iframe").all()) {
      assertNotAborted(signal);
      const handle = await iframe.elementHandle();
      const frame = await handle?.contentFrame();
      await handle?.dispose();
      if (!frame) throw new Error("A carteirinha nao carregou para impressao.");
      await frame.waitForFunction(() => {
        const doc = (globalThis as unknown as { document: any }).document;
        return doc.fonts?.status !== "loading" && Array.from(doc.images as any[]).every(image => image.complete);
      }, undefined, { timeout: 10_000 }).then(handle => handle.dispose());
      const box = await frame.evaluate(() => {
        const root = (globalThis as unknown as { document: any }).document.getElementById("koa-native-card");
        const rect = root.getBoundingClientRect();
        return { width: Math.ceil(Math.max(rect.width, root.scrollWidth)), height: Math.ceil(Math.max(rect.height, root.scrollHeight)) + 1 };
      });
      if (!box.width || !box.height) throw new Error("Uma carteirinha ficou vazia para impressao.");
      boxes.push(box);
      await iframe.evaluate((element, box) => {
        (element as unknown as { style: any }).style.cssText = `width:${box.width}px;height:${box.height}px`;
      }, box);
    }
    const width = Math.max(...boxes.map(box => box.width)), height = Math.max(...boxes.map(box => box.height)) + 1;
    await printPage.locator(".native-card-sheet").evaluateAll((elements, box) => {
      for (const element of elements as any[]) element.style.cssText = `width:${box.width}px;height:${box.height}px`;
    }, { width, height: height - 1 });
    await waitForRenderedCards(printPage, beneficiaries, 1500, undefined, signal);
    assertNotAborted(signal);
    let bytes: Buffer;
    try {
      bytes = await printPage.pdf({ width: `${width}px`, height: `${height}px`,
        margin: { top: "0", right: "0", bottom: "0", left: "0" }, printBackground: true, preferCSSPageSize: false });
    } catch {
      assertNotAborted(signal);
      const session = await printPage.context().newCDPSession(printPage);
      try {
        const pdf = await session.send("Page.printToPDF", { paperWidth: width / 96, paperHeight: height / 96,
          marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, printBackground: true, preferCSSPageSize: false });
        bytes = Buffer.from(pdf.data, "base64");
      } finally { await session.detach().catch(() => undefined); }
    }
    validateCardPdfBytes(bytes);
    const pageCount = bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
    if (pageCount !== beneficiaries.length) throw new Error("A impressao nao confirmou uma pagina completa para cada carteirinha.");
    return { bytes, pageCount, deliveryVersion: 2, format: "native" as const };
  } catch (error) {
    if (error instanceof AutomationError || signal.aborted) throw error;
    throw new AutomationError("CARD_DELIVERY_FAILED", "Nao foi possivel concluir o PDF das carteirinhas originais.", {
      step: "print_native_cards", retryable: true,
    });
  } finally { await printPage.close().catch(() => undefined); }
}
