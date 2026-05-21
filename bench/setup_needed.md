# bench/setup_needed.md — paid services for full benchmark coverage

Some vendors in `bench/lists/protected.txt` cannot be bypassed with
free infrastructure. This file lists the paid services we'd integrate to
unlock them. Each is gated behind an env var so the benchmark fails-loud
and skips instead of fabricating numbers when the key is missing.

**Priority order = impact on win condition #1 (≥95% antibot bypass).**

---

## 1. Residential proxy provider (BIGGEST unlock)

**Why:** Cloudflare, Akamai, DataDome, Imperva all flag known datacenter
IP ranges instantly. Webshare DC (what we ship) is on every blocklist.
Real residential IPs from consumer ISPs (Comcast, Verizon, AT&T) bypass
this entirely.

**Expected lift:** +20-30 percentage points on antibot.overall_pass_rate.

**Options:**

| Provider | $/GB | Notes |
|---|---|---|
| **Bright Data** Residential | $8.40 | Best quality, huge pool (72M+ IPs) |
| **Bright Data** Web Unlocker | $1.50/1k req | API-style, handles challenges too |
| **Oxylabs** Residential | $8.00 | Comparable to BrightData |
| **Smartproxy** Residential | $5.00 | Cheaper, smaller pool |
| **Webshare** Residential 1GB | $3.00 | Entry-level, sometimes patchy |

**Env vars to wire (none implemented yet):**
```bash
export RESIDENTIAL_PROXY_PROVIDER=brightdata
export RESIDENTIAL_PROXY_USER=...
export RESIDENTIAL_PROXY_PASS=...
export RESIDENTIAL_PROXY_HOST=brd.superproxy.io
export RESIDENTIAL_PROXY_PORT=22225
```

**Estimated benchmark cost:** ~$5-15 to run the full 20-URL antibot
benchmark on residential proxies (each scrape downloads ~500KB - 2MB).

---

## 2. CAPTCHA solver (for challenges we can't auto-pass)

**Why:** Cloudflare Turnstile (interactive mode), hCaptcha, reCAPTCHA v2/v3
sometimes present a visible challenge. Detection layer flags these via
`detect.py`; solver service answers them.

**Won't help with:** PerimeterX press-and-hold (behavioral, not algorithmic).

**Expected lift:** +5-10 pp on antibot.overall_pass_rate for
turnstile/captcha-walled sites.

**Options:**

| Provider | $/solve | Notes |
|---|---|---|
| **2captcha** | $0.30 (reCAPTCHA v2) / $1.00 (hCaptcha) | Largest, oldest |
| **CapSolver** | $0.50 avg | Faster, modern API |
| **NopeCHA** | $0.50/mo unlim local | Browser-ext approach, less reliable |

**Env vars:**
```bash
export CAPTCHA_SOLVER=2captcha
export CAPTCHA_API_KEY=...
```

**Estimated benchmark cost:** ~$1-3 per full antibot run that hits
captcha challenges.

---

## 3. PerimeterX behavioral solver (the boss-level wall)

**Why:** Zillow, Crunchbase profile pages, Glassdoor all use PerimeterX
press-and-hold. No JS-level stealth defeats this — needs either a captcha
service that supports behavioral OR a custom pressure-curve simulator.

**Won't help with:** Sites that use PerimeterX's invisible mode (no
challenge at all, just block on score).

**Options:**

| Provider | $/solve | Notes |
|---|---|---|
| **2captcha** PerimeterX | $1.00-2.00 | Limited site support |
| **CapSolver** PerimeterX | $1.00 | Reasonable success rate |
| **AntiCaptcha** PerimeterX | $1.50 | Often best for Zillow specifically |

**Status:** No stub written yet. Expect ~30% reduction in PerimeterX
fail-rate after integration (still won't be 95% on Zillow — it's that
hard).

---

## 4. Kasada bypass (sometimes only solvable by paid vendor)

**Why:** Kasada targets headless Chrome SPECIFICALLY with their KP_UIDz
runtime sensor. Generic stealth fails ~80% of the time.

**Options:**

| Approach | Cost | Notes |
|---|---|---|
| **camoufox** (Firefox-based) | free | Different engine; might defeat Kasada |
| **Kasada bypass-as-a-service** | varies | Closed-source, $$$ |
| **Real Chrome via xvfb + behavioral** | infra | Most reliable; we'd build it |

**Status:** Not on the Phase 2 roadmap until we hit a paying customer
who needs Kasada-protected sites.

---

## 5. JA3/JA4 TLS impersonation (curl-impersonate proxy)

**Why:** All major vendors look at the TLS ClientHello fingerprint BEFORE
any JS runs. Chromium-via-nodriver has a subtly different fingerprint
than real Chrome (cipher order, extension ordering, GREASE values).

**Not paid — but needs infra work.** Run curl-impersonate as a local
HTTP(S) CONNECT proxy on the AWS box, point Chromium at it via
`--proxy-server=http://localhost:8081`.

**Expected lift:** +15-20 pp on DataDome / Akamai / Cloudflare-Enterprise.

**Status:** Phase 2.1 (next iter after baseline lands).

---

## Cost ceiling

The win condition is "≥95% bypass at the highest pages/$ achievable".
Adding a $4/GB residential proxy + $0.30/captcha-solve will tank pages/$
on the worst sites — that's OK. The throughput benchmark deliberately
uses a mix of easy/medium URLs so pages/$ stays meaningful, and the
antibot benchmark reports per-vendor pass rate separately so we don't
hide an expensive but-it-works approach behind an aggregate.

If a vendor needs >$0.05/page to scrape reliably, that's a vendor we
**document and skip** from the throughput pool, not one we burn budget on.
