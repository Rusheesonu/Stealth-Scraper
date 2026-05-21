# Stealth-Scraper production runbook

**Box:** AWS Lightsail Virginia (us-east-1a), `ssh stealth` (44.195.60.85, ubuntu).
**Public probes:** `https://api.stealthscraper.dev/status` · `https://stealthscraper.dev/`

This is the 3am-prod-down page. Be terse. Be exact.

---

## 1. Prod down (api.stealthscraper.dev not responding)

```bash
ssh stealth
sudo docker ps                                                 # is the container up?
sudo docker logs stealth-scraper-backend --tail 200            # what does it think happened?
sudo docker restart stealth-scraper-backend                    # try a kick first
curl -sf https://api.stealthscraper.dev/status && echo OK      # external probe
```

If still down after 60s:

```bash
cd /opt/stealth-scraper/src
sudo bash deploy/aws-lightsail/update.sh                       # rebuild + recreate
```

If the latest deploy is the suspect, see §4 (rollback).

---

## 2. Disk full

```bash
df -h                                                          # which mount?
sudo docker system prune -af                                   # nukes unused images/containers/networks
sudo journalctl --vacuum-size=200M                             # cap journald
sudo rm -rf /tmp/uc_* /tmp/chrome-user-data-*                  # chromium leftovers
sudo du -sh /var/lib/docker/* 2>/dev/null | sort -h | tail     # post-prune diagnostic
```

**Alert threshold:** UptimeRobot pings `/status` every 1m. Disk-pressure manifests as 5xx — `df -h` should sit <75%. Above 85%, page Rushi.

---

## 3. OOM (Out of Memory)

```bash
free -m                                                        # how much headroom?
sudo dmesg | grep -i 'killed process\|oom'                     # who got killed?
sudo docker stats --no-stream stealth-scraper-backend          # container memory %
sudo docker restart stealth-scraper-backend                    # immediate kick
```

If chronic (>1/day):
- Bump Lightsail plan ($40 → $80 doubles RAM to 8GB)
- OR reduce concurrency: edit `/opt/stealth-scraper/.env.production`, set
  `SCRAPE_SEMAPHORE` lower (default ~10 → try 5), then `update.sh`.
- Make sure swap is configured (see manual checklist — should be 2GB).

---

## 4. Rollback bad deploy

```bash
ssh stealth
cd /opt/stealth-scraper/src
sudo bash deploy/aws-lightsail/rollback.sh                     # → previous tagged SHA
# or explicitly:
sudo bash deploy/aws-lightsail/rollback.sh <git-short-sha>
sudo docker images stealth-scraper-backend                     # list what's available
```

`update.sh` tags every build as `:latest` AND `:<short-sha>`. The rollback
script re-tags an older SHA as `:latest`, checks out the matching source,
and `compose up --force-recreate`s. Health-check before declaring done.

---

## 5. Webhook replay (Lemon Squeezy)

If a customer paid but their plan didn't upgrade, the LS → backend webhook
was dropped. To replay:

1. **LS dashboard** → Settings → Webhooks → click the affected delivery →
   **Resend**. This is usually all you need.
2. **Or curl manually** (use this if LS dashboard is being weird):

   ```bash
   # Get the raw event JSON from LS dashboard ("View payload" → copy).
   # Then sign + POST. SECRET is LEMONSQUEEZY_WEBHOOK_SECRET from
   # /opt/stealth-scraper/.env.production on the box.
   PAYLOAD='<paste the JSON here>'
   SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
   curl -X POST https://api.stealthscraper.dev/webhook/lemonsqueezy \
     -H "Content-Type: application/json" \
     -H "X-Signature: $SIG" \
     -d "$PAYLOAD"
   ```

3. Verify in Supabase `subscriptions` table: row should show updated plan.

---

## 6. Supabase down

Frontend has a maintenance-card fallback for `/dashboard` and `/auth/*`
routes. If users still see "uncaught error":

```bash
ssh stealth
sudo tee /var/www/maintenance.html > /dev/null <<'HTML'
<!doctype html><meta charset=utf-8>
<title>Stealth-Scraper — brief downtime</title>
<style>body{font:16px system-ui;max-width:480px;margin:80px auto;padding:0 24px;color:#222}</style>
<h1>We're back in a few minutes.</h1>
<p>Our auth provider (Supabase) is having an incident. Your data is safe — we're just waiting on them.</p>
<p>Status: <a href="https://status.supabase.com">status.supabase.com</a></p>
HTML

# point Caddy at the static page for the duration:
sudo sed -i.bak 's|reverse_proxy 127.0.0.1:7860|root * /var/www\n\ttry_files /maintenance.html =200\n\tfile_server|' /etc/caddy/Caddyfile
sudo systemctl reload caddy
# revert:
sudo mv /etc/caddy/Caddyfile.bak /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

---

## 7. LLM rate limited (Groq 429 wave)

`/assist` returns 429 in a burst → users see retry errors.

```bash
ssh stealth
sudo docker logs stealth-scraper-backend --tail 200 | grep -i '429\|rate'
```

Fix path A — verify the fallback chain is firing:
- `app/assist.py` has a Groq → OpenAI → Anthropic fallback. Look for
  `LLM_FALLBACK_*` warnings in logs.

Fix path B — temporarily disable `/assist`:
```bash
sudo sed -i 's/^ASSIST_ENABLED=.*/ASSIST_ENABLED=false/' /opt/stealth-scraper/.env.production
# (or add ASSIST_ENABLED=false if not present)
cd /opt/stealth-scraper/src && sudo bash deploy/aws-lightsail/update.sh
```
The frontend hides the `/assist` button when the flag is off.

---

## 8. Where the logs are

| Where | How |
|---|---|
| App stdout/stderr | `sudo docker logs -f stealth-scraper-backend` |
| App since N min | `sudo docker logs --since 10m stealth-scraper-backend` |
| Caddy access | `sudo journalctl -u caddy -f` |
| System / kernel | `sudo journalctl -k -f` (kernel) or `sudo journalctl -f` (all) |
| Sentry (post-#62) | https://sentry.io/organizations/stealth-scraper/issues/ |
| Uptime history | UptimeRobot dashboard |

---

## 9. On-call

Founder: **Rushi** — `+__-______ ____` (TODO: fill in) · rushikeshsonu@gmail.com
Escalation: same. There is no L2.
