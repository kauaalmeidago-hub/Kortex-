param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$AppRoot,
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [Parameter(Mandatory=$true)][string]$LogFile
)
$ErrorActionPreference = 'Stop'
try {
  Set-Location -LiteralPath $AppRoot
  if ((Test-Path -LiteralPath $LogFile) -and (Get-Item -LiteralPath $LogFile).Length -gt 5242880) {
    Move-Item -LiteralPath $LogFile -Destination ($LogFile + '.previous') -Force
  }
  & $NodePath ("--env-file=" + $EnvFile) (Join-Path $AppRoot 'server/whatsapp/worker.mjs') --relay *>> $LogFile
  exit $LASTEXITCODE
} catch {
  # Never include exception text that could contain environment values.
  Add-Content -LiteralPath $LogFile -Value '{"code":"WA_WORKER_LAUNCH_FAILED"}'
  exit 1
}
