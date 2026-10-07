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

$ref = Read-Host "CredentialRef (ex.: hapvida:11111111-1111-4111-8111-111111111111)"
if ([string]::IsNullOrWhiteSpace($ref)) {
  throw "CredentialRef obrigatorio."
}

$username = Read-Host "Usuario/codigo do portal"
if ([string]::IsNullOrWhiteSpace($username)) {
  throw "Usuario/codigo do portal obrigatorio."
}

$password = Read-Host "Senha do portal" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
  if ([string]::IsNullOrWhiteSpace($plainPassword)) {
    throw "Senha do portal obrigatoria."
  }

  $payload = @{
    username = $username
    password = $plainPassword
  } | ConvertTo-Json -Compress

  $encrypted = Protect-LocalSecret $payload
  $file = Join-Path $secretsDir "$(ConvertTo-SafeFileName $ref).credential.dpapi"
  Set-Content -LiteralPath $file -Value $encrypted -NoNewline

  Write-Host "Credencial segura salva para ref: $ref"
} finally {
  if ($passwordPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
  }

  $plainPassword = $null
  $payload = $null
}
