param(
  [string]$Url = "http://localhost:8087/#/",
  [string]$Out = "",
  [string]$Profile = "edge-prof",
  [int]$W = 1440,
  [int]$H = 900,
  [int]$Budget = 4000,
  [int]$Tries = 3,
  [switch]$NoShot
)
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$tmp = "C:\Users\osakh\AppData\Local\Temp\opencode"
if (-not $Out) { $Out = "$tmp\nexo-shot.png" }
$prof = "$tmp\$Profile"

if (-not $NoShot -and (Test-Path $Out)) { Remove-Item $Out -Force }

$all = ""
for ($i = 1; $i -le $Tries; $i++) {
  $edgeArgs = @(
    "--headless=new", "--disable-gpu", "--no-first-run",
    "--disable-extensions", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--run-all-compositor-stages-before-draw",
    "--user-data-dir=$prof",
    "--window-size=$W,$H",
    "--virtual-time-budget=$Budget",
    "--enable-logging=stderr", "--v=0",
    "--hide-scrollbars"
  )
  if (-not $NoShot) { $edgeArgs += "--screenshot=$Out" }
  $edgeArgs += $Url

  $output = & $edge @edgeArgs 2>&1 | Out-String
  $all += $output

  if ($NoShot) { break }
  if ((Test-Path $Out) -and ((Get-Item $Out).Length -gt 2000)) { break }
  Start-Sleep -Milliseconds 600
}

$errors = ($all -split "`n") | Where-Object { $_ -match "CONSOLE" -and $_ -match "error|Uncaught|ERR_" }
"--- console (erros) ---"
if ($errors) { $errors } else { "(nenhum erro de console)" }
if (-not $NoShot) {
  "--- shot ---"
  if ((Test-Path $Out) -and ((Get-Item $Out).Length -gt 2000)) { $Out + "  " + (Get-Item $Out).Length + " bytes" } else { "FALHOU" }
}
