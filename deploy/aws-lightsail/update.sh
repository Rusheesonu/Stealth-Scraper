#!/usr/bin/env bash
#
# Subsequent deploys. Run on the AWS Lightsail instance. ~30 seconds.
#
#   ssh ubuntu@<lightsail-ip>
#   cd /opt/stealth-scraper/src
#   bash deploy/aws-lightsail/update.sh
#
# What it does:
#   1. Pulls latest master from GitHub
#   2. Rebuilds the backend Docker image
#   3. Restarts the container (zero-downtime where possible)
#   4. Waits for /status to confirm healthy

set -euo pipefail

APP_ROOT="/opt/stealth-scraper"
SRC_DIR="${APP_ROOT}/src"
ENV_FILE="${APP_ROOT}/.env.production"
COMPOSE_DIR="${SRC_DIR}/deploy/aws-lightsail"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }
die() { printf "\n\033[1;31m✗ %s\033[0m\n\n" "$*" >&2; exit 1; }

[ -d "$SRC_DIR" ] || die "Source dir $SRC_DIR missing — did setup.sh ever run?"
[ -f "$ENV_FILE" ] || die "Env file $ENV_FILE missing."

log "Pulling latest master"
cd "$SRC_DIR"
git fetch --quiet
BEFORE=$(git rev-parse HEAD)
git reset --hard origin/master --quiet
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  ok "already on latest (${AFTER:0:7}) — nothing to deploy"
  exit 0
fi
ok "advanced ${BEFORE:0:7} → ${AFTER:0:7}"

log "Rebuilding backend image"
cd "$SRC_DIR/backend"
docker build -t stealth-scraper-backend:latest .
ok "image built"

log "Restarting container"
cd "$COMPOSE_DIR"
docker compose --env-file "$ENV_FILE" up -d --force-recreate
ok "container recreated"

log "Health check"
for i in $(seq 1 18); do
  if curl -sf -m 5 http://127.0.0.1:7860/status > /dev/null 2>&1; then
    ok "backend healthy"
    echo
    log "Deploy complete (${AFTER:0:7})"
    exit 0
  fi
  printf "  ... attempt %d/18\n" "$i"
  sleep 5
done

die "Backend didn't respond in 90s — check 'docker logs stealth-scraper-backend'"
