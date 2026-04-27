param(
  [int]$ObserverPort = 4387,
  [string]$ProjectRoot = (Resolve-Path ".").Path
)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $ProjectRoot ".agent-realms-live"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$tokenFile = Join-Path $logDir "control-token.txt"
if (-not $env:AGENT_REALMS_CONTROL_TOKEN) {
  if (Test-Path $tokenFile) {
    $env:AGENT_REALMS_CONTROL_TOKEN = (Get-Content -Raw -LiteralPath $tokenFile).Trim()
  } else {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
      $rng.GetBytes($bytes)
    } finally {
      $rng.Dispose()
    }
    $env:AGENT_REALMS_CONTROL_TOKEN = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
    Set-Content -LiteralPath $tokenFile -Value $env:AGENT_REALMS_CONTROL_TOKEN -Encoding utf8
  }
}

$serverLog = Join-Path $logDir "observer.log"
$tunnelOutLog = Join-Path $logDir "cloudflared.out.log"
$tunnelErrLog = Join-Path $logDir "cloudflared.err.log"
$configPath = Join-Path $ProjectRoot "public\live-observer.json"

Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -and
    (
      ($_.CommandLine -like "*$ProjectRoot*" -and $_.CommandLine -like "*server/index.ts*") -or
      ($_.CommandLine -like "*cloudflared*tunnel*127.0.0.1:$ObserverPort*")
    )
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

$serverArgs = "/c", "set AGENT_REALMS_PORT=$ObserverPort&& npx tsx server/index.ts > `"$serverLog`" 2>&1"
$server = Start-Process -FilePath "cmd.exe" -ArgumentList $serverArgs -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden

$health = $null
$healthDeadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $healthDeadline -and -not $health) {
  Start-Sleep -Seconds 2
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ObserverPort/api/health" -TimeoutSec 5
  } catch {
    $health = $null
  }
}

if (-not $health.ok) {
  $tail = if (Test-Path $serverLog) { (Get-Content $serverLog -Tail 30) -join "`n" } else { "observer log missing" }
  throw "Local observer health check failed. Last observer log lines:`n$tail"
}

$cloudflared = Get-Command cloudflared -ErrorAction Stop
$tunnel = Start-Process -FilePath $cloudflared.Source -ArgumentList "tunnel", "--url", "http://127.0.0.1:$ObserverPort", "--no-autoupdate" -WorkingDirectory $ProjectRoot -RedirectStandardOutput $tunnelOutLog -RedirectStandardError $tunnelErrLog -PassThru -WindowStyle Hidden

$publicUrl = $null
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline -and -not $publicUrl) {
  Start-Sleep -Seconds 2
  if (Test-Path $tunnelErrLog) {
    $text = Get-Content -Raw $tunnelErrLog
    $match = [regex]::Match($text, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
    if ($match.Success) {
      $publicUrl = $match.Value
    }
  }
}

if (-not $publicUrl) {
  throw "Cloudflare quick tunnel URL was not found in $tunnelErrLog"
}

$config = [ordered]@{
  enabled = $true
  observerUrl = $publicUrl
  controlAvailable = $true
  updatedAtIso = (Get-Date).ToUniversalTime().ToString("o")
  note = "Live bridge to this Windows PC. Passive viewing is token-free; active control requires the local token and may consume Codex/model tokens."
}
$config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath -Encoding utf8

Write-Host "SiteUrl: https://agentsgamesystem.netlify.app/"
Write-Host "ObserverPid: $($server.Id)"
Write-Host "TunnelPid: $($tunnel.Id)"
Write-Host "ObserverUrl: $publicUrl"
Write-Host "ConfigPath: $configPath"
Write-Host "ControlTokenFile: $tokenFile"
Write-Host "ControlToken: $env:AGENT_REALMS_CONTROL_TOKEN"
Write-Host "RebootReconnectCommand: cd /d `"$ProjectRoot`" && powershell -ExecutionPolicy Bypass -File .\scripts\start-live-bridge.ps1"
