import { readFile } from "node:fs/promises";
import { AutomationError } from "../../errors.js";

export type CardTemplateKind = "single" | "first" | "continuation";
export interface CardTemplateSlot { x: number; y: number; width: number; height: number; labelY?: number; defaultRole?: "holder" | "dependent" }

export const CARD_DELIVERY_TEMPLATES = {
  single: { width: 1093, height: 1439, slots: [{ x: 70, y: 610, width: 953, height: 548 }] },
  first: { width: 1086, height: 1448, slots: [
    { x: 274, y: 470, width: 538, height: 327, labelY: 393, defaultRole: "holder" },
    { x: 274, y: 933, width: 538, height: 334, labelY: 856, defaultRole: "dependent" },
  ] },
  continuation: { width: 1086, height: 1448, slots: [
    { x: 274, y: 422, width: 538, height: 358, labelY: 345, defaultRole: "holder" },
    { x: 274, y: 910, width: 538, height: 357, labelY: 833, defaultRole: "dependent" },
  ] },
} satisfies Record<CardTemplateKind, { width: number; height: number; slots: CardTemplateSlot[] }>;

const backgroundCache = new Map<CardTemplateKind, Promise<string>>();
export async function cardTemplateBackground(kind: CardTemplateKind) {
  let pending = backgroundCache.get(kind);
  if (!pending) {
    pending = readFile(new URL(`../../../assets/card-delivery/${kind}.png`, import.meta.url))
      .then(bytes => `data:image/png;base64,${bytes.toString("base64")}`).catch(() => {
        backgroundCache.delete(kind);
        throw new AutomationError("CARD_DELIVERY_FAILED", "A moldura da entrega nao esta disponivel nesta instalacao.", { step: "format_card_delivery", retryable: false });
      });
    backgroundCache.set(kind, pending);
  }
  return pending;
}
