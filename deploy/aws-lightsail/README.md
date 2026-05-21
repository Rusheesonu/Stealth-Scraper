# AWS Lightsail deploy — backend production host

The backend runs as a single Docker container on an AWS Lightsail
instance (Virginia / us-east-1a), fronted by Caddy (HTTPS via Let's
Encrypt, auto-renewed). DNS: `api.stealthscraper.dev` → Lightsail
public IPv4.

This dir is the deploy kit. Everything you need to bring a fresh
Ubuntu 24.04 box from zero to serving live traffic is here.

## Why this setup (not HF / Render / Modal)

HF Spaces flagged us as abusive (auto-detector tags scraper traffic
patterns). Render free tier sleeps + can OOM Chromium under load.
Modal is great long-term but needs a function-style refactor.

AWS Lightsail $40/mo plan = 4GB RAM (room for ~10 concurrent Chromium
snapshots), 2 vCPU, 80GB SSD, 5TB egress bundled. Same region as our
Supabase Postgres (us-east-1) → <10ms DB RTT. $100 free credit covers
~2.5 months for new accounts.

## Files

| File | What it does |
|---|---|
| `setup.sh` | One-time first-deploy. Runs on fresh Ubuntu — installs Docker, Caddy, configures firewall, deploys the container. **Idempotent** — safe to re-run. |
| `update.sh` | For every subsequent deploy. Pulls master, rebuilds image, restarts container. ~30 seconds. |
| `docker-compose.yml` | Backend container definition. Reads `.env.production` for secrets. |
| `Caddyfile` | Reverse proxy config. Auto-HTTPS via Let's Encrypt. |
| `.env.production.template` | Copy to `.env.production` and fill in. Gitignored. |
| `monitor.sh` | Optional — periodic health checks + log rotation. Cron it. |

## First-time provisioning

1. Create an AWS Lightsail instance:
   - Region: **us-east-1** (Virginia) — co-located with Supabase
   - Blueprint: **Ubuntu 24.04 LTS**
   - Plan: **$40/mo** (4GB RAM, 2 vCPU, 80GB SSD, 5TB egress)
   - Attach a static IP after creation (free while attached)

2. Open ports in the Lightsail networking tab: 22, 80, 443

3. Point DNS:

   | Type | Host | Value | TTL |
   |---|---|---|---|
   | `A` | `api` | `<lightsail-static-ip>` | Automatic |

4. SSH in (Lightsail provides the key under "Account → SSH keys"):

   ```bash
   ssh -i ~/.ssh/LightsailDefaultKey-us-east-1.pem ubuntu@<lightsail-ip>
   ```

5. Bootstrap:

   ```bash
   sudo apt-get update && sudo apt-get install -y git
   sudo mkdir -p /opt/stealth-scraper
   sudo chown ubuntu:ubuntu /opt/stealth-scraper
   cd /opt/stealth-scraper
   git clone https://github.com/Rusheesonu/Stealth-Scraper src
   cd src/deploy/aws-lightsail
   cp .env.production.template /opt/stealth-scraper/.env.production
   # edit /opt/stealth-scraper/.env.production with real secrets (Supabase
   # service key, LLM_API_KEY, LEMONSQUEEZY_API_KEY, etc.)
   sudo bash setup.sh
   ```

   `setup.sh` is idempotent — installs Docker, Caddy, brings up the
   container, configures the firewall. Re-run any time without harm.

## Subsequent deploys

From your local machine after `git push`:

```bash
ssh stealth                                                   # SSH config alias
cd /opt/stealth-scraper/src && sudo bash deploy/aws-lightsail/update.sh
```

The script does: `git pull` → `docker build` → `docker compose up
--force-recreate` → polls `/status` until healthy (max 90s) → exits.
If the health check fails, it leaves stderr pointing at
`docker logs stealth-scraper-backend` for diagnostics.

## Backup

Lightsail UI → Snapshots → enable automatic weekly snapshots. ~$0.05/GB/mo.

## Operational

- **Logs**: `sudo docker logs -f stealth-scraper-backend`
- **Restart only** (no rebuild): `sudo docker compose -f docker-compose.yml --env-file /opt/stealth-scraper/.env.production restart`
- **Shell into container**: `sudo docker exec -it stealth-scraper-backend /bin/bash`
- **Disk usage**: `df -h /` — alert at >75%
- **Run benches against production**: `tar` the `bench/` dir to the
  container, `docker exec` to run them inside the production stack
  (see `bench/README.md` for the exact runbook).

## TODO

- [ ] Enable Lightsail automatic snapshots
- [ ] Set up CloudWatch alarms on instance CPU + disk
- [ ] Wire CI to auto-deploy on push to master (currently manual SSH)
