param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,
  [string]$Sandbox = "workspace-write"
)

$ErrorActionPreference = "Stop"
$codex = Join-Path $env:APPDATA "npm\codex.cmd"
if (-not (Test-Path -LiteralPath $codex)) {
  $codex = "codex"
}

$prompt = [Console]::In.ReadToEnd()
$prompt | & $codex @("exec", "--json", "-C", $ProjectRoot, "--sandbox", $Sandbox, "-")
exit $LASTEXITCODE
