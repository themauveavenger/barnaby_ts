# Barnaby Pi Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create deployment scripts and configuration files to deploy Barnaby to a Raspberry Pi via SSH, served behind nginx at `barnaby.pi.local`.

**Architecture:** A deploy script SSHs into the Pi, pulls code, installs deps via `mise`, and restarts a systemd user service. nginx reverse-proxies port 80 to Barnaby on `127.0.0.1:3001`. The SQLite DB lives outside the repo at `~/.local/share/barnaby/barnaby.db`.

**Tech Stack:** Bash, systemd, nginx, mise, npm, tsx

---

### Task 1: systemd User Service File

**Files:**
- Create: `scripts/systemd/barnaby.service`

- [ ] **Step 1: Create the service file**

```ini
[Unit]
Description=Barnaby Fastify application
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/barnaby_ts
ExecStart=%h/.local/bin/mise x -- npx tsx --env-file=%h/.config/barnaby/.env %h/barnaby_ts/src/index.ts
Restart=on-failure
RestartSec=5
Environment="NODE_ENV=production"

[Install]
WantedBy=default.target
```

- [ ] **Step 2: Commit**

```bash
git add scripts/systemd/barnaby.service
git commit -m "chore(deploy): add systemd user service for Barnaby"
```

---

### Task 2: nginx Site Configuration

**Files:**
- Create: `scripts/nginx/barnaby.pi.local`

- [ ] **Step 1: Create the nginx config**

```nginx
server {
    listen 80;
    server_name barnaby.pi.local;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/nginx/barnaby.pi.local
git commit -m "chore(deploy): add nginx config for barnaby.pi.local"
```

---

### Task 3: Initial Pi Setup Script

**Files:**
- Create: `scripts/setup-pi.sh`

- [ ] **Step 1: Create the setup script**

This script is run **once manually on the Pi** (or via SSH) to prepare the environment. It assumes the repo has already been cloned to `~/barnaby_ts`.

```bash
#!/usr/bin/env bash
set -euo pipefail

PI_USER="joshjosh"
APP_DIR="/home/${PI_USER}/barnaby_ts"
CONFIG_DIR="/home/${PI_USER}/.config/barnaby"
DATA_DIR="/home/${PI_USER}/.local/share/barnaby"
SYSTEMD_DIR="/home/${PI_USER}/.config/systemd/user"

# Create directories
mkdir -p "${CONFIG_DIR}"
mkdir -p "${DATA_DIR}"
mkdir -p "${SYSTEMD_DIR}"

echo "Directories created:"
echo "  Config: ${CONFIG_DIR}"
echo "  Data:   ${DATA_DIR}"
echo "  Systemd: ${SYSTEMD_DIR}"

# Copy systemd service
cp "${APP_DIR}/scripts/systemd/barnaby.service" "${SYSTEMD_DIR}/barnaby.service"

# Reload systemd daemon for user services
systemctl --user daemon-reload
systemctl --user enable barnaby

echo ""
echo "Systemd service installed and enabled."
echo ""
echo "Next steps:"
echo "  1. Create ${CONFIG_DIR}/.env with at least:"
echo "       PORT=3001"
echo "       DATABASE_PATH=${DATA_DIR}/barnaby.db"
echo "       BASIC_AUTH_USERNAME=..."
echo "       BASIC_AUTH_PASSWORD=..."
echo "       CONTEXT_WINDOW_DAYS=30"
echo "  2. Copy scripts/nginx/barnaby.pi.local to /etc/nginx/sites-available/"
echo "     and symlink to /etc/nginx/sites-enabled/"
echo "  3. Run: sudo nginx -t && sudo systemctl reload nginx"
echo "  4. Start Barnaby: systemctl --user start barnaby"
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/setup-pi.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/setup-pi.sh
git commit -m "chore(deploy): add initial Pi setup script"
```

---

### Task 4: Deploy Script (Dev Machine)

**Files:**
- Create: `scripts/deploy.sh`

- [ ] **Step 1: Create the deploy script**

This script is run **from the dev machine** to push updates to the Pi.

```bash
#!/usr/bin/env bash
set -euo pipefail

PI_HOST="${PI_HOST:-pi.local}"
PI_USER="${PI_USER:-joshjosh}"
APP_DIR="/home/${PI_USER}/barnaby_ts"

echo "Deploying to ${PI_USER}@${PI_HOST}..."

ssh "${PI_USER}@${PI_HOST}" bash -s <<'REMOTE'
  set -euo pipefail
  APP_DIR="${HOME}/barnaby_ts"

  echo "--> Pulling latest code..."
  cd "${APP_DIR}"
  git pull

  echo "--> Installing dependencies..."
  mise x -- npm ci

  echo "--> Restarting service..."
  systemctl --user restart barnaby

  echo "--> Checking service status..."
  systemctl --user status barnaby --no-pager
REMOTE

echo "Deploy complete."
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/deploy.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy.sh
git commit -m "chore(deploy): add SSH deploy script for Raspberry Pi"
```

---

### Task 5: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add a DATABASE_PATH example**

Update `.env.example` to include `DATABASE_PATH` so it's documented for new environments.

```
PORT=3000
DATABASE_PATH=./barnaby.db
BASIC_AUTH_USERNAME=barnaby
BASIC_AUTH_PASSWORD=change-me
CONTEXT_WINDOW_DAYS=30
```

(The file may already contain this — verify before changing.)

- [ ] **Step 2: Commit if changed**

```bash
git add .env.example
git commit -m "chore(deploy): document DATABASE_PATH in .env.example"
```

---

## Self-Review

**1. Spec coverage:**
| Spec Section | Plan Task |
|--------------|-----------|
| Deploy Script (SSH, git pull, npm install, restart service) | Task 4 |
| nginx Config (port 80, reverse proxy to 3001) | Task 2 |
| systemd User Service (mise, tsx, env file) | Task 1 |
| Env file location (`~/.config/barnaby/.env`) | Task 3 (setup script docs) |
| DB path (`~/.local/share/barnaby/barnaby.db`) | Task 3 (setup script docs) |
| Port assignment (3001) | Task 1, Task 2 |
| Database safety (outside repo) | Task 3 (directory creation) |
| Initial setup steps | Task 3 |

**2. Placeholder scan:** No TBD, TODO, or vague instructions found. Every file has complete content.

**3. Type consistency:** N/A — this is infrastructure (bash/nginx/systemd), not TypeScript.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-barnaby-pi-deployment.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
