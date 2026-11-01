# Start AgentOS

Run these steps in PowerShell, in order. Docker Desktop must already be running.

## 1. Open the repository

```powershell
Set-Location D:\CODE\DeadLettersBot
```

## 2. Create the env file if it is missing

```powershell
if (-not (Test-Path D:\CODE\DeadLettersBot\.env)) { Copy-Item D:\CODE\DeadLettersBot\.env.example D:\CODE\DeadLettersBot\.env }
notepad D:\CODE\DeadLettersBot\.env
```

Save the file after `XAI_API_KEY=` has your xAI key on that same line.

## 3. Delete the old stack and its data

```powershell
docker compose -p docker --project-directory . -f infra/docker/docker-compose.yml down -v
docker compose --project-directory . -f infra/docker/docker-compose.yml down -v
```

## 4. Build and start the gateway, database, and VM image

```powershell
docker compose --project-directory . -f infra/docker/docker-compose.yml up -d --build
```

## 5. Wait until the gateway answers

```powershell
Invoke-RestMethod http://localhost:8787/health
```

Repeat that command until it returns without an error.

## 6. Install dependencies

```powershell
Set-Location D:\CODE\DeadLettersBot
pnpm install
```

## 7. Start the desktop UI

Run each command in its own PowerShell window.

```powershell
Set-Location D:\CODE\DeadLettersBot
pnpm --filter @agentOS/desktop dev
```

```powershell
Set-Location D:\CODE\DeadLettersBot
pnpm --filter @agentOS/desktop electron
```

## 8. Create your account

In the Electron window, enter your name and email. Leave the gateway at `http://localhost:8787` and choose **Create account**. The app signs you in and keeps the session on this computer. Use **+** to create a bot.

If this gateway already has an account, choose **I already have a token** and paste that token.

## Stop

```powershell
docker compose --project-directory . -f infra/docker/docker-compose.yml down
```
