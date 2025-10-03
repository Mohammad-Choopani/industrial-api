# start-dev.ps1 (run from project root)
# Full-stack dev launcher: API:4000, Web:5173

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Info($msg){ Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Ok($msg){ Write-Host "[OK]   $msg" -ForegroundColor Green }
function Warn($msg){ Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Err($msg){ Write-Host "[ERR]  $msg" -ForegroundColor Red }

function FreePort([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    $procId = $conn.OwningProcess
    Warn "Port $Port is in use by PID $procId - will kill it."
    Stop-Process -Id $procId -Force
    Start-Sleep -Milliseconds 200
  }
}

function Ensure-WebEnv {
  $envFile = Join-Path $root 'web\.env.local'
  if (!(Test-Path $envFile)) {
    Info 'Creating web/.env.local'
    'VITE_API_BASE=http://localhost:4000' | Set-Content -Encoding UTF8 $envFile
  }
}

function Launch-API {
  Info 'Launching API on :4000'
  FreePort 4000
  Start-Process -FilePath 'powershell' -ArgumentList @('-NoExit','-Command',"cd '$root'; npm run dev") | Out-Null
  Ok '  - API running at http://localhost:4000'
  Ok '  - Available endpoints:'
  Ok '    GET /api/stations'
  Ok '    GET /api/devices'
  Ok '    GET /api/telemetry'
  Ok '    GET /api/inventory'
}

function Launch-Web {
  Info 'Launching Web on :5173'
  FreePort 5173
  Start-Process -FilePath 'powershell' -ArgumentList @('-NoExit','-Command',"cd '$root\web'; npm run dev") | Out-Null
  Ok '  - Web UI running at http://localhost:5173'
}

try {
  Info "Project root = $root"
  
  # Setup environment
  Ensure-WebEnv
  
  # Launch backend API
  Launch-API
  Start-Sleep -Seconds 2
  
  # Launch frontend
  Launch-Web
  Start-Sleep -Seconds 1
  
  Ok "`nAll services are running:"
  Ok "- Backend API: http://localhost:4000"
  Ok "- Frontend UI: http://localhost:5173"
} catch {
  Err $_.Exception.Message
  exit 1
}
