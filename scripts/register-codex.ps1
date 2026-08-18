param(
  [string]$ConfigPath = (Join-Path ($env:USERPROFILE) '.codex\config.toml'),
  [string]$SystemsConfig = (Join-Path $PSScriptRoot '..\config\systems.yaml'),
  [string]$BusinessApisConfig = (Join-Path $PSScriptRoot '..\config\business-apis.yaml'),
  [switch]$Overwrite
)
$ErrorActionPreference = "Stop"
$resolvedConfig = [IO.Path]::GetFullPath($ConfigPath)
$resolvedSystems = [IO.Path]::GetFullPath($SystemsConfig)
$resolvedBusiness = [IO.Path]::GetFullPath($BusinessApisConfig)
$section = '[mcp_servers.mcp-sap-adt-local]'
$existing = if (Test-Path -LiteralPath $resolvedConfig) { Get-Content -LiteralPath $resolvedConfig -Raw } else { '' }
if ($existing -match '(?m)^\[mcp_servers\.mcp-sap-adt-local\]') {
  if (-not $Overwrite) { throw "mcp-sap-adt-local is already registered. Use -Overwrite to back up and replace it." }
  $existing = [regex]::Replace($existing, '(?ms)^\[mcp_servers\.mcp-sap-adt-local\.env\]\r?\n.*?(?=^\[|\z)', '')
  $existing = [regex]::Replace($existing, '(?ms)^\[mcp_servers\.mcp-sap-adt-local\]\r?\n.*?(?=^\[|\z)', '')
}
$parent = Split-Path -Parent $resolvedConfig
New-Item -ItemType Directory -Force -Path $parent | Out-Null
if (Test-Path -LiteralPath $resolvedConfig) {
  $backup = "$resolvedConfig.backup-$(Get-Date -Format yyyyMMddHHmmss)"
  Copy-Item -LiteralPath $resolvedConfig -Destination $backup
  Write-Output "Backed up Codex config to $backup"
}
$installedCommand = Get-Command mcp-sap-adt-local.cmd -ErrorAction Stop
$command = $installedCommand.Source
$commandToml = $command | ConvertTo-Json -Compress
$systemsToml = $resolvedSystems | ConvertTo-Json -Compress
$businessToml = $resolvedBusiness | ConvertTo-Json -Compress
$toml = @"
$section
command = $commandToml
args = ["serve"]

[mcp_servers.mcp-sap-adt-local.env]
MCP_SAP_SYSTEMS_CONFIG = $systemsToml
MCP_SAP_BUSINESS_APIS_CONFIG = $businessToml
"@
if ($existing -and -not $existing.EndsWith("`n")) { $existing += "`n" }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($resolvedConfig, ($existing + $toml), $utf8NoBom)
Write-Output "Registered mcp-sap-adt-local in $resolvedConfig"
Write-Output "Restart Codex desktop to reload MCP servers. Existing mcp-sap-assistant entry was preserved."
