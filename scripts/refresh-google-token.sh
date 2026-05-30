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

# Make project-local npm binaries available
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

# ── Run local OAuth flow ─────────────────────────────────────────

echo "--> Running local OAuth flow to get a new refresh token..."
echo "    Follow the browser instructions. When done, the remote env will be updated."
echo ""

OAUTH_OUTPUT=$(mktemp)
tsx "$SCRIPT_DIR/get-google-refresh-token.ts" | tee "$OAUTH_OUTPUT"
TOKEN_LINE=$(grep '^GOOGLE_REFRESH_TOKEN=' "$OAUTH_OUTPUT" || true)
rm -f "$OAUTH_OUTPUT"

if [ -z "$TOKEN_LINE" ]; then
  echo "ERROR: Failed to extract refresh token from script output."
  exit 1
fi

NEW_TOKEN="${TOKEN_LINE#GOOGLE_REFRESH_TOKEN=}"

echo ""
echo "--> Got new token."

# ── Update local .env ──────────────────────────────────────────

if [ -f "$ENV_FILE" ]; then
  sed -i '/^GOOGLE_REFRESH_TOKEN=/d' "$ENV_FILE"
  printf '\nGOOGLE_REFRESH_TOKEN=%s\n' "${NEW_TOKEN}" >> "$ENV_FILE"
  echo "--> Local .env updated."
fi

# ── Update remote .env and restart service ─────────────────────

echo "--> Updating remote env on ${PI_USER}@${PI_HOST} and restarting barnaby..."

ssh -p "${PI_PORT}" "${PI_USER}@${PI_HOST}" bash -s <<REMOTE
  set -euo pipefail

  ENV_FILE="\${HOME}/.config/barnaby/.env"

  if [ ! -f "\${ENV_FILE}" ]; then
    echo "ERROR: \${ENV_FILE} not found on remote host."
    exit 1
  fi

  sed -i '/^GOOGLE_REFRESH_TOKEN=/d' "\${ENV_FILE}"
  printf '\nGOOGLE_REFRESH_TOKEN=%s\n' '${NEW_TOKEN}' >> "\${ENV_FILE}"

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
REMOTE

echo ""
echo "✅ Refresh token updated locally and on ${PI_HOST}."
