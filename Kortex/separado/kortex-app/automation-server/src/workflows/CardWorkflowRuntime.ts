import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CARD_ISSUE_WORKFLOW_VERSION = 14;

// Capture the files and process at module load, so a git pull cannot relabel a running worker.
const runtimeDirectory = fileURLToPath(new URL("../../", import.meta.url));
const codeKind = import.meta.url.endsWith(".ts") ? "source" : "compiled";
const extension = codeKind === "source" ? "ts" : "js";
const codeFingerprint = (() => {
  try {
    const hash = createHash("sha256");
    for (const file of [`./CardPortalSearch.${extension}`, `./hapvida/emitCard.${extension}`,
      `./hapvida/pageObjects/HapvidaCardPage.${extension}`, `./hapvida/cardPreview.${extension}`,
      `./hapvida/cardList.${extension}`, `./hapvida/cardIdentity.${extension}`,
      `./hapvida/singleCardCapture.${extension}`, `./hapvida/nativeCardDelivery.${extension}`]) {
      hash.update(file).update("\0").update(readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n"));
    }
    return hash.digest("hex");
  } catch { return undefined; }
})();
const gitCommit = (() => {
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: runtimeDirectory, encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[a-f0-9]{40}$/.test(value) ? value : undefined;
  } catch { return undefined; }
})();

export function cardWorkflowRuntime() {
  return { runtimeDirectory, processId: process.pid, codeKind, codeFingerprint, gitCommit };
}

export function isCurrentCardWorkflowRuntime(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const running = value as Record<string, unknown>;
  return running.version === CARD_ISSUE_WORKFLOW_VERSION &&
    typeof running.runtimeDirectory === "string" && resolve(running.runtimeDirectory) === resolve(runtimeDirectory) &&
    typeof running.codeFingerprint === "string" && /^[a-f0-9]{64}$/.test(running.codeFingerprint) &&
    running.codeFingerprint === codeFingerprint;
}
