param(
  [int]$ObserverPort = 4387,
  [string]$ProjectRoot = (Resolve-Path ".").Path
)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $ProjectRoot ".agent-realms-live"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$serverLog = Join-Path $logDir "observer.log"
$tunnelOutLog = Join-Path $logDir "cloudflared.out.log"
$tunnelErrLog = Join-Path $logDir "cloudflared.err.log"
$configPath = Join-Path $ProjectRoot "public\live-observer.json"

$server = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx tsx server/index.ts > `"$serverLog`" 2>&1" -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4

$health = Invoke-RestMethod -Uri "http://127.0.0.1:$ObserverPort/api/health" -TimeoutSec 10
if (-not $health.ok) {
  throw "Local observer health check failed."
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
  updatedAtIso = (Get-Date).ToUniversalTime().ToString("o")
  note = "Live bridge to this Windows PC. Requires the local observer and cloudflared processes to keep running."
}
$config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath -Encoding utf8

[pscustomobject]@{
  ObserverPid = $server.Id
  TunnelPid = $tunnel.Id
  ObserverUrl = $publicUrl
  ConfigPath = $configPath
}
