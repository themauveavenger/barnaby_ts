#!/usr/bin/env bash
set -euo pipefail

PI_HOST="${PI_HOST:-joshpiserver.lan}"
PI_USER="${PI_USER:-joshjosh}"
PI_PORT="${PI_PORT:-22}"
REPO_URL="${REPO_URL:-https://github.com/joshjosh/barnaby_ts.git}"
NGINX_SITE="barnaby.joshpiserver.lan"
REMOTE_APP_DIR="/home/${PI_USER}/barnaby_ts"

echo "Deploying to ${PI_USER}@${PI_HOST}..."

# Copy nginx and systemd config files to the Pi first,
# then run a single remote script that handles everything.
scp -P "${PI_PORT}" \
  scripts/systemd/barnaby.service \
  "${PI_USER}@${PI_HOST}:/tmp/barnaby.service"

scp -P "${PI_PORT}" \
  scripts/nginx/barnaby.joshpiserver.lan \
  "${PI_USER}@${PI_HOST}:/tmp/${NGINX_SITE}"

ssh -p "${PI_PORT}" "${PI_USER}@${PI_HOST}" bash -s <<REMOTE
  set -euo pipefail

  APP_DIR="${REMOTE_APP_DIR}"
  CONFIG_DIR="\${HOME}/.config/barnaby"
  DATA_DIR="\${HOME}/.local/share/barnaby"
  SYSTEMD_DIR="\${HOME}/.config/systemd/user"
  NGINX_SITE="${NGINX_SITE}"

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
  git pull

  echo "--> Trusting mise config..."
  mise trust

  echo "--> Installing dependencies..."
  mise x -- npm ci

  # ── Per-deploy: update service and nginx configs ─────────────────

  echo "--> Updating systemd service..."
  cp /tmp/barnaby.service "\${SYSTEMD_DIR}/barnaby.service"
  systemctl --user daemon-reload

  echo "--> Updating nginx config..."
  sudo cp "/tmp/\${NGINX_SITE}" /etc/nginx/sites-available/
  sudo ln -sf "/etc/nginx/sites-available/\${NGINX_SITE}" /etc/nginx/sites-enabled/
  sudo nginx -t && sudo systemctl reload nginx

  # ── Restart and verify ───────────────────────────────────────────

  echo "--> Restarting barnaby..."
  systemctl --user restart barnaby

  sleep 2
  systemctl --user status barnaby --no-pager

  echo ""
  echo "Deploy complete."
REMOTE