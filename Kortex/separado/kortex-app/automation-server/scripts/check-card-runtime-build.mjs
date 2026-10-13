import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCardBuildIdentity, writeCardBuildIdentity } from "./card-runtime-build.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "Kortex compilacao antiga "));
const source = path.join(root, "src", "workflows", "CardWorkflowRuntime.ts");
const compiled = path.join(root, "dist", "workflows", "CardWorkflowRuntime.js");
const sourceSearch = path.join(root, "src", "workflows", "CardPortalSearch.ts");
const compiledSearch = path.join(root, "dist", "workflows", "CardPortalSearch.js");
const stamp = path.join(root, "dist", "card-workflow-build.json");
const runtime = version => `export const CARD_ISSUE_WORKFLOW_VERSION = ${version};\n`;
const search = "export const search = () => 'hapvida e ndi';\n";
fs.mkdirSync(path.dirname(source), { recursive: true });
fs.mkdirSync(path.dirname(compiled), { recursive: true });
fs.writeFileSync(source, runtime(14)); fs.writeFileSync(compiled, runtime(12));
fs.writeFileSync(sourceSearch, search); fs.writeFileSync(compiledSearch, search);
try {
  assert.deepEqual(readCardBuildIdentity(root), { current: false, reason: "CARD_WORKFLOW_VERSION_MISMATCH", sourceVersion: 14, compiledVersion: 12 });
  assert.throws(() => writeCardBuildIdentity(root), /CARD_WORKFLOW_VERSION_MISMATCH/);
  console.log("SOURCE_14_COMPILED_12_REJECTED = OK");
  fs.writeFileSync(compiled, runtime(14));
  assert.equal(readCardBuildIdentity(root).current, false);
  console.log("LEGACY_BUILD_WITHOUT_PROVENANCE_REJECTED = OK");
  writeCardBuildIdentity(root);
  assert.equal(readCardBuildIdentity(root).current, true);
  console.log("FRESH_BUILD_ACCEPTED = OK");
  fs.appendFileSync(sourceSearch, "// atualizacao apos git pull\n");
  assert.equal(readCardBuildIdentity(root).reason, "SOURCE_CHANGED_SINCE_BUILD");
  fs.writeFileSync(sourceSearch, search);
  assert.equal(readCardBuildIdentity(root).current, true);
  console.log("SAME_VERSION_SOURCE_UPDATE_REJECTED = OK");
  fs.appendFileSync(compiledSearch, "// compilacao alterada\n");
  assert.equal(readCardBuildIdentity(root).reason, "COMPILED_FILES_CHANGED");
  fs.writeFileSync(compiledSearch, search);
  console.log("COMPILED_FILE_CHANGE_REJECTED = OK");
  for (const file of [source, compiled, sourceSearch, compiledSearch]) {
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
  }
  assert.equal(readCardBuildIdentity(root).current, true);
  console.log("WINDOWS_LINE_ENDINGS_ACCEPTED = OK");
  fs.writeFileSync(stamp, "{}");
  assert.equal(readCardBuildIdentity(root).reason, "BUILD_METADATA_INVALID");
  console.log("INVALID_BUILD_METADATA_REJECTED = OK");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
