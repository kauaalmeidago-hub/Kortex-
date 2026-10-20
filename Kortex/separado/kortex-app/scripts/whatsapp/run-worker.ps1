param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$AppRoot,
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [Parameter(Mandatory=$true)][string]$LogFile
)
$ErrorActionPreference = 'Stop'
try {
  Set-Location -LiteralPath $AppRoot
  # Also ensure the log directory exists when the scheduled runner starts later.
  New-Item -ItemType Directory -Path (Split-Path -Parent $LogFile) -Force | Out-Null
  if ((Test-Path -LiteralPath $LogFile) -and (Get-Item -LiteralPath $LogFile).Length -gt 5242880) {
    Move-Item -LiteralPath $LogFile -Destination ($LogFile + '.previous') -Force
  }
  # Windows PowerShell treats redirected native stderr as ErrorRecord; with
  # Stop this would terminate the relay on its first recoverable warning.
  $workerArguments = '"--env-file=' + $EnvFile + '" "' + (Join-Path $AppRoot 'server/whatsapp/worker.mjs') + '" --relay'
  $workerProcess = Start-Process -FilePath $NodePath -ArgumentList $workerArguments -WorkingDirectory $AppRoot -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError ($LogFile + '.error') -Wait -PassThru
  exit $workerProcess.ExitCode
} catch {
  # Never include exception text that could contain environment values.
  Add-Content -LiteralPath $LogFile -Value '{"code":"WA_WORKER_LAUNCH_FAILED"}'
  exit 1
}
