param(
  [string]$Root = 'C:\BinHamid\DailyReports',
  [string]$PolicyUrl = 'https://binhamid-factory-control.vercel.app/api/router?route=erp-failed-retry-policy'
)

$ErrorActionPreference = 'Stop'
$IncomingDir = Join-Path $Root 'Incoming'
$FailedDir = Join-Path $Root 'Failed'
$LogsDir = Join-Path $Root 'Logs'
$SupersededDir = Join-Path $Root 'ManualReview\Superseded'
$StatePath = Join-Path $LogsDir 'failed-review-agent-state.json'
$LogPath = Join-Path $LogsDir ('failed-review-agent-{0}.log' -f (Get-Date -Format 'yyyy-MM-dd'))
$LockPath = Join-Path $LogsDir 'failed-review-agent.lock'

foreach ($dir in @($IncomingDir,$FailedDir,$LogsDir,$SupersededDir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

function Write-AgentLog {
  param([string]$Level,[string]$Message,[object]$Data=$null)
  $suffix = if ($null -ne $Data) { ' | ' + ($Data | ConvertTo-Json -Compress -Depth 8) } else { '' }
  $line = '[{0}] [{1}] {2}{3}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),$Level,$Message,$suffix
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Load-State {
  if (-not (Test-Path -LiteralPath $StatePath)) {
    return [pscustomobject]@{ version = 1; attempts = @() }
  }
  try {
    $loaded = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $loaded.attempts) { $loaded | Add-Member -NotePropertyName attempts -NotePropertyValue @() }
    return $loaded
  } catch {
    Write-AgentLog 'WARN' 'State file was unreadable; a fresh state was created.' @{ error = $_.Exception.Message }
    return [pscustomobject]@{ version = 1; attempts = @() }
  }
}

function Save-State {
  param($State)
  $temp = "$StatePath.tmp"
  $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $StatePath -Force
}

function Get-ReportDateFromName {
  param([string]$Name)
  $match = [regex]::Match($Name,'^Daily-Report-(20\d{2}-\d{2}-\d{2})','IgnoreCase')
  if ($match.Success) { return $match.Groups[1].Value }
  return ''
}

function Get-ErrorCodeFromName {
  param([string]$Name)
  $matches = [regex]::Matches($Name,'ERP_[A-Z0-9_]+','IgnoreCase')
  if ($matches.Count -gt 0) { return $matches[$matches.Count - 1].Value.ToUpperInvariant() }
  return ''
}

function Move-Unique {
  param([System.IO.FileInfo]$File,[string]$DestinationDirectory,[string]$DestinationName)
  $destination = Join-Path $DestinationDirectory $DestinationName
  if (Test-Path -LiteralPath $destination) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($DestinationName)
    $ext = [System.IO.Path]::GetExtension($DestinationName)
    $destination = Join-Path $DestinationDirectory (('{0}-{1}{2}' -f $base,[guid]::NewGuid().ToString('N').Substring(0,8),$ext))
  }
  Move-Item -LiteralPath $File.FullName -Destination $destination -Force
  return $destination
}

if (Test-Path -LiteralPath $LockPath) {
  try {
    $age = (Get-Date) - (Get-Item -LiteralPath $LockPath).LastWriteTime
    if ($age.TotalMinutes -lt 15) {
      Write-AgentLog 'INFO' 'Another failed-review cycle is still active.'
      exit 0
    }
  } catch {}
  Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
}

Set-Content -LiteralPath $LockPath -Value $PID -Encoding ASCII
try {
  try {
    $policy = Invoke-RestMethod -Uri $PolicyUrl -Method Get -TimeoutSec 20 -Headers @{ 'Cache-Control'='no-cache' }
  } catch {
    Write-AgentLog 'ERROR' 'Retry policy could not be loaded; no failed file was moved.' @{ error = $_.Exception.Message }
    exit 2
  }

  if (-not $policy.ok -or [string]::IsNullOrWhiteSpace([string]$policy.revision)) {
    Write-AgentLog 'ERROR' 'Retry policy response was invalid; no failed file was moved.'
    exit 3
  }

  $revision = [string]$policy.revision
  $state = Load-State
  $files = @(Get-ChildItem -LiteralPath $FailedDir -File -Filter '*.xlsx' -ErrorAction SilentlyContinue)
  $reviewed = @()

  foreach ($file in $files) {
    $reportDate = Get-ReportDateFromName $file.Name
    $errorCode = Get-ErrorCodeFromName $file.Name
    if ([string]::IsNullOrWhiteSpace($reportDate) -or [string]::IsNullOrWhiteSpace($errorCode)) {
      continue
    }
    $property = $policy.policies.PSObject.Properties[$errorCode]
    $rule = if ($null -ne $property) { $property.Value } else { $policy.defaultPolicy }
    $reviewed += [pscustomobject]@{
      File = $file
      ReportDate = $reportDate
      ErrorCode = $errorCode
      Rule = $rule
    }
  }

  $retryable = @($reviewed | Where-Object { $_.Rule.autoRetry -eq $true })
  foreach ($group in ($retryable | Group-Object ReportDate)) {
    $ordered = @($group.Group | Sort-Object { $_.File.LastWriteTimeUtc } -Descending)
    if ($ordered.Count -eq 0) { continue }
    $chosen = $ordered[0]

    foreach ($older in @($ordered | Select-Object -Skip 1)) {
      $supersededName = '{0}-superseded-{1}{2}' -f [System.IO.Path]::GetFileNameWithoutExtension($older.File.Name),(Get-Date -Format 'yyyyMMdd-HHmmss'),$older.File.Extension
      try {
        $target = Move-Unique -File $older.File -DestinationDirectory $SupersededDir -DestinationName $supersededName
        Write-AgentLog 'INFO' 'Older retryable file moved to manual superseded review.' @{ file=$older.File.Name; target=$target; reportDate=$older.ReportDate }
      } catch {
        Write-AgentLog 'WARN' 'Older retryable file could not be moved.' @{ file=$older.File.Name; error=$_.Exception.Message }
      }
    }

    if (-not (Test-Path -LiteralPath $chosen.File.FullName)) { continue }
    $hash = (Get-FileHash -LiteralPath $chosen.File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $key = '{0}|{1}|{2}' -f $hash,$chosen.ErrorCode,$revision
    $maxAttempts = [int]($chosen.Rule.maxAttemptsPerRevision)
    if ($maxAttempts -lt 1) { $maxAttempts = 1 }
    $prior = @($state.attempts | Where-Object { $_.key -eq $key })
    $attemptCount = if ($prior.Count) { [int]$prior[0].count } else { 0 }

    if ($attemptCount -ge $maxAttempts) {
      Write-AgentLog 'INFO' 'Retry skipped because this exact file already used its attempt for the current server revision.' @{ file=$chosen.File.Name; reportDate=$chosen.ReportDate; errorCode=$chosen.ErrorCode; revision=$revision }
      continue
    }

    $entry = [pscustomobject]@{
      key = $key
      hash = $hash
      errorCode = $chosen.ErrorCode
      reportDate = $chosen.ReportDate
      revision = $revision
      count = $attemptCount + 1
      attemptedAt = (Get-Date).ToString('o')
      sourceName = $chosen.File.Name
    }
    $state.attempts = @($state.attempts | Where-Object { $_.key -ne $key }) + @($entry)
    Save-State $state

    $revisionToken = ($revision -replace '[^A-Za-z0-9._-]','_')
    $destinationName = 'Daily-Report-{0}-auto-retry-{1}-{2}.xlsx' -f $chosen.ReportDate,$revisionToken,(Get-Date -Format 'yyyyMMdd-HHmmss')
    try {
      $target = Move-Unique -File $chosen.File -DestinationDirectory $IncomingDir -DestinationName $destinationName
      Write-AgentLog 'SUCCESS' 'Repairable failed report returned to Incoming for one controlled retry.' @{ file=$chosen.File.Name; target=$target; reportDate=$chosen.ReportDate; errorCode=$chosen.ErrorCode; revision=$revision }
    } catch {
      Write-AgentLog 'ERROR' 'Repairable failed report could not be returned to Incoming.' @{ file=$chosen.File.Name; error=$_.Exception.Message }
    }
  }

  foreach ($item in @($reviewed | Where-Object { $_.Rule.autoRetry -ne $true })) {
    Write-AgentLog 'INFO' 'Failed report requires manual review and was not re-uploaded.' @{ file=$item.File.Name; reportDate=$item.ReportDate; errorCode=$item.ErrorCode; reason=$item.Rule.reason }
  }

  Write-AgentLog 'INFO' 'Failed-review cycle completed.' @{ revision=$revision; failedFiles=$files.Count; classified=$reviewed.Count; retryable=$retryable.Count }
} finally {
  Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
}
