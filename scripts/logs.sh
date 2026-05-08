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

ssh -p "${PI_PORT}" "${PI_USER}@${PI_HOST}" journalctl --user -u barnaby -f "$@"
