import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export function ensureLocalApiToken(secretsDir: string) {
  if (process.env.KOA_AUTOMATION_TOKEN?.trim()) {
    return process.env.KOA_AUTOMATION_TOKEN.trim();
  }

  mkdirSync(secretsDir, { recursive: true });
  const tokenPath = path.join(secretsDir, "local-api-token.txt");

  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, "utf8").trim();
  }

  const token = randomBytes(32).toString("base64url");
  writeFileSync(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
}
