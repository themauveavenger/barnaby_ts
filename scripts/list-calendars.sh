#!/bin/bash
# List available Google Calendars to verify auth and get calendar IDs.
# Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN env vars.

set -euo pipefail

# loads .env file
set -o allexport; source .env; set +o allexport

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

echo "Access token obtained. Fetching calendar list..."
echo ""

# List calendars
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.googleapis.com/calendar/v3/users/me/calendarList" | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', [])
if not items:
    print('No calendars found.')
for cal in items:
    print(f\"ID:   {cal.get('id')}\")
    print(f\"Name: {cal.get('summary')}\")
    print(f\"Access: {cal.get('accessRole')}\")
    print('-' * 40)
"
