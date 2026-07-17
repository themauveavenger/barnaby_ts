#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

PI_HOST="${PI_HOST:?must be set}"
PI_USER="${PI_USER:?must be set}"
PI_PORT="${PI_PORT:-22}"
REPO_URL="${REPO_URL:?must be set}"
DOMAIN="${DOMAIN:?must be set}"
NGINX_SITE="barnaby.conf"
REMOTE_APP_DIR="/home/${PI_USER}/barnaby_ts"

# Use Windows SSH client when running inside WSL (better agent / keychain integration)
if grep -qi 'microsoft\|wsl' /proc/sys/kernel/osrelease 2>/dev/null || [ -n "${WSL_DISTRO_NAME:-}" ]; then
  SSH_CMD="ssh.exe"
  SCP_CMD="scp.exe"
else
  SSH_CMD="ssh"
  SCP_CMD="scp"
fi

echo "Deploying to ${PI_USER}@${PI_HOST}..."

# Copy nginx and systemd config files to the Pi first,
# then run a single remote script that handles everything.
${SCP_CMD} -P "${PI_PORT}" \
  scripts/systemd/barnaby.service \
  "${PI_USER}@${PI_HOST}:/tmp/barnaby.service"

${SCP_CMD} -P "${PI_PORT}" \
  scripts/nginx/barnaby.conf \
  "${PI_USER}@${PI_HOST}:/tmp/${NGINX_SITE}"

${SSH_CMD} -p "${PI_PORT}" "${PI_USER}@${PI_HOST}" bash -s <<REMOTE
  set -euo pipefail

  APP_DIR="${REMOTE_APP_DIR}"
  CONFIG_DIR="\${HOME}/.config/barnaby"
  DATA_DIR="\${HOME}/.local/share/barnaby"
  SYSTEMD_DIR="\${HOME}/.config/systemd/user"
  NGINX_SITE="${NGINX_SITE}"
  DOMAIN="${DOMAIN}"

  # ── One-time setup: directories ──────────────────────────────────

  mkdir -p "\${CONFIG_DIR}"
  mkdir -p "\${DATA_DIR}"
  mkdir -p "\${SYSTEMD_DIR}"

  # ── One-time setup: git clone ───────────────────────────────────

  if [ ! -d "\${APP_DIR}/.git" ]; then
    echo "--> Cloning repository..."
    git clone "${REPO_URL}" "\${APP_DIR}"
  fi

  # ── One-time setup: enable linger ────────────────────────────────

  LINGER_ENABLED=\$(loginctl show-user "\$(whoami)" 2>/dev/null | grep -c 'Linger=yes' || true)
  if [ "\${LINGER_ENABLED}" -eq 0 ]; then
    echo "--> Enabling linger so services survive logout..."
    sudo loginctl enable-linger "\$(whoami)"
  fi

  # ── One-time setup: systemd enable ───────────────────────────────

  if [ ! -L "\${SYSTEMD_DIR}/barnaby.service" ] && [ ! -f "\${SYSTEMD_DIR}/barnaby.service" ]; then
    echo "--> Installing systemd service for the first time..."
    cp /tmp/barnaby.service "\${SYSTEMD_DIR}/barnaby.service"
    systemctl --user daemon-reload
    systemctl --user enable barnaby
  fi

  # ── One-time setup: .env check ───────────────────────────────────

  if [ ! -f "\${CONFIG_DIR}/.env" ]; then
    echo "ERROR: \${CONFIG_DIR}/.env not found. Create it before deploying."
    echo "  Required: PORT, DATABASE_PATH, BASIC_AUTH_USERNAME, BASIC_AUTH_PASSWORD, CONTEXT_WINDOW_DAYS"
    exit 1
  fi

  # ── Per-deploy: pull, trust, install ─────────────────────────────

  echo "--> Pulling latest code..."
  cd "\${APP_DIR}"
  LOCKFILE_HASH_BEFORE=\$(md5sum package-lock.json 2>/dev/null || echo "none")

  # Stash any debugging detritus so git pull can fast-forward cleanly
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "--> Stashing local changes before pull..."
    git stash push -m "deploy.sh auto-stash \$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi

  git pull
  LOCKFILE_HASH_AFTER=\$(md5sum package-lock.json 2>/dev/null || echo "none")

  echo "--> Trusting mise config..."
  mise trust

  if [ "\${LOCKFILE_HASH_BEFORE}" = "\${LOCKFILE_HASH_AFTER}" ]; then
    echo "--> package-lock.json unchanged, skipping npm ci"
  else
    echo "--> package-lock.json changed, installing dependencies..."
    mise x -- npm ci
  fi

  # ── Per-deploy: update service and nginx configs ─────────────────

  echo "--> Updating systemd service..."
  cp /tmp/barnaby.service "\${SYSTEMD_DIR}/barnaby.service"
  systemctl --user daemon-reload

  echo "--> Updating nginx config..."
  sed "s/server_name .*/server_name \${DOMAIN};/" "/tmp/\${NGINX_SITE}" | sudo tee "/etc/nginx/sites-available/\${NGINX_SITE}" > /dev/null
  sudo ln -sf "/etc/nginx/sites-available/\${NGINX_SITE}" /etc/nginx/sites-enabled/

  # ── Clean up old nginx configs from previous naming scheme ──────

  for f in /etc/nginx/sites-enabled/barnaby*; do
    if [ -f "\$f" ] || [ -L "\$f" ]; then
      name=\$(basename "\$f")
      if [ "\$name" != "\${NGINX_SITE}" ]; then
        echo "--> Removing old nginx config: \$name"
        sudo rm -f "/etc/nginx/sites-available/\$name"
        sudo rm -f "/etc/nginx/sites-enabled/\$name"
      fi
    fi
  done

  sudo nginx -t && sudo systemctl reload nginx

  # ── Restart and verify ───────────────────────────────────────────

  echo "--> Restarting barnaby..."
  systemctl --user restart barnaby

  HEALTH_URL="http://127.0.0.1:3001/health"
  MAX_ATTEMPTS=30
  SLEEP_SECS=2

  echo "--> Waiting for barnaby to become healthy..."
  for i in \$(seq 1 "\${MAX_ATTEMPTS}"); do
    if curl -sf "\${HEALTH_URL}" > /dev/null 2>&1; then
      echo "--> Barnaby is healthy (attempt \${i})"
      break
    fi
    if [ "\${i}" -eq "\${MAX_ATTEMPTS}" ]; then
      echo "ERROR: Barnaby did not become healthy within \$((MAX_ATTEMPTS * SLEEP_SECS))s"
      systemctl --user status barnaby --no-pager
      exit 1
    fi
    sleep "\${SLEEP_SECS}"
  done

  echo ""
  echo "Deploy complete."
REMOTE