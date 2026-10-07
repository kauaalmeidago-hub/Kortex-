param(
  [string]$CsvPath = "$env:USERPROFILE\Downloads\Google Passwords.csv",

  [string[]]$AllowedHostTerms = @("hapvida", "webhap", "ndi", "sigo")
)

$ErrorActionPreference = "Stop"

function ConvertTo-SafeFileName([string]$Value) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
  $base64 = [Convert]::ToBase64String($bytes)
  return $base64.Replace("+", "-").Replace("/", "_").TrimEnd("=")
}

function Get-HostFromUrl([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  try {
    return ([Uri]$Value).Host
  } catch {
    return $Value
  }
}

function Mask-Username([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return "(sem usuario)"
  }

  if ($Value.Length -le 4) {
    return "***"
  }

  return "$($Value.Substring(0, 2))***$($Value.Substring($Value.Length - 2))"
}

if (-not (Test-Path -LiteralPath $CsvPath)) {
  throw "CSV nao encontrado: $CsvPath"
}

$rows = Import-Csv -LiteralPath $CsvPath
$matches = @()

foreach ($row in $rows) {
  $url = [string]$row.url
  $name = [string]$row.name
  $host = Get-HostFromUrl $url
  $searchText = "$name $url $host".ToLowerInvariant()
  $hasAllowedHost = $false

  foreach ($term in $AllowedHostTerms) {
    if ($searchText.Contains($term.ToLowerInvariant())) {
      $hasAllowedHost = $true
      break
    }
  }

  if ($hasAllowedHost -and -not [string]::IsNullOrWhiteSpace([string]$row.username) -and -not [string]::IsNullOrWhiteSpace([string]$row.password)) {
    $matches += [PSCustomObject]@{
      Name = $name
      Host = $host
      Username = [string]$row.username
      Password = [string]$row.password
    }
  }
}

if ($matches.Count -eq 0) {
  throw "Nenhuma credencial permitida encontrada. Ajuste AllowedHostTerms somente para portais autorizados."
}

Write-Host ""
Write-Host "Credenciais candidatas encontradas. Senhas nao serao exibidas."
Write-Host ""

for ($i = 0; $i -lt $matches.Count; $i++) {
  $item = $matches[$i]
  Write-Host ("[{0}] {1} | {2} | {3}" -f ($i + 1), $item.Host, (Mask-Username $item.Username), $item.Name)
}

Write-Host ""
$selection = Read-Host "Digite o numero da credencial que deseja salvar no Koa"
$index = 0
if (-not [int]::TryParse($selection, [ref]$index) -or $index -lt 1 -or $index -gt $matches.Count) {
  throw "Selecao invalida."
}

$selected = $matches[$index - 1]
$ref = Read-Host "CredentialRef de destino (ex.: hapvida:11111111-1111-4111-8111-111111111111)"
if ([string]::IsNullOrWhiteSpace($ref)) {
  throw "CredentialRef obrigatorio."
}

$confirm = Read-Host "Salvar esta credencial especifica no DPAPI local do Koa? Digite SALVAR para confirmar"
if ($confirm -ne "SALVAR") {
  throw "Operacao cancelada pelo operador."
}

$root = Split-Path -Parent $PSScriptRoot
$secretsDir = Join-Path $root "automation\secrets"
New-Item -ItemType Directory -Force -Path $secretsDir | Out-Null

try {
  $payload = @{
    username = $selected.Username
    password = $selected.Password
  } | ConvertTo-Json -Compress

  $securePayload = ConvertTo-SecureString $payload -AsPlainText -Force
  $encrypted = ConvertFrom-SecureString $securePayload
  $file = Join-Path $secretsDir "$(ConvertTo-SafeFileName $ref).credential.dpapi"
  Set-Content -LiteralPath $file -Value $encrypted -NoNewline

  Write-Host "Credencial segura salva para ref: $ref"
} finally {
  $payload = $null
  $selected.Password = $null
  $matches = $null
  $rows = $null
}
