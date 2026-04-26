# Barnaby Raspberry Pi Deployment Design

## Overview
Deploy the Barnaby Fastify application to a Raspberry Pi on the home network, accessible via `barnaby.pi.local`. The deployment is triggered by a single SSH script run from the development machine.

## Assumptions
- Raspberry Pi hostname or mDNS entry resolves to `pi.local`.
- Pi already runs `nginx` and `pihole`.
- SSH access is available as user `joshjosh`.
- No SSL/TLS required (plain HTTP on local network).
- Database must survive redeploys without risk of deletion or overwrite.

---

## Architecture

```
[Dev Machine]
    |
    | ssh joshjosh@pi.local
    v
[Raspberry Pi]
    |-- nginx (port 80, server_name barnaby.pi.local)
    |       `-- reverse proxy -> http://127.0.0.1:3001
    |
    |-- barnaby.service (systemd user service)
    |       `-- listens on 127.0.0.1:3001
    |       `-- loads env from ~/.config/barnaby/.env
    |
    |-- Git clone at ~/barnaby_ts
    |
    |-- SQLite DB at ~/.local/share/barnaby/barnaby.db
```

---

## Components

### 1. Deploy Script (`scripts/deploy.sh`)

Run from the dev machine. It:

1. SSHs into `joshjosh@pi.local`.
2. Navigates to `~/barnaby_ts`.
3. Runs `git pull`.
4. Runs `npm ci` (or `npm install`) using `package-lock.json`.
5. Restarts the `barnaby` systemd user service via `systemctl --user restart barnaby`.

The script exits immediately if any step fails (`set -e`).

### 2. nginx Configuration (`scripts/nginx/barnaby.pi.local`)

A single `server` block:

- `listen 80;`
- `server_name barnaby.pi.local;`
- `location /` reverse-proxies to `http://127.0.0.1:3001`
- Includes standard proxy headers (`Host`, `X-Forwarded-For`, etc.)

**Initial setup (one-time):**
- Copy the file to `/etc/nginx/sites-available/barnaby.pi.local` on the Pi.
- Symlink it into `/etc/nginx/sites-enabled/`.
- Reload nginx (`sudo nginx -s reload`).

This is **not** done by the deploy script on every run.

### 3. systemd User Service (`scripts/systemd/barnaby.service`)

Runs Barnaby as the `joshjosh` user:

- `ExecStart=npx tsx --env-file=${HOME}/.config/barnaby/.env ${HOME}/barnaby_ts/src/index.ts`
- `Restart=on-failure`
- `RestartSec=5`
- `WorkingDirectory=%h/barnaby_ts`

The service is managed via `systemctl --user`.

### 4. Environment File (`~/.config/barnaby/.env`)

Lives on the Pi, outside the git repo. Contains:

```
PORT=3001
DATABASE_PATH=/home/joshjosh/.local/share/barnaby/barnaby.db
BASIC_AUTH_USERNAME=...
BASIC_AUTH_PASSWORD=...
CONTEXT_WINDOW_DAYS=30
```

This file is never touched by the deploy script.

### 5. SQLite Database (`~/.local/share/barnaby/barnaby.db`)

- Path is specified via the `DATABASE_PATH` env var.
- Directory `~/.local/share/barnaby/` is created once during initial setup.
- The deploy script never interacts with this directory.

---

## Port Assignment

Barnaby binds to `127.0.0.1:3001` to avoid conflicts with Pi-hole (which typically binds port 80). nginx handles all external traffic and reverse-proxies internally.

---

## Database Safety Strategy

The SQLite database is stored at a fixed path outside the git clone directory. The deploy script only performs `git pull` and `npm install` inside the repo. There is no step in the deploy process that touches `~/.local/share/barnaby/`. Even a full `rm -rf ~/barnaby_ts && git clone ...` would leave the database intact.

---

## Error Handling

- The deploy script uses `set -euo pipefail` to fail fast on any error.
- If `git pull` fails (e.g., local changes), the script stops before touching `npm` or the service.
- The systemd service restarts automatically on failure.
- nginx continues serving if the backend is temporarily down (returns 502, which is acceptable for a personal service).

---

## Initial Setup Steps (One-Time on Pi)

These are performed once manually (or via a separate `scripts/setup-pi.sh` script), not on every deploy:

1. Ensure `node` and `npm` are installed on the Pi.
2. Clone the repo to `~/barnaby_ts`.
3. Create `~/.config/barnaby/` and `~/.local/share/barnaby/`.
4. Write the `.env` file to `~/.config/barnaby/.env` with the correct `DATABASE_PATH`.
5. Copy `scripts/systemd/barnaby.service` to `~/.config/systemd/user/barnaby.service`.
6. Enable and start the service: `systemctl --user enable barnaby && systemctl --user start barnaby`.
7. Copy `scripts/nginx/barnaby.pi.local` to `/etc/nginx/sites-available/` and symlink to `sites-enabled`.
8. Reload nginx.

---

## Future Improvements (Out of Scope)

- Git push-to-deploy (`post-receive` hook).
- Docker / containerization.
- SSL via Let's Encrypt or local CA.
- Health check endpoint and graceful rolling restart.
