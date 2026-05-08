# Deployment (Raspberry Pi)

Barnaby can deploy to a Raspberry Pi on your home network, served behind nginx.

## Architecture

- Barnaby binds to `127.0.0.1:3001` (set via `HOST` and `PORT` env vars in the systemd unit), avoiding conflicts with other services on port 80
- nginx reverse-proxies your chosen domain → `127.0.0.1:3001`
- The systemd user service auto-restarts on failure
- The SQLite database lives at `~/.local/share/barnaby/barnaby.db` — outside the git repo so deploys never touch your data

## Prerequisites

- Raspberry Pi running nginx
- Node.js managed by [`mise`](https://mise.jdx.dev/)
- SSH access to the Pi

## Initial Setup (One-Time)

1. Clone the repo:
   ```bash
   git clone <your-repo-url> ~/barnaby_ts
   ```

2. Create the environment file at `~/.config/barnaby/.env`:
   ```
   PORT=3001
   DATABASE_PATH=/home/$USER/.local/share/barnaby/barnaby.db
   BASIC_AUTH_USERNAME=your_username
   BASIC_AUTH_PASSWORD=your_password
   CONTEXT_WINDOW_DAYS=30
   TIMEZONE=America/New_York
   OPENCODE_API_KEY=your_key
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   GOOGLE_REFRESH_TOKEN=your_google_refresh_token
   CALENDAR_IDS=primary,family@group.calendar.google.com
   YNAB_ACCESS_TOKEN=your_ynab_token
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   TELEGRAM_CHAT_ID=your_chat_id
   BRIEFING_CRON=0 8 * * *
   ```

3. Edit the nginx config (`scripts/nginx/barnaby.conf`) to use your domain, then copy and enable it:
   ```bash
   sudo cp ~/barnaby_ts/scripts/nginx/barnaby.conf /etc/nginx/sites-available/
   sudo ln -s /etc/nginx/sites-available/barnaby.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

4. Install the systemd user service:
   ```bash
   mkdir -p ~/.config/systemd/user
   cp ~/barnaby_ts/scripts/systemd/barnaby.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable barnaby
   ```

5. Enable linger so the service survives logout:
   ```bash
   sudo loginctl enable-linger $(whoami)
   ```

6. Start the service:
   ```bash
   systemctl --user start barnaby
   ```

## Deploying Updates

From your dev machine, set the required env vars and run:

```bash
PI_HOST=your-pi.local PI_USER=your-user REPO_URL=https://github.com/you/barnaby_ts.git ./scripts/deploy.sh
```

This SSHs into the Pi, pulls the latest code, installs dependencies via `mise` if `package-lock.json` changed, updates configs, and restarts the service. You can set `PI_PORT` to override the default SSH port (`22`).
