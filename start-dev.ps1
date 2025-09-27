# start-dev.ps1  (run from project root)
# One-click dev launcher: Docker (DB), API:4000, Web:5173

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Info($msg){ Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Ok($msg){ Write-Host "[OK]   $msg" -ForegroundColor Green }
function Warn($msg){ Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Err($msg){ Write-Host "[ERR]  $msg" -ForegroundColor Red }

function Ensure-Compose {
  try {
    docker version | Out-Null
  } catch {
    Err "Docker Desktop is not running."
    throw
  }
  Info "Ensuring DB/Adminer are up (docker compose up -d)…"
  if (Test-Path "$root\docker-compose.yml") {
    docker compose -f "$root\docker-compose.yml" up -d | Out-Null
  } else {
    Warn "docker-compose.yml not found; skipping."
  }
}

function Free-Port([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    $pid = $conn.OwningProcess
    Warn "Port $Port is in use by PID $pid — will kill it."
    Stop-Process -Id $pid -Force
    Start-Sleep -Milliseconds 200
  }
}

function Ensure-WebEnv {
  $envFile = "$root\web\.env.local"
  if (!(Test-Path $envFile)) {
    Info "Creating web/.env.local"
    @'
VITE_API_BASE=http://localhost:4000
'@ | Set-Content -Encoding UTF8 $envFile
  }
}

function Launch-API {
  Info "Launching API on :4000"
  Free-Port 4000
  Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoExit","-Command","cd '$root'; npm run dev"
  )
}

function Launch-Web {
  Info "Launching Web on :5173"
  Free-Port 5173
  Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoExit","-Command","cd '$root\web'; npm run dev"
  )
}

try {
  Info "Project root = $root"
  Ensure-Compose
  Ensure-WebEnv
  Launch-API
  Start-Sleep -Seconds 1
  Launch-Web
  Ok "All set. Open http://localhost:5173/"
  Ok "Health:  http://localhost:4000/api/health"
} catch {
  Err $_.Exception.Message
  exit 1
}
