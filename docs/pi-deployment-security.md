# Barnaby Pi Deployment Security Guide

> **Context**: This guide covers security measures for deploying the Barnaby Fastify application to a Raspberry Pi on a local home network. The Pi also runs Pi-hole (network DNS) and nginx (reverse proxy for Pi-hole admin).
>
> **Last Updated**: 2026-05-01

## Threat Model

This application is **intentionally local-network only** — no public internet exposure. Primary risks:

1. **Compromised guest devices** — friends' phones, occasional WiFi users
2. **Lateral movement** — if another device on the network is compromised, it can scan and attack internal services
3. **Smart home / IoT compromise** — though most are isolated on a VLAN already
4. **Pi as critical infrastructure** — since Pi-hole handles DNS for the entire network, a compromise here is worse than a standalone app server

---

## Pre-Deployment (Application Hardening)

### Input & Request Protection

- **Schema validation on every route** — Use `additionalProperties: false` in body schemas to reject unexpected fields. This is your first line of defense against injection.
- **Rate limiting** — Install `@fastify/rate-limit`. Even on a local network, it protects against runaway scripts, buggy clients, or accidental DoS. Start with:
  ```typescript
  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
  ```
- **Body size limits** — Set `bodyLimit: 1048576` (1MB) in the Fastify constructor unless you have specific upload needs.
- **Request timeouts** — Configure `connectionTimeout: 30000` and `requestTimeout: 30000` to prevent slowloris-style attacks and hung connections.

### Sensitive Data Handling

- **Log redaction** — Configure Pino to redact `req.headers.authorization`, `req.headers.cookie`, and any password/token fields. On a local network it's easy to forget that logs might still be accessible.
  ```typescript
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.token',
          '*.secret',
        ],
        censor: '[REDACTED]',
      },
    },
  });
  ```
- **Environment validation** — Use `env-schema` or Zod to validate required env vars on startup. Fail fast with a clear error rather than running with undefined secrets.
- **Cookie security** — If you use `@fastify/cookie`, set:
  - `httpOnly: true`
  - `sameSite: 'strict'`
  - `secure: true` (even locally, if accessing over HTTPS via nginx)

### Process Hardening

- **Run as non-root** — Create a dedicated user (e.g., `barnaby`) and run the service under it. Never run Node as root.
- **Graceful shutdown** — Use `close-with-grace` to handle SIGTERM properly. This prevents database corruption and dropped requests during restarts.
  ```typescript
  import closeWithGrace from 'close-with-grace';

  closeWithGrace({ delay: 10000 }, async ({ signal, err }) => {
    if (err) {
      app.log.error({ err }, 'Server closing due to error');
    } else {
      app.log.info({ signal }, 'Server closing due to signal');
    }
    await app.close();
  });
  ```
- **Health checks** — Add `/health/live` and `/health/ready` endpoints so systemd can distinguish between "crashed" and "starting up."

---

## Post-Deployment (Host & Network Hardening)

### Firewall (Essential)

Even though you don't plan to expose to the internet, explicitly block inbound access to your Fastify port:

```bash
# Using ufw — deny everything, allow SSH and local access only
sudo ufw default deny incoming
sudo ufw allow from 192.168.1.0/24 to any port 3000  # your app port
sudo ufw allow ssh
sudo ufw enable
```

If the Pi has any public-facing interface (even indirectly via CGNAT), this is non-negotiable.

### Binding Strategy

- **Bind to LAN only** — Instead of `host: '0.0.0.0'`, consider binding to the Pi's local IP (`host: '192.168.1.x'`) so the service isn't reachable via other interfaces.
- If using Docker, publish ports as `127.0.0.1:3000:3000` or bind to the LAN interface explicitly.

### Nginx as Reverse Proxy (Leverage Existing Setup)

Since nginx is already running for Pi-hole, consider putting it in front of Barnaby too:

**Advantages:**
- SSL/TLS termination — even for local traffic, this prevents sniffing on the WiFi network
- Centralized access logging
- Additional request filtering layer
- Can handle static file serving, freeing Fastify to focus on API logic

