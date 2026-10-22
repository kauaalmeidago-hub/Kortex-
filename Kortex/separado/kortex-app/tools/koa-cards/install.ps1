param([Parameter(Mandatory=$true)][string]$EnvFile)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path -LiteralPath $PSScriptRoot).Path
$configPath=(Resolve-Path -LiteralPath $EnvFile).Path
$nodePath=(Get-Command node.exe).Source
$supervisorPath=Join-Path $taskRoot 'supervisor.mjs'
$statePath=Join-Path $env:LOCALAPPDATA 'Kortex\WhatsAppCards'
New-Item -ItemType Directory -Path $statePath -Force | Out-Null
$startupPath=[Environment]::GetFolderPath('Startup')
$vbsPath=Join-Path $startupPath 'Kortex-WhatsApp-Cards.vbs'
$runCommand='"'+$nodePath+'" --max-old-space-size=128 --v8-pool-size=1 "'+$supervisorPath+'" "'+$configPath+'"'
$vbs='Set shell = CreateObject("WScript.Shell")'+[Environment]::NewLine+'shell.Run "'+$runCommand.Replace('"','""')+'", 0, False'+[Environment]::NewLine
[IO.File]::WriteAllText($vbsPath,$vbs,[Text.Encoding]::Unicode)
$existing=Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($supervisorPath)}
if(-not $existing){Start-Process -FilePath $nodePath -ArgumentList ('--max-old-space-size=128 --v8-pool-size=1 "'+$supervisorPath+'" "'+$configPath+'"') -WorkingDirectory $taskRoot -WindowStyle Hidden}
Write-Output 'KOA_CARD_STARTUP_INSTALLED'
