import type { Frame, Page } from "playwright";
import { AutomationError } from "../../errors.js";
import { waitForRenderedCards, type CardBeneficiary } from "./cardPreview.js";

export interface CardPrintBox { width: number; height: number }

// Inspect each card locally: a name on one card and a number on another must never confirm an identity.
export async function prepareSingleCardPrint(page: Page, frames: Frame[], beneficiary: CardBeneficiary,
  otherBeneficiaries: CardBeneficiary[], title: string): Promise<CardPrintBox> {
  const parentTitle = await page.title();
  const documents = await Promise.all(frames.map(frame => frame.evaluate(({ beneficiary, otherBeneficiaries, parentTitle }) => {
    const scope = globalThis as unknown as { document: any; getComputedStyle(element: unknown): any };
    const doc = scope.document;
    const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f\u00ad\u200b-\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ").trim().toLowerCase();
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const visible = (element: any) => {
      const rect = element.getBoundingClientRect(), style = scope.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const textOf = (element: any) => normalize(`${element.innerText ?? ""} ${Array.from(element.querySelectorAll('input[readonly], textarea[readonly]') as any[])
      .filter(visible).map(input => input.value ?? "").join(" ")}`);
    const identifiers = (input: CardBeneficiary) => {
      const cards = (input.cardIdentifiers ?? []).map(value => value.replace(/\D/g, "")).filter(value => value.length >= 6 && /[1-9]/.test(value));
      return cards.length ? cards : [input.cpf?.replace(/\D/g, "") ?? ""].filter(value => value.length >= 6 && /[1-9]/.test(value));
    };
    const hasNumber = (text: string, number: string) => new RegExp(`(?:^|[^0-9])${number.split("").join("[\\s.\\/-]*")}(?:$|[^0-9])`).test(text);
    const hasName = (text: string, name: string) => new RegExp(`(?:^|[^a-z0-9])${escape(normalize(name))}(?:$|[^a-z0-9])`).test(text);
    const ownIdentifiers = identifiers(beneficiary);
    const matches = (text: string) => {
      const identity = ownIdentifiers.some(number => hasNumber(text, number));
      const prefix = normalize(beneficiary.beneficiaryName).split(" ").slice(0, 2).join(" ");
      const name = hasName(text, beneficiary.beneficiaryName) || (prefix.includes(" ") && identity && hasName(text, prefix));
      return name && (ownIdentifiers.length || beneficiary.requireIdentifier ? identity : true);
    };
    const containsAnother = (text: string) => otherBeneficiaries.some(other => {
      const uniqueIdentifiers = identifiers(other).filter(number => !ownIdentifiers.includes(number));
      if (uniqueIdentifiers.length) return uniqueIdentifiers.some(number => hasNumber(text, number));
      const name = normalize(other.beneficiaryName), ownName = normalize(beneficiary.beneficiaryName);
      return name !== ownName && !hasName(ownName, name) && hasName(text, name);
    });
    const marker = /carteira\s+provisoria|carteirinha|cartao\s+(?:do\s+beneficiario|de\s+identificacao)/;
    if (!doc.body || !marker.test(normalize(`${doc.title} ${parentTitle} ${doc.body.innerText}`))) return [];
    const candidates = [doc.body, ...Array.from(doc.body.querySelectorAll("section, article, main, div, table, tbody, tr, td, fieldset") as any[])].filter(element => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect(), text = textOf(element);
      const nameFields = text.match(/\bnome(?:\s+(?:completo|do|da|beneficiario|usuario|segurado))*\b/g) ?? [];
      // A complete printable region needs card data and exactly one person's name field.
      // Two name fields block a combined family wrapper even when a dependent is absent from the list.
      return rect.width >= 180 && rect.height >= 60 && nameFields.length === 1 &&
        /\b(?:plano|validade|adesao|vigencia|nascimento|empresa|contrato|registro|ans|emissao)\b/.test(text) &&
        matches(text) && !containsAnother(text);
    });
    const boundaries = candidates.filter(element => {
      const style = scope.getComputedStyle(element);
      return /^(SECTION|ARTICLE|TABLE|FIELDSET)$/.test(element.tagName) ||
        /(?:^|[\s_-])(?:card|carteira|carteirinha)(?:$|[\s_-])/i.test(`${element.id} ${element.className}`) ||
        [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].some(value => parseFloat(value) > 0);
    });
    const pool = boundaries.length ? boundaries : candidates;
    // Keep the complete outer card, including its footer, logo and terms, rather than a matching data cell.
    const cards = pool.filter(element => !pool.some(parent => parent !== element && parent.contains(element)));
    return cards.map(element => {
      const copy = element.cloneNode(true);
      const originals = [element, ...Array.from(element.querySelectorAll("*") as any[])];
      const copies = [copy, ...Array.from(copy.querySelectorAll("*") as any[])];
      originals.forEach((original, index) => {
        const clone = copies[index];
        if (!visible(original) || /^(SCRIPT|IFRAME|FRAME|OBJECT|EMBED|BUTTON|SELECT|NAV)$/.test(original.tagName) ||
          (original.tagName === "INPUT" && !original.readOnly)) { clone.remove(); return; }
        for (const attribute of Array.from(clone.attributes) as any[]) if (/^on/i.test(attribute.name)) clone.removeAttribute(attribute.name);
        if (original.tagName === "INPUT" || original.tagName === "TEXTAREA") {
          const span = doc.createElement("span"); span.textContent = original.value; clone.replaceWith(span);
        }
        if (clone.tagName === "IMG") { clone.src = new URL(original.currentSrc || original.src, doc.baseURI).href; clone.removeAttribute("srcset"); }
        if (clone.tagName === "A") clone.removeAttribute("href");
      });
      const rect = element.getBoundingClientRect();
      // Retain ancestor selectors with empty shells, without retaining any sibling card or its personal data.
      let content = copy;
      for (let parent = element.parentElement; parent && parent !== doc.body && parent !== doc.documentElement; parent = parent.parentElement) {
        const shell = parent.cloneNode(false);
        for (const attribute of Array.from(shell.attributes) as any[]) if (/^on/i.test(attribute.name)) shell.removeAttribute(attribute.name);
        shell.style.cssText += ";margin:0!important;padding:0!important;height:auto!important;min-height:0!important;break-before:auto!important;break-after:auto!important;";
        shell.appendChild(content); content = shell;
      }
      const styles = Array.from(doc.querySelectorAll('style, link[rel="stylesheet"]') as any[]).map(element => {
        const clone = element.cloneNode(true);
        if (clone.tagName === "LINK") clone.href = new URL(element.href, doc.baseURI).href;
        return clone.outerHTML;
      }).join("");
      return { html: content.outerHTML, styles, baseUri: doc.baseURI, width: Math.ceil(rect.width) };
    });
  }, { beneficiary, otherBeneficiaries, parentTitle })));
  const cards = documents.flat();
  if (cards.length !== 1) throw new AutomationError("CARD_CAPTURE_FAILED", "Nao foi possivel separar com seguranca a carteirinha escolhida.", {
    safeDetails: `Carteirinhas completas correspondentes: ${cards.length}. Nenhum PDF da familia foi entregue.`, step: "capture_single_card", retryable: false,
  });
  const card = cards[0]!;
  await page.evaluate(({ card, title }) => {
    const doc = (globalThis as unknown as { document: any }).document;
    doc.head.innerHTML = '<meta charset="utf-8">';
    doc.title = title;
    if (!card.baseUri.startsWith("about:")) { const base = doc.createElement("base"); base.href = card.baseUri; doc.head.appendChild(base); }
    doc.head.insertAdjacentHTML("beforeend", card.styles);
    doc.body.innerHTML = `<main id="koa-card-print-root">${card.html}</main>`;
    const style = doc.createElement("style");
    style.textContent = `@page { margin:0; size:auto; } html,body { margin:0!important; padding:0!important; background:white!important; }
      #koa-card-print-root { display:flow-root!important; width:${card.width + 48}px!important; padding:12px!important; box-sizing:border-box!important; }
      #koa-card-print-root, #koa-card-print-root * { break-before:auto!important; break-after:auto!important; }
      #koa-card-print-root button { display:none!important; }`;
    doc.head.appendChild(style);
  }, { card, title });
  await page.emulateMedia({ media: "print" });
  await page.waitForFunction(() => {
    const doc = (globalThis as unknown as { document: any }).document;
    return doc.fonts?.status !== "loading" && Array.from(doc.images as any[]).every(image => image.complete && image.naturalWidth > 0);
  }, undefined, { timeout: 10_000 }).then(handle => handle.dispose()).catch(() => {
    throw new AutomationError("CARD_CAPTURE_FAILED", "A carteirinha escolhida nao terminou de carregar.", { step: "capture_single_card", retryable: true });
  });
  await waitForRenderedCards(page, [beneficiary], 1000).catch(() => {
    throw new AutomationError("CARD_CAPTURE_FAILED", "A carteirinha escolhida nao ficou legivel na impressao.", { step: "capture_single_card", retryable: false });
  });
  return page.evaluate(() => {
    const root = (globalThis as unknown as { document: any }).document.getElementById("koa-card-print-root");
    const rect = root.getBoundingClientRect();
    return { width: Math.ceil(Math.max(rect.width, root.scrollWidth)), height: Math.ceil(Math.max(rect.height, root.scrollHeight)) + 1 };
  });
}
