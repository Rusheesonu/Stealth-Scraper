# Hetzner deploy — backend production host

The backend runs as a single Docker container on a Hetzner CX32 VPS,
fronted by Caddy (HTTPS via Let's Encrypt, auto-renewed). DNS:
`api.stealthscraper.dev` → Hetzner IPv4.

This dir is the deploy kit. Everything you need to bring a fresh
Ubuntu 24.04 box from zero to serving live traffic is here.

## Why this setup (not HF / Render / Modal)

HF Spaces flagged us as abusive (auto-detector tags scraper traffic
patterns). Render free tier sleeps + can OOM Chromium under load.
Modal is great long-term but needs a function-style refactor.

CX32 = 8GB RAM (room for 15-20 concurrent Chromium snapshots),
4 vCPU, 80GB SSD, €8.46/mo. Hetzner includes 20TB egress free —
critical for a scraper that returns base64 screenshots (~1MB each).

## Files

| File | What it does |
|---|---|
| `setup.sh` | One-time first-deploy. Runs on fresh Ubuntu — installs Docker, Caddy, configures firewall, deploys the container. **Idempotent** — safe to re-run. |
| `update.sh` | For every subsequent deploy. Pulls master, rebuilds image, restarts container. ~30 seconds. |
| `docker-compose.yml` | Backend container definition. Reads `.env.production` for secrets. |
| `Caddyfile` | Reverse proxy config. Auto-HTTPS via Let's Encrypt. |
| `.env.production.template` | Copy to `.env.production` and fill in. Gitignored. |
| `monitor.sh` | Optional — periodic health checks + log rotation. Cron it. |

## First-time deploy walkthrough

### 1. Create the VPS

- hetzner.com/cloud → New project: `stealth-scraper`
- New server:
  - Image: **Ubuntu 24.04 LTS**
  - Type: Shared vCPU → **CX32** (8GB RAM, 4 vCPU, 80GB SSD, €8.46/mo)
  - Location: **Helsinki** (best routes to India + EU + US for PH audience)
  - SSH key: Upload your `~/.ssh/id_ed25519.pub`
  - Name: `stealth-scraper-prod`
- Create → note the IPv4 address

### 2. Point DNS

Namecheap → Advanced DNS for `stealthscraper.dev` → add:

| Type | Host | Value | TTL |
|---|---|---|---|
| `A` | `api` | `<hetzner-ipv4>` | Automatic |

Verify with `dig api.stealthscraper.dev +short` after 2-3 min.

### 3. Copy this directory to the server

```bash
# From your laptop, in the repo root:
scp -r deploy/hetzner root@<ipv4>:/opt/stealth-scraper-deploy
```

(Or rsync the whole repo, you'll need it for the Docker build context.)

Actually easier — let `setup.sh` clone the repo on the server:

```bash
ssh root@<ipv4>
# On the server:
mkdir -p /opt/stealth-scraper && cd /opt/stealth-scraper
git clone https://github.com/Rusheesonu/Stealth-Scraper.git src
cd src/deploy/hetzner
```

### 4. Fill in secrets

```bash
cp .env.production.template ../../.env.production
nano ../../.env.production    # paste your secrets (see template comments)
```

### 5. Run setup

```bash
bash setup.sh
```

The script asks zero interactive questions. Expect ~6-10 minutes
(Docker install + Chromium dependencies in the image + first cert
provisioning from Let's Encrypt).

When it finishes, hit:

```bash
curl https://api.stealthscraper.dev/status
```

Should return JSON with `llm.primary: llama-3.3-70b-versatile`.

### 6. Wire up Vercel

In Vercel project → Settings → Environment Variables:

| Name | Value |
|---|---|
| `BACKEND_URL` | `https://api.stealthscraper.dev` |

Redeploy frontend (push any commit, or click Redeploy in Vercel UI).

### 7. Update UptimeRobot

Edit your existing keep-alive monitor → URL: `https://api.stealthscraper.dev/status`. Keeps Chromium warm + alerts if box dies.

## Subsequent deploys

Every time master changes:

```bash
ssh root@<ipv4>
cd /opt/stealth-scraper/src
bash deploy/hetzner/update.sh
```

Or set up the auto-deploy GitHub Action (see `.github/workflows/sync-hf-spaces.yml`
adapted for Hetzner — left as a follow-up task).

## Operational notes

### Logs
```bash
docker logs -f stealth-scraper-backend
journalctl -u caddy -f
```

### Container won't start
```bash
docker ps -a   # see exit code
docker logs stealth-scraper-backend | tail -50
```

### Update Caddy config
```bash
sudo nano /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Backup
Hetzner UI → Snapshots → take one weekly (~€0.01/GB/mo).
Database backups: Supabase handles those automatically.

### Hardening checklist (post-launch, when you have time)
- [ ] Disable root SSH login (use a sudo user)
- [ ] Set up `fail2ban` for SSH brute-force protection
- [ ] Enable Hetzner snapshots on a schedule
- [ ] Migrate the docker container off port 7860 onto a unix socket
- [ ] Add Cloudflare in front for DDoS protection (free tier)
