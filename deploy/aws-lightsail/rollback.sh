#!/usr/bin/env bash
# Roll back to the previous deployed git SHA.
#
# Strategy: each deploy (via update.sh) tags `:latest` AND `:<short-sha>`.
# To roll back, we re-tag a previous SHA image as :latest and recreate
# the container. We also `git checkout` the matching source tree so that
# any host-side bind mounts / future rebuilds match.
#
# Usage:
#   sudo bash deploy/aws-lightsail/rollback.sh [<git-short-sha>]
#
# With no arg: rolls back to the next-most-recent tagged SHA image.
# With an arg: rolls back to that specific SHA (must already be tagged
#              locally — `docker images stealth-scraper-backend` to list).
set -euo pipefail

APP_ROOT="/opt/stealth-scraper"
SRC_DIR="${APP_ROOT}/src"
ENV_FILE="${APP_ROOT}/.env.production"
COMPOSE_DIR="${SRC_DIR}/deploy/aws-lightsail"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }
die() { printf "\n\033[1;31m✗ %s\033[0m\n\n" "$*" >&2; exit 1; }

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
    # Pick the second-newest SHA-tagged image (newest is current :latest).
    # `docker images` is sorted newest-first by default.
    TARGET=$(docker images --format "{{.Tag}}" stealth-scraper-backend \
        | grep -E '^[a-f0-9]{7,}$' \
        | sed -n '2p')
    [ -z "$TARGET" ] && {
        echo "no previous image tagged — list available:"
        docker images stealth-scraper-backend
        exit 1
    }
fi

log "Rolling back to $TARGET"

# Sanity check the image exists.
if ! docker image inspect "stealth-scraper-backend:$TARGET" >/dev/null 2>&1; then
    die "image stealth-scraper-backend:$TARGET not found locally — list with: docker images stealth-scraper-backend"
fi

# Move the source tree to the matching SHA so subsequent update.sh runs
# don't immediately fast-forward us back to the broken master. Use
# --quiet because this script is run during incidents.
log "Checking out source @ $TARGET"
cd "$SRC_DIR"
git fetch --quiet || true
git checkout --quiet "$TARGET" || die "git checkout $TARGET failed — is the SHA pushed?"
ok "source at $(git rev-parse --short HEAD)"

log "Re-tagging :latest and recreating container"
docker tag "stealth-scraper-backend:$TARGET" stealth-scraper-backend:latest
cd "$COMPOSE_DIR"
docker compose --env-file "$ENV_FILE" up -d --force-recreate
ok "container recreated"

log "Health check"
for i in $(seq 1 18); do
    if curl -sf -m 5 http://127.0.0.1:7860/status > /dev/null 2>&1; then
        ok "backend healthy on $TARGET"
        echo
        log "Rollback complete — public verify: curl https://api.stealthscraper.dev/status"
        exit 0
    fi
    printf "  ... attempt %d/18\n" "$i"
    sleep 5
done

die "Backend didn't respond in 90s after rollback — check 'docker logs stealth-scraper-backend'"
