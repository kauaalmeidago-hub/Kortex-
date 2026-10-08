param(
    [Parameter(Mandatory = $true)][string]$NodeExecutable,
    [Parameter(Mandatory = $true)][string]$RuntimeDir
)
$ErrorActionPreference = "Stop"
$mutex = New-Object System.Threading.Mutex($false, "Local\Kortex.KoaPermanentRuntime")
$owned = $false
try {
    try { $owned = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $owned = $true }
    if (!$owned) { exit 0 }
    Add-Type -AssemblyName System.Security
    $encrypted = [IO.File]::ReadAllBytes((Join-Path $RuntimeDir "environment.dpapi"))
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { $environment = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json }
    finally { [Array]::Clear($bytes, 0, $bytes.Length) }
    foreach ($property in $environment.PSObject.Properties) {
        [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, "Process")
    }
    Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
    $delay = 1
    while (!(Test-Path -LiteralPath (Join-Path $RuntimeDir "stop.request"))) {
        $startedAt = Get-Date
        # Windows PowerShell 5 must not promote native stderr into a terminating error.
        $ErrorActionPreference = "Continue"
        & $NodeExecutable (Join-Path $PSScriptRoot "permanent-runtime.mjs") *> $null
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = "Stop"
        if ($exitCode -eq 0) { break }
        if (((Get-Date) - $startedAt).TotalSeconds -ge 60) { $delay = 1 }
        Start-Sleep -Seconds $delay
        $delay = [Math]::Min(30, $delay * 2)
    }
} finally {
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
