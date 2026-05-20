#!/usr/bin/env bash
#
# Optional monitor that cron can run every 5 min. Detects container
# wedged-but-not-exited (Docker's health check covers exits already),
# checks Caddy is up, and prints a one-line status to syslog.
#
# Install:
#   sudo cp deploy/hetzner/monitor.sh /usr/local/bin/stealth-monitor.sh
#   sudo chmod +x /usr/local/bin/stealth-monitor.sh
#   sudo crontab -e
#   # Add:
#   */5 * * * * /usr/local/bin/stealth-monitor.sh

set -u

DOMAIN="api.stealthscraper.dev"
LOG_TAG="stealth-monitor"

log() { logger -t "$LOG_TAG" "$*"; }

# 1. Container health
HEALTH=$(docker inspect --format '{{.State.Health.Status}}' stealth-scraper-backend 2>/dev/null || echo "missing")
case "$HEALTH" in
  healthy)
    : # ok
    ;;
  starting)
    log "container starting up — skip alarm"
    ;;
  unhealthy)
    log "container UNHEALTHY — restarting"
    docker restart stealth-scraper-backend > /dev/null
    ;;
  missing)
    log "container MISSING — starting via compose"
    cd /opt/stealth-scraper/src/deploy/hetzner
    docker compose --env-file /opt/stealth-scraper/.env.production up -d
    ;;
  *)
    log "unknown health state: $HEALTH"
    ;;
esac

# 2. Public HTTPS reachable
if ! curl -sf -m 8 "https://${DOMAIN}/status" > /dev/null 2>&1; then
  log "public HTTPS endpoint not responding"
  # Try a Caddy reload — sometimes fixes transient cert / proxy issues.
  systemctl reload caddy || systemctl restart caddy
fi

# 3. Disk space alarm
DISK_PCT=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_PCT" -gt 85 ]; then
  log "disk usage at ${DISK_PCT}% — clean docker images: docker system prune -af"
fi

# 4. Memory pressure
MEM_PCT=$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')
if [ "$MEM_PCT" -gt 90 ]; then
  log "memory at ${MEM_PCT}% — chromium may be OOM-killing soon"
fi
