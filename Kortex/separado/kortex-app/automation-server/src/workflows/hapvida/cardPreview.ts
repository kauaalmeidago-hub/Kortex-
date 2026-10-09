import { setTimeout as delay } from "node:timers/promises";
import type { Frame, Page } from "playwright";
import { AutomationError } from "../../errors.js";

export interface CardBeneficiary {
  beneficiaryName: string;
  cpf?: string;
  birthDate?: string;
  cardIdentifiers?: string[];
  requireIdentifier?: boolean;
}

export async function waitForRenderedCards(page: Page, beneficiaries: CardBeneficiary[], timeoutMs: number, portalUrl?: string) {
  if (!beneficiaries.length || beneficiaries.some(input => !input.beneficiaryName.trim())) {
    throw new AutomationError("MISSING_REQUIRED_DATA", "Faltam beneficiarios para validar as carteirinhas.", { step: "validate_card_preview" });
  }
  const expectedOrigin = portalUrl ? new URL(portalUrl).origin : undefined;
  const deadline = Date.now() + timeoutMs;
  let lastStates: Array<{ document: boolean; matches: boolean[]; frame: Frame }> = [];
  while (!page.isClosed() && Date.now() < deadline) {
    const parentTitle = await page.title().catch(() => "");
    const states = await Promise.all(page.frames().map(async frame => {
      try {
        if (frame.isDetached()) return undefined;
        const url = frame.url();
        if (expectedOrigin && !url.startsWith("about:") && new URL(url).origin !== expectedOrigin) return undefined;
        if (frame !== page.mainFrame()) {
          const element = await frame.frameElement();
          try { if (!await element.isVisible()) return undefined; } finally { await element.dispose(); }
        }
        const state = await frame.evaluate(({ beneficiaries, parentTitle }) => {
          const scope = globalThis as unknown as { document: any; getComputedStyle(element: unknown): any };
          const doc = scope.document, body = doc.body;
          const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f\u00ad\u200b-\u200d\ufeff]/g, "")
            .replace(/\s+/g, " ").trim().toLowerCase();
          const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const visible = (element: any) => {
            const bounds = element.getBoundingClientRect(), style = scope.getComputedStyle(element);
            return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          };
          if (!body || !visible(body)) return { document: false, matches: beneficiaries.map(() => false) };
          const readonly = Array.from(doc.querySelectorAll('input[readonly]:not([type="password"]), textarea[readonly]') as any[])
            .filter(visible).map(input => input.value ?? "").join(" ");
          const text = normalize(`${body.innerText} ${readonly}`);
          const cardMarker = /carteira\s+provisoria|carteirinha|cartao\s+(?:do\s+beneficiario|de\s+identificacao)/
            .test(`${normalize(doc.title)} ${normalize(parentTitle)} ${text}`);
          const operationForm = doc.querySelector('input[type="password"]') || Array.from(doc.querySelectorAll('input[type="checkbox"], input[type="radio"], #p_cd_empresa, #p_cd_senha') as any[]).some(visible);
          const portalError = /identificacao\s+invalida|sessao\s+expirada|acesso\s+negado|nao\s+foi\s+possivel\s+(?:emitir|gerar)/.test(text);
          const matches = beneficiaries.map(input => {
            const name = normalize(input.beneficiaryName);
            const fullName = new RegExp(`(?:^|[^a-z0-9])${escape(name)}(?:$|[^a-z0-9])`).test(text);
            const prefix = name.split(" ").slice(0, 2).join(" ");
            const namePrefix = prefix.includes(" ") && new RegExp(`(?:^|[^a-z0-9])${escape(prefix)}(?:$|[^a-z0-9])`).test(text);
            const identifiers = [...(input.cardIdentifiers ?? []), ...(input.cpf ? [input.cpf] : [])];
            const identity = identifiers.some(value => {
              const digits = value.replace(/\D/g, "");
              return digits.length >= 6 && new RegExp(`(?:^|[^0-9])${digits.split("").join("[\\s.\\/-]*")}(?:$|[^0-9])`).test(text);
            });
            // A shortened printed name needs an identifier from the selected row. Homonyms always need it.
            return input.requireIdentifier ? (fullName || namePrefix) && identity : fullName || (namePrefix && identity);
          });
          const document = cardMarker && !operationForm && !portalError && Boolean(text) &&
            (matches.some(Boolean) || /\bnome\b|\bplano\b|\bvalidade\b|\bcodigo\b/.test(text));
          return { document, matches: document ? matches : beneficiaries.map(() => false) };
        }, { beneficiaries, parentTitle });
        return { ...state, frame };
      } catch { return undefined; }
    }));
    lastStates = states.filter((state): state is NonNullable<typeof state> => Boolean(state));
    const uncovered = new Set(beneficiaries.map((_, index) => index));
    const documents: Frame[] = [];
    for (const state of [...lastStates].sort((a, b) => b.matches.filter(Boolean).length - a.matches.filter(Boolean).length)) {
      const covered = [...uncovered].filter(index => state.matches[index]);
      if (!covered.length) continue;
      documents.push(state.frame); covered.forEach(index => uncovered.delete(index));
    }
    if (!uncovered.size) return documents;
    await delay(Math.min(100, Math.max(0, deadline - Date.now())));
  }
  const matched = beneficiaries.filter((_, index) => lastStates.some(state => state.matches[index])).length;
  const safeDetails = `Documentos legiveis: ${lastStates.filter(state => state.document).length}; beneficiarios confirmados: ${matched}/${beneficiaries.length}; frames examinados: ${lastStates.length}.`;
  if (lastStates.some(state => state.document)) {
    throw new AutomationError("CARD_VALIDATION_FAILED", "A carteirinha gerada nao corresponde aos dados da selecao.", {
      safeDetails, step: "validate_card_preview", retryable: false,
    });
  }
  throw new AutomationError("CARD_PREVIEW_NOT_FOUND", "O portal nao apresentou uma carteirinha legivel para conferência.", {
    safeDetails: `${safeDetails} Uma tela de espera, login ou lista nao confirma o documento.`, step: "validate_card_preview", retryable: true,
  });
}

