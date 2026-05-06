#!/usr/bin/env bash
set -euo pipefail

PI_HOST="${PI_HOST:-joshpiserver.lan}"
PI_USER="${PI_USER:-joshjosh}"
PI_PORT="${PI_PORT:-22}"
APP_DIR="/home/${PI_USER}/barnaby_ts"

echo "Deploying to ${PI_USER}@${PI_HOST}:${PI_PORT}..."

ssh -p "${PI_PORT}" "${PI_USER}@${PI_HOST}" bash -s <<'REMOTE'
  set -euo pipefail
  APP_DIR="${HOME}/barnaby_ts"

  echo "--> Pulling latest code..."
  cd "${APP_DIR}"
  git pull

  echo "--> Trusting mise config..."
  mise trust

  echo "--> Installing dependencies..."
  mise x -- npm ci

  echo "--> Restarting service..."
  systemctl --user restart barnaby

  echo "--> Checking service status..."
  systemctl --user status barnaby --no-pager
REMOTE

echo "Deploy complete."
