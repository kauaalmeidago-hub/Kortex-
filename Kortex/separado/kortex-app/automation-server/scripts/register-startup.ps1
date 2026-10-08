param(
    [Parameter(Mandatory = $true)][ValidateSet("Install", "Remove")][string]$Action,
    [string]$NodeExecutable,
    [string]$RuntimeDir,
    [string]$AppUrl
)
$ErrorActionPreference = "Stop"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "Kortex Koa.lnk"
if ($Action -eq "Remove") {
    if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
    exit 0
}
if (!(Test-Path -LiteralPath $NodeExecutable) -or !$RuntimeDir -or !$AppUrl) {
    throw "Node, runtime directory and application URL are required."
}
Add-Type -AssemblyName System.Security
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
# The installer sends the environment through stdin, never command-line arguments or a plaintext file.
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
$environmentJson = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($environmentJson)
try {
    $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllBytes((Join-Path $RuntimeDir "environment.dpapi"), $encrypted)
} finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$runner = Join-Path $PSScriptRoot "run-permanent.ps1"
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runner + '" -NodeExecutable "' + $NodeExecutable + '" -RuntimeDir "' + $RuntimeDir + '"'
$shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$shortcut.Description = "Kortex Koa - current user background runtime"
$shortcut.WindowStyle = 7
$shortcut.Save()
$desktopShortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Kortex.url"))
$desktopShortcut.TargetPath = $AppUrl
$desktopShortcut.Save()
