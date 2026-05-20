#!/usr/bin/env bash
#
# One-time Hetzner provisioning. Run as root on a fresh Ubuntu 24.04 box.
# Idempotent — safe to re-run if anything fails mid-way.
#
#   curl -fsSL https://raw.githubusercontent.com/Rusheesonu/Stealth-Scraper/master/deploy/hetzner/setup.sh | bash
# OR, after cloning:
#   bash deploy/hetzner/setup.sh
#
# Prereqs:
#   - DNS A record api.stealthscraper.dev → this server's IPv4 (already
#     propagated; setup.sh waits up to 60s for Caddy's first cert).
#   - .env.production filled in (see .env.production.template).
#   - Repo cloned at /opt/stealth-scraper/src (this script lives in
#     /opt/stealth-scraper/src/deploy/hetzner/).

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────
APP_ROOT="/opt/stealth-scraper"
SRC_DIR="${APP_ROOT}/src"
ENV_FILE="${APP_ROOT}/.env.production"
COMPOSE_FILE="${SRC_DIR}/deploy/hetzner/docker-compose.yml"
CADDY_SRC="${SRC_DIR}/deploy/hetzner/Caddyfile"
CADDY_DST="/etc/caddy/Caddyfile"
DOMAIN="api.stealthscraper.dev"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }
warn(){ printf "  \033[1;33m⚠\033[0m %s\n" "$*"; }
die() { printf "\n\033[1;31m✗ %s\033[0m\n\n" "$*" >&2; exit 1; }

# ── Pre-flight ────────────────────────────────────────────────────────────
[ "$EUID" -eq 0 ] || die "Run as root (or via sudo bash setup.sh)."
[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE — copy from .env.production.template and fill in."
[ -d "$SRC_DIR" ] || die "Missing $SRC_DIR — clone the repo to /opt/stealth-scraper/src first."
[ -f "$COMPOSE_FILE" ] || die "Missing $COMPOSE_FILE — your clone is incomplete."

# ── 1. System update + base tools ─────────────────────────────────────────
log "Updating apt + installing base tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl ca-certificates gnupg lsb-release \
  ufw fail2ban htop nano \
  debian-keyring debian-archive-keyring apt-transport-https
ok "base packages installed"

# ── 2. Firewall ───────────────────────────────────────────────────────────
log "Configuring UFW (allow 22, 80, 443; deny everything else)"
ufw --force reset > /dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ok "firewall up"

# ── 3. fail2ban ───────────────────────────────────────────────────────────
log "Enabling fail2ban for SSH"
systemctl enable --now fail2ban
ok "fail2ban running"

# ── 4. Docker ─────────────────────────────────────────────────────────────
if ! command -v docker &> /dev/null; then
  log "Installing Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  ok "docker installed"
else
  ok "docker already present ($(docker --version | head -1))"
fi

# ── 5. Caddy ──────────────────────────────────────────────────────────────
if ! command -v caddy &> /dev/null; then
  log "Installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
  ok "caddy installed"
else
  ok "caddy already present ($(caddy version | head -1))"
fi

# ── 6. Deploy Caddy config ────────────────────────────────────────────────
log "Deploying Caddyfile"
cp "$CADDY_SRC" "$CADDY_DST"
caddy validate --config "$CADDY_DST" --adapter caddyfile > /dev/null
systemctl reload caddy || systemctl restart caddy
ok "caddy reloaded — first request will trigger Let's Encrypt cert"

# ── 7. Build + run the backend container ──────────────────────────────────
log "Building backend image (this takes 4-6 min on first run — Chromium deps)"
cd "$SRC_DIR/backend"
docker build -t stealth-scraper-backend:latest .
ok "image built"

log "Starting backend container"
cd "$SRC_DIR/deploy/hetzner"
# Stop any previous instance (idempotent re-run)
docker compose --env-file "$ENV_FILE" down --remove-orphans 2>/dev/null || true
docker compose --env-file "$ENV_FILE" up -d
ok "container started"

# ── 8. Wait for the backend to come online ────────────────────────────────
log "Waiting for /status to respond (max 90s)"
for i in $(seq 1 18); do
  if curl -sf -m 5 http://127.0.0.1:7860/status > /dev/null 2>&1; then
    ok "backend healthy"
    break
  fi
  if [ "$i" -eq 18 ]; then
    warn "backend didn't respond in 90s — check 'docker logs stealth-scraper-backend'"
    warn "the container may still be downloading Chromium binaries; first request unlocks it"
  fi
  printf "  ... attempt %d/18\n" "$i"
  sleep 5
done

# ── 9. Wait for HTTPS / Let's Encrypt cert ────────────────────────────────
log "Waiting for HTTPS endpoint to come up (max 60s)"
for i in $(seq 1 12); do
  if curl -sf -m 5 "https://${DOMAIN}/status" > /dev/null 2>&1; then
    ok "https://${DOMAIN}/status is live"
    break
  fi
  if [ "$i" -eq 12 ]; then
    warn "HTTPS not responding yet — DNS may still be propagating"
    warn "check 'dig ${DOMAIN} +short' returns this server's IP"
    warn "check 'journalctl -u caddy -f' for cert acquisition errors"
  fi
  printf "  ... attempt %d/12\n" "$i"
  sleep 5
done

# ── 10. Print summary ─────────────────────────────────────────────────────
echo
log "Setup complete"
echo "  backend   : http://127.0.0.1:7860/status"
echo "  public    : https://${DOMAIN}/status"
echo "  logs      : docker logs -f stealth-scraper-backend"
echo "  caddy log : journalctl -u caddy -f"
echo
echo "  next: in Vercel, set BACKEND_URL=https://${DOMAIN} and redeploy."
echo
