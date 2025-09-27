# stop-dev.ps1
# Cleanly free dev ports (API:4000, Web:5173)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Err($m){ Write-Host "[ERR]  $m" -ForegroundColor Red }

function Kill-Port([int]$Port){
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if(-not $conns){
      Ok ("Port {0} is already free" -f $Port)
      return
    }
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach($id in $pids){
      try {
        Stop-Process -Id $id -Force
        Ok ("Killed PID {0} (port {1})" -f $id, $Port)
      } catch {
        Err ("Failed to kill PID {0} on port {1}: {2}" -f $id, $Port, $_.Exception.Message)
      }
    }
  } catch {
    Err $_.Exception.Message
  }
}

Info "Stopping dev servers..."
Kill-Port 4000
Kill-Port 5173
Ok "Done."
