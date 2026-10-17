@echo off
rem Starts AutoReach on this computer: the API and the dashboard, each in its own window.
rem Sending, reply checks and follow-ups only run while the "AutoReach API" window is open.
cd /d "%~dp0"
start "AutoReach API" cmd /k "npm run dev:api"
start "AutoReach dashboard" cmd /k "npm run dev:dashboard"
echo Waiting for the servers to start...
timeout /t 8 /nobreak >nul
start "" "http://localhost:5173"
echo.
echo AutoReach is open at http://localhost:5173
echo Keep the "AutoReach API" and "AutoReach dashboard" windows open while you use it.
echo Close them to stop AutoReach.
timeout /t 5 >nul
