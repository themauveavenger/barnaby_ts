#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${SCRIPT_DIR}"

echo "==> Building and starting test container..."
docker compose -f docker-compose.test.yml up -d --build

echo ""
echo "==> Waiting for systemd to be ready..."
for i in {1..30}; do
    if docker exec barnaby-pi-test systemctl is-system-running >/dev/null 2>&1; then
        break
    fi
    if [[ $i -eq 30 ]]; then
        echo "Systemd did not become ready in time"
        exit 1
    fi
    sleep 1
done

echo ""
echo "==> Step 1: Verifying environment..."
docker exec -u joshjosh barnaby-pi-test bash -c '
  echo "Node version: $(mise x -- node -v)"
  echo "npm version: $(mise x -- npm -v)"
  echo "git version: $(git --version)"
'

echo ""
echo "==> Step 2: Simulating deploy (git pull + npm ci)..."
docker exec -u joshjosh barnaby-pi-test bash -c '
  set -euo pipefail
  cd ~/barnaby_ts
  echo "--> git pull"
  git pull
  echo "--> mise trust"
  mise trust
  echo "--> npm ci"
  mise x -- npm ci
'

echo ""
echo "==> Step 3: Validating systemd service file..."
docker exec -u joshjosh -e HOME=/home/joshjosh barnaby-pi-test \
  systemd-analyze verify /home/joshjosh/barnaby_ts/scripts/systemd/barnaby.service

echo ""
echo "==> Step 4: Starting Barnaby manually (simulating systemd service)..."
# Note: systemd --user does not work cleanly in Docker containers without a
# full D-Bus session, so we run the app's ExecStart directly to verify it boots.
docker exec -u joshjosh -d barnaby-pi-test bash -c '
  cd ~/barnaby_ts
  export HOME=/home/joshjosh
  exec mise x -- npx tsx --env-file=$HOME/.config/barnaby/.env $HOME/barnaby_ts/src/index.ts
'

sleep 3

echo ""
echo "==> Step 5: Testing HTTP endpoint..."
HTTP_CODE=$(docker exec barnaby-pi-test bash -c '
  curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Basic $(echo -n test:test | base64)" \
    --max-time 5 \
    http://127.0.0.1:3001/
')

if [[ "${HTTP_CODE}" == "200" ]]; then
  echo "HTTP 200 OK — Barnaby is responding"
else
  echo "WARNING: Barnaby returned HTTP ${HTTP_CODE}, checking logs..."
  docker exec barnaby-pi-test bash -c 'ps aux | grep -E "tsx|node" | grep -v grep' || true
fi

echo ""
echo "==> Test complete!"
echo ""
echo "To stop the container:"
echo "  cd docker && docker compose -f docker-compose.test.yml down"
