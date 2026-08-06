param(
  [ValidateSet('daily-report','vehicle-balance-report')]
  [string]$Mode = 'vehicle-balance-report',
  [string]$Root = 'C:\BinHamid\FuelAgent'
)

$ErrorActionPreference = 'Stop'
$AppDir = Join-Path $Root 'App'
$LogsDir = Join-Path $Root 'Logs'
$EvidenceDir = Join-Path $Root ('Evidence\{0}\{1}' -f $Mode,(Get-Date -Format 'yyyy-MM-dd-HHmmss'))
$ConfigPath = Join-Path $Root 'fuel-agent.env'
$NodePathFile = Join-Path $Root 'node-path.txt'
$LockPath = Join-Path $Root 'fuel-agent.lock'
$LogPath = Join-Path $LogsDir ('fuel-agent-{0}.log' -f (Get-Date -Format 'yyyy-MM-dd'))

foreach ($dir in @($Root,$AppDir,$LogsDir,$EvidenceDir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

function Write-AgentLog {
  param([string]$Level,[string]$Message,[object]$Data=$null)
  $suffix = if ($null -ne $Data) { ' | ' + ($Data | ConvertTo-Json -Compress -Depth 8) } else { '' }
  Add-Content -LiteralPath $LogPath -Value ('[{0}] [{1}] {2}{3}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),$Level,$Message,$suffix) -Encoding UTF8
}

function Import-AgentEnvironment {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Configuration file not found: $ConfigPath" }
  foreach ($line in Get-Content -LiteralPath $ConfigPath -Encoding UTF8) {
    $text = [string]$line
    if ([string]::IsNullOrWhiteSpace($text) -or $text.TrimStart().StartsWith('#')) { continue }
    $index = $text.IndexOf('=')
    if ($index -lt 1) { continue }
    $name = $text.Substring(0,$index).Trim()
    $value = $text.Substring($index + 1)
    if ($name) { [Environment]::SetEnvironmentVariable($name,$value,'Process') }
  }
}

if (Test-Path -LiteralPath $LockPath) {
  try {
    $age = (Get-Date) - (Get-Item -LiteralPath $LockPath).LastWriteTime
    if ($age.TotalMinutes -lt 35) {
      Write-AgentLog 'INFO' 'Another fuel-agent cycle is still active.' @{ mode=$Mode }
      exit 0
    }
  } catch {}
  Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
}

Set-Content -LiteralPath $LockPath -Value $PID -Encoding ASCII
try {
  Import-AgentEnvironment
  foreach ($name in @('NOOR_KHOY_USERNAME','NOOR_KHOY_PASSWORD','CRON_SECRET')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name,'Process'))) {
      throw "Missing required setting in fuel-agent.env: $name"
    }
  }

  $node = if (Test-Path -LiteralPath $NodePathFile) { (Get-Content -LiteralPath $NodePathFile -Raw).Trim() } else { '' }
  if (-not $node -or -not (Test-Path -LiteralPath $node)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { throw 'Node.js was not found. Re-run INSTALL-AS-ADMIN.cmd after installing Node.js.' }
    $node = $nodeCommand.Source
  }

  $env:FUEL_AGENT_MODE = $Mode
  $env:FUEL_SYNC_ARTIFACT_DIR = $EvidenceDir
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $Root 'Browsers'
  $env:NOOR_KHOY_LOGIN_URL = if ($env:NOOR_KHOY_LOGIN_URL) { $env:NOOR_KHOY_LOGIN_URL } else { 'https://www.norkhoysa.com/companies/login' }
  $env:NOOR_KHOY_DASHBOARD_URL = if ($env:NOOR_KHOY_DASHBOARD_URL) { $env:NOOR_KHOY_DASHBOARD_URL } else { 'https://www.norkhoysa.com/companies' }
  $env:NOOR_KHOY_REPORT_URL = if ($env:NOOR_KHOY_REPORT_URL) { $env:NOOR_KHOY_REPORT_URL } else { 'https://www.norkhoysa.com/companies/fuels?fueltype=all' }
  $env:NOOR_KHOY_VEHICLES_URL = if ($env:NOOR_KHOY_VEHICLES_URL) { $env:NOOR_KHOY_VEHICLES_URL } else { 'https://www.norkhoysa.com/companies/vehicles' }
  $env:BINHAMID_FUEL_UPLOAD_URL = if ($env:BINHAMID_FUEL_UPLOAD_URL) { $env:BINHAMID_FUEL_UPLOAD_URL } else { 'https://binhamid-factory-control.vercel.app/api/fuel/daily-report' }

  Write-AgentLog 'INFO' 'Fuel-agent cycle started.' @{ mode=$Mode; evidence=$EvidenceDir }
  $output = & $node (Join-Path $AppDir 'local-fuel-agent.mjs') 2>&1
  $exitCode = $LASTEXITCODE
  foreach ($line in @($output)) { Add-Content -LiteralPath $LogPath -Value ([string]$line) -Encoding UTF8 }
  if ($exitCode -ne 0) { throw "Fuel agent exited with code $exitCode." }
  Write-AgentLog 'SUCCESS' 'Fuel-agent cycle completed.' @{ mode=$Mode }
} catch {
  Write-AgentLog 'ERROR' 'Fuel-agent cycle failed.' @{ mode=$Mode; error=$_.Exception.Message }
  exit 1
} finally {
  Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
}
