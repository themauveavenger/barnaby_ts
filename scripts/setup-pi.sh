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