// Read only validated documents; preserve the portal's card text, images and styles when printing a frame.
export async function materializeCardDocuments(page: Page, frames: Frame[], always = false) {
  if (!always && frames.length === 1 && frames[0] === page.mainFrame() && !await page.locator('input[readonly], textarea[readonly]').count()) return;
  const documents = await Promise.all(frames.map(frame => frame.evaluate(() => {
    const doc = (globalThis as unknown as { document: any }).document;
    const body = doc.body.cloneNode(true);
    for (const element of body.querySelectorAll('script, iframe, frame, object, embed, button, input[type="password"], input:not([readonly]), select, nav')) element.remove();
    for (const input of body.querySelectorAll('input[readonly], textarea[readonly]')) {
      const replacement = doc.createElement("span"); replacement.textContent = input.value; input.replaceWith(replacement);
    }
    for (const element of body.querySelectorAll("*")) {
      for (const attribute of Array.from(element.attributes) as any[]) {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      }
      if (element.tagName === "IMG") element.setAttribute("src", new URL(element.getAttribute("src") || "", doc.baseURI).href);
      if (element.tagName === "A") element.removeAttribute("href");
    }
    const styles = Array.from(doc.querySelectorAll('style, link[rel="stylesheet"]') as any[]).map(element => {
      const copy = element.cloneNode(true);
      if (copy.tagName === "LINK") copy.href = new URL(element.href, doc.baseURI).href;
      return copy.outerHTML;
    }).join("");
    return { html: body.innerHTML, styles, baseUri: doc.baseURI };
  })));
  await page.evaluate(({ documents }) => {
    const doc = (globalThis as unknown as { document: any }).document;
    if (documents[0]?.baseUri && !documents[0].baseUri.startsWith("about:")) {
      doc.querySelector("base")?.remove();
      const base = doc.createElement("base"); base.href = documents[0].baseUri; doc.head.prepend(base);
    }
    doc.body.innerHTML = documents.map(document => `<section class="koa-card-document">${document.html}</section>`).join("");
    doc.head.insertAdjacentHTML("beforeend", documents.map(document => document.styles).join(""));
    const style = doc.createElement("style");
    style.textContent = ".koa-card-document { break-after: page; } .koa-card-document:last-child { break-after: auto; }";
    doc.head.appendChild(style);
  }, { documents });
  await page.waitForFunction(() => {
    const doc = (globalThis as unknown as { document: any }).document;
    return doc.fonts?.status !== "loading" && Array.from(doc.images as any[]).every(img => img.complete);
  }, undefined, { timeout: 10_000 }).then(handle => handle.dispose()).catch(() => {
    throw new AutomationError("CARD_PREVIEW_NOT_FOUND", "A carteirinha nao terminou de carregar para impressao.", { step: "validate_card_preview", retryable: true });
  });
}
