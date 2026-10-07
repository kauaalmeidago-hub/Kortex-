import { spawn } from "node:child_process";

function runPowerShell(script: string, input: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `PowerShell exited with code ${code}`));
    });

    child.stdin.end(input, "utf8");
  });
}

export async function protectWithDpapi(plaintext: string) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    "$plaintext = [Console]::In.ReadToEnd()",
    "$bytes = [Text.Encoding]::UTF8.GetBytes($plaintext)",
    "$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($protected))",
  ].join("; ");

  return runPowerShell(script, plaintext);
}

export async function unprotectWithDpapi(encryptedPayload: string) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    "$encrypted = [Console]::In.ReadToEnd().Trim()",
    "$protected = [Convert]::FromBase64String($encrypted)",
    "$bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))",
  ].join("; ");

  return runPowerShell(script, encryptedPayload);
}
