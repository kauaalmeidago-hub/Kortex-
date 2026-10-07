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
    "$plaintext = [Console]::In.ReadToEnd()",
    "$secure = ConvertTo-SecureString $plaintext -AsPlainText -Force",
    "[Console]::Out.Write((ConvertFrom-SecureString $secure))",
  ].join("; ");

  return runPowerShell(script, plaintext);
}

export async function unprotectWithDpapi(encryptedPayload: string) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$encrypted = [Console]::In.ReadToEnd()",
    "$secure = ConvertTo-SecureString $encrypted",
    "$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    "try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) }",
    "finally { if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) } }",
  ].join("; ");

  return runPowerShell(script, encryptedPayload);
}
