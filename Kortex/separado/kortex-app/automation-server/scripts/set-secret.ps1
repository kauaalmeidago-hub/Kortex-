param(
  [Parameter(Mandatory=$true)]
  [string]$Ref,

  [Parameter(Mandatory=$true)]
  [string]$Username
)

$ErrorActionPreference = "Stop"

function ConvertTo-SafeFileName([string]$Value) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
  $base64 = [Convert]::ToBase64String($bytes)
  return $base64.Replace("+", "-").Replace("/", "_").TrimEnd("=")
}

function Protect-LocalSecret([string]$Value) {
  Add-Type -AssemblyName System.Security
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
  $protected = [Security.Cryptography.ProtectedData]::Protect(
    $bytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  return [Convert]::ToBase64String($protected)
}

$root = Split-Path -Parent $PSScriptRoot
$secretsDir = Join-Path $root "automation\secrets"
New-Item -ItemType Directory -Force -Path $secretsDir | Out-Null

$password = Read-Host "Senha do portal" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
  $payload = @{
    username = $Username
    password = $plainPassword
  } | ConvertTo-Json -Compress

  $encrypted = Protect-LocalSecret $payload
  $file = Join-Path $secretsDir "$(ConvertTo-SafeFileName $Ref).credential.dpapi"
  Set-Content -LiteralPath $file -Value $encrypted -NoNewline
  Write-Host "Credencial salva para ref: $Ref"
} finally {
  if ($passwordPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
  }
  $plainPassword = $null
  $payload = $null
}