**Example nginx location block:**
```nginx
server {
    listen 80;
    server_name barnaby.local;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**If using nginx, update Fastify:**
```typescript
const app = Fastify({
  trustProxy: true, // Trust X-Forwarded-* headers from nginx
  logger: true,
});
```

### SSL/TLS for Local Networks

Even inside your home network, HTTPS matters. Any device connected to your WiFi — including friends' phones — can sniff unencrypted HTTP traffic with trivial tools. Since Barnaby handles memories, calendar data, and eventually financial info, encryption is worth the small setup cost.

**The challenge**: Let's Encrypt and other public CAs won't issue certificates for `.local` domains or private IP addresses. You have three practical options:

---

#### Option 1: mkcert (Recommended for `.local` domains)

[`mkcert`](https://github.com/FiloSottile/mkcert) creates a local certificate authority that your devices trust. Browsers show a green lock with zero warnings.

**On the Pi:**
```bash
# Install mkcert
sudo apt install libnss3-tools
wget https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-arm64
chmod +x mkcert-v1.4.4-linux-arm64
sudo mv mkcert-v1.4.4-linux-arm64 /usr/local/bin/mkcert

# Create the local CA and generate a cert
mkcert -install
mkcert barnaby.pi.local 192.168.1.xxx  # add your Pi's LAN IP too
```

This produces `barnaby.pi.local+1.pem` and `barnaby.pi.local+1-key.pem`.

**On each device that accesses Barnaby** (your laptop, phone, etc.):
```bash
# Copy the CA cert to the device and install it
mkcert -CAROOT  # on the Pi, note this path
# Then on each client:
mkcert -install  # using the copied CA
```

For iOS specifically, you'll need to email yourself the `rootCA.pem` file, open it, install it in Settings → General → VPN & Device Management, then enable it under Settings → General → About → Certificate Trust Settings.

**nginx config:**
```nginx
server {
    listen 443 ssl http2;
    server_name barnaby.pi.local;

    ssl_certificate     /home/joshjosh/.local/share/mkcert/barnaby.pi.local+1.pem;
    ssl_certificate_key /home/joshjosh/.local/share/mkcert/barnaby.pi.local+1-key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name barnaby.pi.local;
    return 301 https://$server_name$request_uri;
}
```

**Update your iOS Shortcuts** to use `https://barnaby.pi.local` instead of `http://`.

---

#### Option 2: Self-Signed Certificate (Quick but Browser Warnings)

If you don't want to install a CA on every device, use a plain self-signed cert. Browsers will show a warning you have to click through, but the traffic is still encrypted.

```bash
# Create directory and generate cert
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/barnaby.key \
  -out /etc/nginx/ssl/barnaby.crt \
  -subj "/CN=barnaby.pi.local" \
  -addext "subjectAltName=DNS:barnaby.pi.local,IP:192.168.1.xxx"
```

Reference the cert in nginx the same way as Option 1 (just with different file paths). On iOS, you'll need to manually trust the cert or accept the warning each time.

---

#### Option 3: Real Domain + Let's Encrypt (Most Proper)

If you own a domain (even a cheap one), you can point a subdomain like `barnaby.yourdomain.com` to your Pi's private IP using an A record. Since it's a real public domain, Let's Encrypt can issue a certificate.

