@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo This deletes AgentOS database and file data, then starts a new stack.
echo Press Ctrl+C to cancel.
pause

where docker >nul 2>&1
if errorlevel 1 (
  echo Docker was not found. Start Docker Desktop, then run this file again.
  exit /b 1
)
where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm was not found. Install pnpm 9.15, then run this file again.
  exit /b 1
)

if not exist .env (
  copy /Y .env.example .env >nul
  echo Created .env from .env.example.
)

findstr /R /C:"^XAI_API_KEY=." .env >nul
if errorlevel 1 (
  echo Set XAI_API_KEY in the root .env file, save it, then run this file again.
  notepad .env
  exit /b 1
)

echo Stopping previous stacks and deleting their volumes...
docker compose -p docker --project-directory . -f infra\docker\docker-compose.yml down -v
if errorlevel 1 exit /b 1
docker compose --project-directory . -f infra\docker\docker-compose.yml down -v
if errorlevel 1 exit /b 1

echo Building and starting the gateway, database, and VM image...
docker compose --project-directory . -f infra\docker\docker-compose.yml up -d --build
if errorlevel 1 exit /b 1

echo Waiting for http://localhost:8787/health ...
set TRIES=0
:wait_health
set /a TRIES+=1
powershell -NoProfile -Command "try { Invoke-RestMethod http://localhost:8787/health | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto health_ok
if %TRIES% GEQ 60 (
  echo The gateway did not become healthy. Check Docker logs and .env.
  exit /b 1
)
timeout /t 5 /nobreak >nul
goto wait_health

:health_ok
echo Installing dependencies...
call pnpm install
if errorlevel 1 exit /b 1

echo Starting the desktop app...
start "AgentOS Vite" /D "%~dp0" cmd /k "pnpm --filter @agentOS/desktop dev"

set TRIES=0
:wait_vite
set /a TRIES+=1
powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:5173 -UseBasicParsing | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto vite_ok
if %TRIES% GEQ 40 (
  echo Vite did not start. The Vite window has the error.
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto wait_vite

:vite_ok
start "AgentOS Electron" /D "%~dp0" cmd /k "pnpm --filter @agentOS/desktop electron"
echo.
echo Gateway: http://localhost:8787
echo In the app, enter your name and email, then choose Create account.
endlocal
