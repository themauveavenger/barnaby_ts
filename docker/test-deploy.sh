#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${SCRIPT_DIR}"

echo "==> Building and starting test container..."
docker compose -f docker-compose.test.yml up -d --build

echo ""
echo "==> Waiting for SSH to be ready..."
for i in {1..30}; do
    if ssh -o StrictHostKeyChecking=no \
           -o UserKnownHostsFile=/dev/null \
           -o ConnectTimeout=1 \
           -p 2222 \
           joshjosh@localhost \
           "echo ok" 2>/dev/null; then
        break
    fi
    if [[ $i -eq 30 ]]; then
        echo "SSH did not become ready in time"
        exit 1
    fi
    sleep 1
done

echo ""
echo "==> Running deploy script against test container..."
cd "${PROJECT_DIR}"
PI_HOST=localhost PI_USER=joshjosh PI_PORT=2222 ./scripts/deploy.sh

echo ""
echo "==> Checking service status..."
ssh -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -p 2222 \
    joshjosh@localhost \
    "systemctl --user status barnaby --no-pager"

echo ""
echo "==> Test complete!"
echo ""
echo "To stop the container:"
echo "  cd docker && docker compose -f docker-compose.test.yml down"
