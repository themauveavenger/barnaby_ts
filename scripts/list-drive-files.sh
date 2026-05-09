#!/bin/bash
# List Google Drive documents to find file IDs for drive_read_doc.
# Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN env vars.

set -euo pipefail

# loads .env file from project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/../.env" ]; then
  set -o allexport; source "$SCRIPT_DIR/../.env"; set +o allexport
fi

if [ -z "${GOOGLE_CLIENT_ID:-}" ] || [ -z "${GOOGLE_CLIENT_SECRET:-}" ] || [ -z "${GOOGLE_REFRESH_TOKEN:-}" ]; then
  echo "Error: Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN"
  exit 1
fi

# Exchange refresh token for access token
TOKEN_RESPONSE=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$GOOGLE_CLIENT_ID" \
  -d "client_secret=$GOOGLE_CLIENT_SECRET" \
  -d "refresh_token=$GOOGLE_REFRESH_TOKEN" \
  -d "grant_type=refresh_token")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Failed to get access token:"
  echo "$TOKEN_RESPONSE"
  exit 1
fi

QUERY="${1:-}"
BASE_Q="mimeType = 'application/vnd.google-apps.document' and trashed = false"

if [ -n "$QUERY" ]; then
  FULL_Q="$BASE_Q and name contains '$QUERY'"
else
  FULL_Q="$BASE_Q"
fi

echo "Fetching Google Drive documents..."
echo ""

# List documents
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -G "https://www.googleapis.com/drive/v3/files" \
  --data-urlencode "q=$FULL_Q" \
  --data-urlencode "pageSize=50" \
  --data-urlencode "fields=files(id,name,modifiedTime)" \
  --data-urlencode "orderBy=modifiedTime desc" | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'error' in data:
    err = data['error']
    print(f'API Error: {err.get(\"code\", \"?\")} - {err.get(\"message\", \"unknown\")}')
    sys.exit(1)
files = data.get('files', [])
if not files:
    print('No documents found.')
for f in files:
    print(f\"ID:       {f.get('id')}\")
    print(f\"Name:     {f.get('name')}\")
    print(f\"Modified: {f.get('modifiedTime', 'N/A')}\")
    print('-' * 60)
"