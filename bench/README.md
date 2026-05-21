# bench/ — Stealth-Scraper benchmark harness

Three runners, one shared library, one rule: **numbers are the only truth**.

## Runners

```bash
# 1. Anti-bot bypass rate — per-vendor success on 20+ protected URLs
python -m bench.antibot
python -m bench.antibot --filter cloudflare
python -m bench.antibot --max 5

# 2. Fingerprint fidelity — bot.sannysoft, creepjs, browserleaks, etc.
python -m bench.fingerprint
python -m bench.fingerprint --site sannysoft

# 3. Throughput — pages/$ on a fixed list
python -m bench.throughput
python -m bench.throughput --max 10
```

All three write to `bench/results/<runner>-<UTC-timestamp>.json`. Commit
baselines. Every improvement iteration must show a before/after delta in
the commit message.

## How it actually runs

Each runner imports the SAME `app.snapshot` / `app.detect` /
`app.browser` modules the production backend uses. There is no separate
"benchmark stealth stack" — that defeats the point. To make the imports
resolve, run from the repo root with `python -m bench.<runner>` so
`backend/` lands on the path (handled by `bench/lib.py`).

Required: a working `backend/venv` with `nodriver` installed and a
Chromium/Chrome binary on PATH (Mac: `/Applications/Google Chrome.app/...`
is auto-detected; Linux: install `google-chrome-stable`).

```bash
cd /path/to/Stealth-Scraper
backend/venv/bin/python -m bench.antibot
```

## Running against the production backend (recommended for "real" baselines)

The local run uses YOUR IP — not great for hard sites (Cloudflare, Akamai
flag residential ISP IPs without cookies just as fast as datacenter). For
representative numbers, run on the AWS box where the real proxy pool +
production cookie jars are:

```bash
# Sync bench/ to the box
rsync -av bench/ stealth:/opt/stealth-scraper/src/bench/

# Run inside the container so app.snapshot uses container's nodriver + Chrome
ssh stealth 'sudo docker exec stealth-scraper-backend \
    python -m bench.antibot --max 5'

# Pull results back
scp -r stealth:/opt/stealth-scraper/src/bench/results/* bench/results/
```

## Cost model (throughput.py)

Env vars set the rates that compute `cost_usd` and `pages_per_dollar`.
Defaults match our Lightsail + Webshare DC setup. Change them when you
swap proxy providers:

| Env var | Default | Meaning |
|---|---|---|
| `BENCH_HOURLY_COMPUTE_USD` | `0.055` | $40/mo Lightsail / 730 hours |
| `BENCH_PROXY_PER_REQ_USD` | `0.00001` | Webshare DC bundled (~$7.50/mo unlimited) |
| `BENCH_PROXY_PER_GB_USD` | `0` | DC tier has no bandwidth charge |

Example for BrightData Web Unlocker:
```bash
export BENCH_PROXY_PER_REQ_USD=0.0015   # $1.50 per 1k req
python -m bench.throughput
```

## Win conditions (we stop the loop when ALL three pass)

| # | Metric | Source | Target |
|---|---|---|---|
| 1 | Anti-bot bypass rate | `antibot.py` summary.overall.pass_rate | ≥ **0.95** |
| 2 | Fingerprint fidelity | `fingerprint.py` summary (sannysoft + others) | ≥ 13/14 sannysoft passes; no "headless" flag on creepjs |
| 3 | Throughput | `throughput.py` summary.pages_per_dollar | ≥ **2,000** at ≥0.95 pass rate |

See `AUDIT.md` for derivation of the 2,000 pages/$ target from competitor
pricing (ScraperAPI, ZenRows, ScrapingBee, Bright Data, Apify).

## Adding URLs

`bench/lists/protected.txt`, `bench/lists/fingerprint.txt`,
`bench/lists/throughput.txt`. Format:

```
<url> <tag>           # comments OK
```

For `protected.txt`, `<tag>` must be one of: `cloudflare`,
`cloudflare-turnstile`, `datadome`, `perimeterx`, `akamai`, `imperva`,
`kasada`, `none` (control).

Aim for 3+ URLs per vendor — single-URL signals are noise.

## Reproducibility

Each report includes:
- `commit_sha` — git HEAD at run time
- `iso_timestamp` — UTC timestamp
- `backend_endpoint` — which scraper stack ran
- `config` — runner-specific knobs
- `summary` — aggregate stats
- `results` — per-URL detail

Diff two reports:
```bash
python -c "
import json
old = json.load(open('bench/results/antibot-20260521T140000Z.json'))
new = json.load(open('bench/results/antibot-20260521T160000Z.json'))
print(f'overall: {old[\"summary\"][\"overall\"][\"pass_rate\"]:.1%} → {new[\"summary\"][\"overall\"][\"pass_rate\"]:.1%}')
"
```

## Paid services / setup not in repo

See `setup_needed.md` for the list of paid API keys (2captcha, BrightData,
CapSolver, etc.) we'd plug in to unlock the harder vendors. Each is gated
behind an env var so the benchmark fails-loud-and-skips instead of
fabricating numbers when the key is missing.
