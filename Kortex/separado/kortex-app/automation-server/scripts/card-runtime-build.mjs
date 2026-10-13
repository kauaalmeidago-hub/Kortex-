import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function sourceFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path.join(directory, entry.name), `${relative}/`);
    return entry.isFile() && entry.name.endsWith(".ts") && !/\.(?:test|d)\.ts$/.test(entry.name) ? [relative] : [];
  }).sort();
}

function fingerprint(directory, files, compiled = false) {
  const hash = createHash("sha256");
  for (const source of files) {
    const file = compiled ? source.replace(/\.ts$/, ".js") : source;
    hash.update(file).update("\0").update(fs.readFileSync(path.join(directory, file), "utf8").replace(/\r\n/g, "\n")).update("\0");
  }
  return hash.digest("hex");
}

function versions(serverDir) {
  const read = extension => {
    const file = path.join(serverDir, extension === "ts" ? "src" : "dist", "workflows", `CardWorkflowRuntime.${extension}`);
    const match = /\bCARD_ISSUE_WORKFLOW_VERSION\s*=\s*(\d+)\s*;/.exec(fs.readFileSync(file, "utf8"));
    if (!match) throw new Error("CARD_WORKFLOW_VERSION_MISSING");
    return Number(match[1]);
  };
  return { sourceVersion: read("ts"), compiledVersion: read("js") };
}

function signatures(serverDir) {
  const files = sourceFiles(path.join(serverDir, "src"));
  if (!files.length) throw new Error("BACKEND_SOURCE_MISSING");
  return { sourceFingerprint: fingerprint(path.join(serverDir, "src"), files),
    compiledFingerprint: fingerprint(path.join(serverDir, "dist"), files, true) };
}

export function readCardBuildIdentity(serverDir) {
  let version;
  try {
    version = versions(serverDir);
    if (version.sourceVersion !== version.compiledVersion) return { current: false, reason: "CARD_WORKFLOW_VERSION_MISMATCH", ...version };
    const stamp = JSON.parse(fs.readFileSync(path.join(serverDir, "dist", "card-workflow-build.json"), "utf8"));
    if (stamp.formatVersion !== 1 || stamp.workflowVersion !== version.sourceVersion) return { current: false, reason: "BUILD_METADATA_INVALID", ...version };
    const current = signatures(serverDir);
    if (stamp.sourceFingerprint !== current.sourceFingerprint) return { current: false, reason: "SOURCE_CHANGED_SINCE_BUILD", ...version };
    if (stamp.compiledFingerprint !== current.compiledFingerprint) return { current: false, reason: "COMPILED_FILES_CHANGED", ...version };
    return { current: true, ...version, ...current };
  } catch {
    return { current: false, reason: "BUILD_METADATA_OR_FILES_UNAVAILABLE", ...version };
  }
}

export function writeCardBuildIdentity(serverDir) {
  const version = versions(serverDir);
  if (version.sourceVersion !== version.compiledVersion) throw new Error("CARD_WORKFLOW_VERSION_MISMATCH: execute novamente a compilacao do worker.");
  const stamp = { formatVersion: 1, workflowVersion: version.sourceVersion, ...signatures(serverDir) };
  const file = path.join(serverDir, "dist", "card-workflow-build.json");
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(stamp, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
  return stamp;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "write") throw new Error("Use node scripts/card-runtime-build.mjs write depois de compilar o worker.");
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const stamp = writeCardBuildIdentity(serverDir);
  console.log(`Compilacao do worker conferida: fluxo de carteirinhas ${stamp.workflowVersion}.`);
}
