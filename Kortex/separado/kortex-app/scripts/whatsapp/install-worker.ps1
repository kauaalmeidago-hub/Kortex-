param(
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [ValidateSet('Install','Status','Remove')][string]$Action = 'Install'
)
$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$workerEnvPath = (Resolve-Path -LiteralPath $EnvFile).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$nodeMajor = [int]((& $nodePath -p 'process.versions.node').Trim().Split('.')[0])
if ($nodeMajor -lt 22) { throw 'Este worker precisa de Node.js 22 ou superior.' }
$projectRef = (& $nodePath ("--env-file=" + $workerEnvPath) -e "const u=new URL(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL);process.stdout.write(u.hostname.split('.')[0]);").Trim()
if ($LASTEXITCODE -ne 0 -or $projectRef -notmatch '^[a-z0-9-]{8,80}$') { throw 'Confira a URL do Supabase no arquivo privado do worker.' }
$taskName = 'Kortex-WhatsApp-' + $projectRef
$logRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Kortex/whatsapp'
$logFile = Join-Path $logRoot ($projectRef + '.log')
if ($Action -eq 'Remove') {
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) { Stop-ScheduledTask -TaskName $taskName; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
  Write-Output 'Agendamento do worker removido. As sessoes da Evolution e os arquivos privados foram preservados.'
  exit 0
}
if ($Action -eq 'Status') {
  Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Select-Object TaskName,State
  & $nodePath ("--env-file=" + $workerEnvPath) (Join-Path $appRoot 'scripts/whatsapp/worker-health.mjs')
  exit $LASTEXITCODE
}
Set-Location -LiteralPath $appRoot
& $nodePath ("--env-file=" + $workerEnvPath) (Join-Path $appRoot 'server/whatsapp/worker.mjs') --relay --check
if ($LASTEXITCODE -ne 0) { throw 'A verificacao do worker falhou. Confira a Evolution, as variaveis privadas e a migracao deste ambiente.' }
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$runnerPath = Join-Path $PSScriptRoot 'run-worker.ps1'
$taskArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runnerPath + '" -NodePath "' + $nodePath + '" -AppRoot "' + $appRoot + '" -EnvFile "' + $workerEnvPath + '" -LogFile "' + $logFile + '"'
$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArguments -WorkingDirectory $appRoot
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) { Stop-ScheduledTask -TaskName $taskName }
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
$ready = $false
for ($attempt = 0; $attempt -lt 12; $attempt++) {
  Start-Sleep -Seconds 1
  & $nodePath ("--env-file=" + $workerEnvPath) (Join-Path $appRoot 'scripts/whatsapp/worker-health.mjs')
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
}
if (-not $ready) { throw ('O worker foi agendado, mas ainda nao confirmou atividade. Confira o log privado: ' + $logFile) }
Write-Output ('Worker ativo e agendado para iniciar ao entrar no Windows. Log privado: ' + $logFile)
Write-Output 'A Evolution e o computador precisam permanecer ligados. Nenhuma sessao existente foi desconectada.'