**Use the DNS challenge** (since your Pi isn't reachable from the internet):
```bash
# Install certbot
sudo apt install certbot

# Request cert via DNS challenge (requires adding a TXT record to your DNS)
sudo certbot certonly --manual --preferred-challenges dns \
  -d barnaby.yourdomain.com
```

Because you run Pi-hole, you can also add a local DNS override so `barnaby.yourdomain.com` resolves to your Pi's LAN IP inside your network, while the public DNS resolves to wherever else you want.

This gives you a real, globally trusted certificate with no client-side setup.

---

### Fastify Changes for HTTPS

When nginx handles SSL termination (all three options above), Fastify only sees HTTP. Update it to trust the proxy:

```typescript
const app = Fastify({
  trustProxy: true, // Essential: trusts X-Forwarded-Proto from nginx
  logger: true,
});
```

If Fastify generates any absolute URLs (e.g., redirect responses), it will use `https://` correctly thanks to `X-Forwarded-Proto`.

**Security note**: With `trustProxy: true`, ensure nginx is the only thing that can reach Fastify. Bind Fastify to `127.0.0.1:3001` so nothing on the LAN can bypass nginx and hit HTTP directly.

### Process Management (systemd)

Run under systemd with auto-restart and strict filesystem isolation. This is **especially important** because Pi-hole is on the same device:

```ini
[Unit]
Description=Barnaby Fastify App
After=network.target

[Service]
Type=simple
User=barnaby
Group=barnaby
WorkingDirectory=/opt/barnaby
ExecStart=/usr/bin/node --env-file=./.env ./src/index.ts
Restart=always
RestartSec=5

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/barnaby/logs
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
```

The `ProtectSystem=strict` and `ProtectHome=true` directives limit what the process can access on the filesystem even if compromised.

### Network Segmentation

- **Guest isolation** — If your router supports it, put guest WiFi on a separate VLAN that cannot route to your internal services. Friend phones are low-risk but not zero-risk.
- **Pi-hole interaction** — Since Barnaby runs on the same Pi as Pi-hole, a compromise of Barnaby could potentially affect DNS. The systemd sandboxing above helps contain this.

---

## Ongoing Maintenance

- **Enable automatic security updates** on the Pi:
  ```bash
  sudo apt install unattended-upgrades
  sudo dpkg-reconfigure -plow unattended-upgrades
  ```
- **Review logs periodically** — Even local services get scanned by compromised devices. Look for 404 storms, repeated failed auth attempts, or unusual request patterns.
  ```bash
  # If using nginx as reverse proxy
  sudo tail -f /var/log/nginx/barnaby-access.log
  ```
- **Keep Node.js and npm packages current** — Run `npm audit` periodically. On a local network it's tempting to neglect this, but supply-chain attacks in dependencies don't care about your network topology.
- **Monitor Pi resource usage** — Pi-hole + nginx + Barnaby + any other services. Use `htop`, `vnstat`, or `docker stats` (if containerized) to watch for anomalies.

---

## Quick Checklist

- [ ] Schema validation with `additionalProperties: false` on all routes
- [ ] `@fastify/rate-limit` installed and configured
- [ ] `bodyLimit` and timeouts set in Fastify constructor
- [ ] Log redaction configured for auth/cookie/secret fields
- [ ] Environment variables validated at startup (fail fast)
- [ ] Dedicated non-root user (`barnaby`) created
- [ ] `close-with-grace` implemented for graceful shutdown
- [ ] `/health/live` and `/health/ready` endpoints implemented
- [ ] `ufw` configured — deny incoming default, allow LAN to app port
- [ ] Fastify bound to LAN IP or `127.0.0.1` (if using nginx)
- [ ] nginx reverse proxy configured with SSL/TLS (recommended)
- [ ] SSL certificate acquired (mkcert, self-signed, or Let's Encrypt)
- [ ] iOS Shortcuts updated to use `https://`
- [ ] systemd service with `ProtectSystem=strict` and `NoNewPrivileges`
- [ ] `unattended-upgrades` enabled for security patches
- [ ] SSH already locked down (confirmed)
- [ ] Automatic restart configured in systemd

---

## Notes

- **SSL on local networks**: Even inside your home, WiFi traffic can be sniffed by any connected device. Self-signed certs via nginx provide meaningful protection against casual snooping.
- **Pi-hole coexistence**: Barnaby should not interfere with Pi-hole's DNS port (53/udp). Ensure your Fastify port (default 3000) does not conflict.
- **Backup strategy**: Consider backing up the Barnaby data directory and `.env` file. A Pi SD card failure is a matter of when, not if.
