# start-dev.ps1
# One-click dev launcher for API and Web with titled terminals

$ErrorActionPreference = "Stop"

function Kill-Port($port) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    foreach ($c in $conns) {
      if ($c.OwningProcess) {
        try { taskkill /PID $c.OwningProcess /F | Out-Null } catch {}
      }
    }
  } catch {}
}

# Free common dev ports
Kill-Port 4000
1..7 | ForEach-Object { Kill-Port (5172 + $_) } # 5173..5179

# --- API terminal ---
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "& { Set-Location 'C:\Users\ASUS\Desktop\industrial-api'; `$host.UI.RawUI.WindowTitle='api'; npm run dev }"
)

Start-Sleep -Seconds 2

# --- WEB terminal ---
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "& { Set-Location 'C:\Users\ASUS\Desktop\industrial-api\web'; `$host.UI.RawUI.WindowTitle='web'; npm run dev }"
)

Start-Sleep -Seconds 2

# Open browser (Vite may switch port if busy; start from 5173)
Start-Process "http://localhost:5173/"
