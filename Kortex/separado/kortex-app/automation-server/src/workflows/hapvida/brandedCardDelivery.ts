import type { Frame, Page } from "playwright";
import { AutomationError, assertNotAborted } from "../../errors.js";
import type { CardBeneficiary } from "./cardPreview.js";
import { waitForRenderedCards } from "./cardPreview.js";
import { extractPrintableCard } from "./singleCardCapture.js";
import { paginateCardDelivery, type CardDeliveryMember } from "./cardDeliveryLayout.js";
import { CARD_DELIVERY_TEMPLATES, cardTemplateBackground, type CardTemplateSlot } from "./cardDeliveryTemplates.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const roleLabel = (role: CardDeliveryMember["role"]) => role === "holder" ? "TITULAR" : role === "dependent" ? "DEPENDENTE" : "BENEFICIÁRIO";

export async function createBrandedCardDelivery(sourcePage: Page, frames: Frame[], members: CardDeliveryMember[],
  otherBeneficiaries: CardBeneficiary[], title: string, signal: AbortSignal) {
  const layouts = paginateCardDelivery(members);
  const parentTitle = await sourcePage.title();
  const documents = new Map<string, Awaited<ReturnType<typeof extractPrintableCard>>>();
  // Keep extraction sequential so large company lists do not flood the portal's renderer.
  for (const member of members) {
    assertNotAborted(signal);
    documents.set(member.id, await extractPrintableCard(frames, member,
      [...members.filter(other => other.id !== member.id), ...otherBeneficiaries], parentTitle));
  }
  const backgrounds = new Map(await Promise.all([...new Set(layouts.map(layout => layout.template))]
    .map(async kind => [kind, await cardTemplateBackground(kind)] as const)));
  assertNotAborted(signal);
  const template = CARD_DELIVERY_TEMPLATES[layouts[0]!.template];
  const printPage = await sourcePage.context().newPage();
  try {
    await printPage.setViewportSize({ width: template.width, height: template.height });
    const sheets = layouts.map(layout => {
      const template = CARD_DELIVERY_TEMPLATES[layout.template];
      const slots = (template.slots as CardTemplateSlot[]).map((slot, index) => {
        const member = layout.members[index];
        const label = slot.labelY !== undefined && member && member.role !== slot.defaultRole
          ? `<div class="role-label" style="top:${slot.labelY}px">${roleLabel(member.role)}</div>` : "";
        if (!member) return `${slot.labelY === undefined ? "" : `<div class="role-label" style="top:${slot.labelY}px">DOCUMENTOS</div>`}
          <div class="empty-slot" style="left:${slot.x}px;top:${slot.y}px;width:${slot.width}px;height:${slot.height}px">Nenhuma outra carteirinha nesta entrega.</div>`;
        const card = documents.get(member.id)!;
        const content = `<!doctype html><html><head><meta charset="utf-8"><title>Carteira Provisória</title>
          ${card.baseUri.startsWith("about:") ? "" : `<base href="${escapeHtml(card.baseUri)}">`}${card.styles}
          <style>@page { margin:0;size:auto; } html,body { margin:0!important;padding:0!important;background:white!important; }
          #koa-card-content { display:flow-root!important;width:${card.width + 48}px!important;padding:12px!important;box-sizing:border-box!important; }
          #koa-card-content, #koa-card-content * { break-before:auto!important;break-after:auto!important; }</style></head>
          <body><main id="koa-card-content">${card.html}</main></body></html>`;
        return `${label}<div class="card-slot" data-member-id="${escapeHtml(member.id)}" data-role="${member.role}"
          style="left:${slot.x}px;top:${slot.y}px;width:${slot.width}px;height:${slot.height}px">
          <iframe title="${escapeHtml(member.beneficiaryName)}" srcdoc="${escapeHtml(content)}" style="width:${card.width + 48}px;height:10000px"></iframe></div>`;
      }).join("");
      return `<section class="delivery-sheet" data-template="${layout.template}" style="width:${template.width}px;height:${template.height}px">
        <img class="delivery-background" src="${backgrounds.get(layout.template)}" alt="Moldura Alaive">${slots}</section>`;
    }).join("");
    await printPage.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
      @page { margin:0;size:auto; } html,body { margin:0;padding:0;background:#05274d; }
      .delivery-sheet { position:relative;overflow:hidden;break-after:page;break-inside:avoid; }
      .delivery-sheet:last-child { break-after:auto; }
      .delivery-background { position:absolute;inset:0;width:100%;height:100%; }
      .card-slot { position:absolute;overflow:hidden; }
      .card-slot iframe { position:absolute;left:0;top:0;border:0;transform-origin:top left; }
      .role-label { position:absolute;left:299px;width:302px;height:49px;display:flex;align-items:center;padding-left:5px;
        background:linear-gradient(100deg,#073367,#073382);color:white;font:bold 31px Arial;box-sizing:border-box; }
      .empty-slot { position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;
        color:#617084;font:20px Arial;box-sizing:border-box;padding:30px; }
      </style></head><body>${sheets}</body></html>`, { waitUntil: "load", timeout: 30_000 });
    await printPage.emulateMedia({ media: "print" });
    await printPage.waitForFunction(() => Array.from((globalThis as unknown as { document: any }).document.images as any[])
      .every(image => image.complete && image.naturalWidth > 0), undefined, { timeout: 10_000 }).then(handle => handle.dispose());
    const iframes = await printPage.locator(".card-slot iframe").all();
    for (const iframe of iframes) {
      assertNotAborted(signal);
      const element = await iframe.elementHandle();
      const frame = await element?.contentFrame();
      await element?.dispose();
      if (!frame) throw new AutomationError("CARD_DELIVERY_FAILED", "Uma carteirinha nao carregou na moldura.", { step: "format_card_delivery" });
      await frame.waitForFunction(() => {
        const doc = (globalThis as unknown as { document: any }).document;
        return doc.fonts?.status !== "loading" && Array.from(doc.images as any[]).every(image => image.complete && image.naturalWidth > 0);
      }, undefined, { timeout: 10_000 }).then(handle => handle.dispose());
      const box = await frame.evaluate(() => {
        const root = (globalThis as unknown as { document: any }).document.getElementById("koa-card-content");
        const rect = root.getBoundingClientRect();
        return { width: Math.ceil(Math.max(rect.width, root.scrollWidth)), height: Math.ceil(Math.max(rect.height, root.scrollHeight)) + 1 };
      });
      if (!box.width || !box.height) throw new AutomationError("CARD_DELIVERY_FAILED", "Uma carteirinha ficou vazia na moldura.", { step: "format_card_delivery" });
      await iframe.evaluate((element, box) => {
        const container = (element as unknown as { parentElement: { clientWidth: number; clientHeight: number } }).parentElement;
        const scale = Math.min(container.clientWidth / box.width, container.clientHeight / box.height);
        (element as unknown as { style: any }).style.cssText = `width:${box.width}px;height:${box.height}px;transform:scale(${scale});left:${(container.clientWidth - box.width * scale) / 2}px;top:${(container.clientHeight - box.height * scale) / 2}px;`;
      }, box);
    }
    await waitForRenderedCards(printPage, members, 1500, undefined, signal);
    assertNotAborted(signal);
    let bytes: Buffer;
    try {
      bytes = await printPage.pdf({ width: `${template.width}px`, height: `${template.height}px`,
        margin: { top: "0", right: "0", bottom: "0", left: "0" }, printBackground: true, preferCSSPageSize: false });
    } catch {
      const session = await printPage.context().newCDPSession(printPage);
      try {
        const pdf = await session.send("Page.printToPDF", { paperWidth: template.width / 96, paperHeight: template.height / 96,
          marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, printBackground: true, preferCSSPageSize: false });
        bytes = Buffer.from(pdf.data, "base64");
      } finally { await session.detach().catch(() => undefined); }
    }
    return { bytes, pageCount: layouts.length, deliveryVersion: 1, template: layouts[0]!.template };
  } catch (error) {
    if (error instanceof AutomationError || signal.aborted) throw error;
    throw new AutomationError("CARD_DELIVERY_FAILED", "Nao foi possivel concluir a entrega das carteirinhas na moldura.", { step: "format_card_delivery", retryable: true });
  } finally { await printPage.close().catch(() => undefined); }
}
