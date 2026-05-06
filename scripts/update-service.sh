#!/usr/bin/env bash
set -euo pipefail

PI_HOST="${PI_HOST:-joshpiserver.lan}"
PI_USER="${PI_USER:-joshjosh}"
PI_PORT="${PI_PORT:-22}"
NGINX_SITE="barnaby.joshpiserver.lan"
SYSTEMD_DIR="/home/${PI_USER}/.config/systemd/user"

echo "Updating service on ${PI_USER}@${PI_HOST}:${PI_PORT}..."

scp -P "${PI_PORT}" \
  scripts/systemd/barnaby.service \
  "${PI_USER}@${PI_HOST}:${SYSTEMD_DIR}/barnaby.service"

scp -P "${PI_PORT}" \
  scripts/nginx/barnaby.joshpiserver.lan \
  "${PI_USER}@${PI_HOST}:/tmp/${NGINX_SITE}"

ssh -p "${PI_PORT}" "${PI_USER}@${PI_HOST}" bash -s <<REMOTE
  set -euo pipefail

  echo "--> Installing nginx config..."
  sudo cp "/tmp/${NGINX_SITE}" /etc/nginx/sites-available/
  sudo ln -sf "/etc/nginx/sites-available/${NGINX_SITE}" /etc/nginx/sites-enabled/
  sudo nginx -t && sudo systemctl reload nginx

  echo "--> Reloading systemd daemon..."
  systemctl --user daemon-reload

  echo "--> Restarting barnaby..."
  systemctl --user restart barnaby

  echo "--> Checking service status..."
  systemctl --user status barnaby --no-pager
REMOTE

echo "Service update complete."