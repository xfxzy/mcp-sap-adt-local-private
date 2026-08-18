$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) { throw "Node.js 20.18.1+ and npm are required." }
$nodeVersion = (& $node.Source --version).TrimStart('v')
if ([version]$nodeVersion -lt [version]'20.18.1') { throw "Node.js $nodeVersion is too old; install 20.18.1 or newer." }

function Invoke-ProjectNpm {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $quotedRoot = '"' + $projectRoot.Replace('"', '""') + '"'
  $quotedNpm = '"' + $npm.Source.Replace('"', '""') + '"'
  $quotedArguments = ($Arguments | ForEach-Object { '"' + $_.Replace('"', '""') + '"' }) -join ' '
  $commandLine = "pushd $quotedRoot && $quotedNpm $quotedArguments"
  $output = & cmd.exe /d /s /c $commandLine
  if ($LASTEXITCODE -ne 0) { throw "npm $($Arguments -join ' ') failed" }
  return $output
}

$packRoot = Join-Path ([IO.Path]::GetTempPath()) ("mcp-sap-adt-local-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $packRoot | Out-Null
try {
  Invoke-ProjectNpm @('ci') | Out-Host
  Invoke-ProjectNpm @('run', 'check') | Out-Host
  $packJson = Invoke-ProjectNpm @('pack', '--json', '--pack-destination', $packRoot)
  $packageName = ($packJson | ConvertFrom-Json)[0].filename
  $packagePath = Join-Path $packRoot $packageName
  Invoke-ProjectNpm @('install', '--global', $packagePath) | Out-Host
  Write-Output "Installed mcp-sap-adt-local from $packageName"
}
finally {
  Remove-Item -LiteralPath $packRoot -Recurse -Force
}
