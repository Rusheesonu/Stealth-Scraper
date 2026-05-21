# Stealth-Scraper — Engine Audit (Phase 0)

_Generated 2026-05-21 in iteration 1 of the `/loop` push toward win conditions:_
_(1) ≥95% anti-bot bypass on 20+ real production URLs; (2) clean fingerprint_
_verdicts; (3) ≥95% success at the highest pages/$ a fixed proxy budget can buy._

This document is the **honest map of where we stand vs the state of the art**.
Every claim cites `file:line`. Every gap has a proposed mitigation. The
**Phase 3 throughput target** is set in §6.

---

## 1. Current Architecture

```
┌─ FastAPI ─────────────────────────────────────────────────┐
│  main.py:332  /public/snapshot-and-suggest   (anon + IP RL)│
│  main.py:426  /snapshot, /extract, /assist   (enforce_plan)│
└──────────────────┬────────────────────────────────────────┘
                   │
        ┌──────────▼──────────┐
        │  snapshot.py        │  Navigation orchestrator
        │  - viewport mgmt    │  - set device metrics ONCE before nav (snapshot.py:75)
        │  - lazy-img hydrate │  - rewrite loading=lazy → eager (snapshot.py:107)
        │  - scroll-trigger   │  - 8 viewport heights max (snapshot.py:318)
        │  - settle wait      │  - poll stable scrollHeight (snapshot.py:240)
        │  - capture          │  - expand viewport + screenshot at same state (snapshot.py:171)
        └──────────┬──────────┘
                   │
        ┌──────────▼──────────────────────┐
        │  browser.py — BrowserPool       │  Single nodriver Browser
        │  - serialized via asyncio.Lock  │  (browser.py:64) — 1 tab at a time
        │  - lazy init + zombie probe     │  (browser.py:131)
        │  - proxy auth via CDP           │  (browser.py:187)
        │  - transient-flake retry        │  (browser.py:257) — restart+rotate proxy
        └──────────┬──────────────────────┘
                   │
       ┌───────────▼───────────┐    ┌──────────────────────┐
       │  stealth.py            │◄───┤  proxies.py          │
       │  - 28 Chromium args    │    │  - PROXIES_JSON env  │
       │  - 20 JS init patches  │    │  - random + sticky   │
       │  - Function.toString   │    │  - 100 endpoints     │
       │    marks fakes native  │    │  - 1 cred set        │
       └────────────────────────┘    └──────────────────────┘
                   │
       ┌───────────▼──────────┐
       │  detect.py            │  Post-snapshot block detection
       │  - 6 vendor signatures│  Cloudflare/PerimeterX/DataDome/Akamai/Imperva/Kasada
       │  - structured warning │  Returns {vendor, severity, suggestion, is_behavioral}
       └───────────────────────┘
                   │
       ┌───────────▼──────────┐
       │  extract.py + extract_js.py │  CSS/XPath/list/attr/markdown extraction
       │  - transforms pipeline      │  strip/regex/cast/split/slice
       │  - per-field validation     │  drop hallucinated selectors
       └─────────────────────────────┘
```

**Key design choices we already got right:**

- Engine: **nodriver** (not Selenium/Playwright). nodriver patches Chromium at
  the binary/flag level — kills the `cdc_*` / `webdriver` artifacts that the
  Selenium/Playwright stealth plugins still leak. (`browser.py:3-7`)
- Pool: **single Browser, multi-Tab**. Serialized via asyncio lock because
  nodriver isn't concurrency-safe on a single browser. (`browser.py:64`)
- Resilience: **transient-flake retry** matches known nodriver bugs (StopIteration
  in CDP cleanup, websocket drop, "Target crashed") by error-string and restarts
  with proxy rotation. (`browser.py:37-44`, `browser.py:257`)
- Proxy auth: **CDP `Fetch.authRequired` handler** — without this, Chromium's
  `--proxy-server` flag hangs forever on auth challenges. (`browser.py:187-249`)
- Detection visibility: **structured block-detection** so callers know vendor +
  suggestion instead of getting empty extractions. (`detect.py:1-242`)

---

## 2. Detection Surfaces — What We Handle

20 JS-layer fingerprint patches live in `backend/app/stealth.py`. All citations
are `stealth.py:N`. The 95th-percentile fingerprint API surface is covered:

| # | Surface | File:line | Patch quality |
|---|---|---|---|
| 1 | `navigator.webdriver` | stealth.py:113 | ✅ correct (returns undefined, configurable) |
| 2 | `chrome.runtime` / `loadTimes` / `csi` / `app` | stealth.py:122 | ✅ realistic shim — full enum tables |
| 3 | `navigator.plugins` as `PluginArray` w/ real `MimeType` prototypes | stealth.py:166 | ✅ 5 PDF plugins; was naïve `[1,2,3]` in v1 |
| 4 | `navigator.languages` / `language` | stealth.py:212 | ✅ matches `--accept-lang` |
| 5 | Permissions API ↔ Notification.permission consistency | stealth.py:225 | ✅ mirrors `Notification.permission` |
| 6 | WebGL **and WebGL2** vendor/renderer/parameters | stealth.py:242 | ✅ Intel Iris OpenGL spoof (6 params) |
| 7 | Canvas fingerprint noise (`toDataURL`, `getImageData`) | stealth.py:273 | ✅ ±1 subpixel on 0.1% pixels |
| 8 | AudioContext fingerprint noise (`getChannelData`, `getFloatFrequencyData`) | stealth.py:316 | ✅ jitter below human perception |
| 9 | WebRTC IP leak prevention (`RTCPeerConnection`, SDP strip) | stealth.py:335 | ✅ force empty iceServers + strip host candidates |
| 10 | Window/screen dimensions consistency (`inner*`, `outer*`, `screen.*`) | stealth.py:367 | ✅ 1920×1080 (matches `--window-size` flag) |
| 11 | `hardwareConcurrency` / `deviceMemory` / `maxTouchPoints` | stealth.py:383 | ⚠️ **NOT correlated to GPU spoof** — gap (see §3.6) |
| 12 | `navigator.connection` Network Information API | stealth.py:395 | ✅ 4g wifi shape |
| 13 | `navigator.mediaDevices.enumerateDevices` | stealth.py:416 | ✅ audio+video device shape |
| 14 | Battery API (`navigator.getBattery`) | stealth.py:435 | ✅ laptop @ 78% |
| 15 | `speechSynthesis.getVoices` | stealth.py:455 | ⚠️ provides list but doesn't fire `voiceschanged` event |
| 16 | `navigator.userAgentData` w/ `getHighEntropyValues` | stealth.py:467 | ✅ matches UA + full version list |
| 17 | `documentElement.dataset.*` automation marker strip | stealth.py:506 | ✅ cypress/playwright/selenium/etc |
| 18 | iframe `contentWindow` consistency (copy patched navigator) | stealth.py:516 | ✅ defeats iframe-bypass detection |
| 19 | `performance.now()` jitter (anti timing-fingerprint) | stealth.py:541 | ✅ ±1µs |
| 20 | `console.debug` no-op (anti-CDP detection trap) | stealth.py:551 | ✅ swallows DevTools-detect probe |
| ALL | `Function.prototype.toString` returns `[native code]` for overrides | stealth.py:74 | ✅ critical — without this, every other patch is detectable |

**Chromium command-line flags (`stealth.py:21-104`):**

- `--headless=new` (modern headless, not detectable like classic `--headless=true`)
- `--disable-blink-features=AutomationControlled` (kills the CDP feature flag)
- `--disable-infobars` (removes "automated test software" banner)
- `--user-agent=Chrome/131 Windows` (matches Client Hints)
- `--lang=en-US` + `--accept-lang=en-US,en;q=0.9` (language consistency)
- `--password-store=basic`, `--use-mock-keychain` (anti-credential-leak)
- 28 flags total; full list in `stealth.py:21-49`.

**Container-only flags** (added on Linux: `stealth.py:96-104`):
- `--no-sandbox`, `--disable-dev-shm-usage`, `--disable-features=UserAgentClientHint`

**Bench score on bot.sannysoft.com (target, not measured yet):** ~13/14
(documented in stealth.py header comment; Phase 1 will validate empirically).

---

## 3. Detection Surfaces — The Gap List

These are missing or partial. Ranked by **impact on bypass rate** vs **cost to
implement**. The Phase 2+ loop will pick from here based on benchmark deltas.

### 3.1 ❌ **TLS/JA3/JA4 fingerprint** (HIGH impact, MEDIUM-HIGH cost)

**What it is:** PerimeterX, DataDome, Akamai BMP, and Cloudflare (enterprise tier)
inspect the TLS ClientHello fingerprint (JA3 hash) BEFORE any JS runs. Chromium's
TLS stack has a fingerprint that real Chrome shares — BUT headless Chromium under
nodriver has a SUBTLY DIFFERENT one (cipher suite ordering, extension list,
GREASE values, ALPN order). It's enough to flag every request as suspicious
even before the page loads.

**Why we're vulnerable:** We use vanilla Chromium TLS via nodriver. No
impersonation layer.

**Mitigation options:**

- **(a)** Proxy traffic via [`curl-impersonate`](https://github.com/lwthiker/curl-impersonate)
  running as an HTTPS-MITM CONNECT proxy on the Lightsail box. Chromium connects
  to localhost:8081 (our curl-impersonate proxy), curl-impersonate negotiates
  the real-Chrome TLS handshake outbound. Implementation: 1-2 days. Adds a
  process to manage.
- **(b)** Use [`hrequests`](https://github.com/daijro/hrequests) / `tls_client` for
  HTTP-only routes (no JS execution). For sites that DON'T need a browser, this
  bypasses TLS detection entirely at 10x throughput. Phase 4 territory.
- **(c)** Patch Chromium binary with `rebrowser-patches` approach (modify TLS
  cipher list at compile time). Highest impact but requires custom Chromium
  builds.

**Bench cost:** Will lift Akamai BMP success from ~10% → ~40-60%. Major lever.

### 3.2 ❌ **HTTP/2 SETTINGS frame fingerprint** (MEDIUM impact, LOW cost)

**What it is:** DataDome and Akamai look at the H2 SETTINGS frame your client
sends in the HTTP/2 handshake — specifically the order of settings and the
windows-size value. Different clients have different signatures.

**Why we're vulnerable:** Chromium's H2 is consistent, but datacenter proxies
in the middle can rewrite frames, producing a hybrid fingerprint that matches
no real browser.

**Mitigation:** Same path as 3.1 — curl-impersonate handles H2 signature too.

### 3.3 ❌ **HTTP/3 (QUIC)** (LOW impact, depends on Chromium)

**What it is:** Real Chrome opportunistically uses h3 for sites that advertise
it via Alt-Svc. Headless Chromium often disables QUIC by default.

**Why we're vulnerable:** Minor signal; rarely the deciding factor.

**Mitigation:** Don't pass `--disable-quic`. Verify QUIC works in headless via
`chrome://net-export`.

### 3.4 ❌ **Mouse path simulation** (MEDIUM impact for behavioral, LOW cost)

**What it is:** `actions.py:run_actions` does `element.click()` instantly. Real
users move the mouse along Bezier curves with accelerating/decelerating motion
(Fitts's Law: time to target ∝ log(distance/size)). PerimeterX's behavioral
analytics specifically look for "0ms" mouse movement.

**Why we're vulnerable:** All clicks happen with no mouse trajectory.

**Mitigation:** New module `humanize.py` with `human_click(tab, selector)`
that:
1. Reads current mouse position (or random off-target start)
2. Computes Bezier control points (3-4 random anchor offsets)
3. Interpolates over Fitts's-law-derived duration (40-200ms)
4. Sends `Input.dispatchMouseEvent(mouseMoved)` per step (~16ms apart)
5. Final `Input.dispatchMouseEvent(mousePressed/Released)`

**Bench cost:** Required for PerimeterX press-and-hold (combined with hold-pressure
simulation). Without it, that challenge fails 100%.

### 3.5 ❌ **Keyboard typing rhythm** (LOW impact, LOW cost)

**What it is:** Form-fill actions send the full text instantly. Real humans
type with dwell time (50-150ms per key) and varying flight time (gaps between
keys based on hand position).

**Why we're vulnerable:** `actions.py:fill` is instant.

**Mitigation:** `humanize.type_into(tab, selector, text)` with character-by-character
`Input.dispatchKeyEvent` and per-key random delay sampled from a real human dataset
distribution. ~50 lines.

### 3.6 ⚠️ **Coherent fingerprint profiles** (MEDIUM impact, MEDIUM cost)

**What it is:** We currently spoof:
- GPU: Intel Iris OpenGL (Macbook Air vintage)
- Cores: 8, RAM: 8 GB (Macbook Air spec)
- Window: 1920×1080 (desktop spec, NOT Macbook Air)
- UA: Chrome 131 on Windows NT 10.0

A real device's fingerprint is correlated: a Macbook Air has 1440×900, NOT
1920×1080. A Windows desktop has NVIDIA/AMD GPU, NOT Intel Iris OpenGL. Sites
running fingerprint correlation analysis (CreepJS, FingerprintJS Pro Enterprise)
flag mismatches.

**Why we're vulnerable:** Values picked individually for "look real" without
checking for consistency.

**Mitigation:** Build `device_profiles.py` with 4-6 fully-correlated presets:
- `windows_desktop_intel` (Win10, 1920×1080, Intel UHD 630, 8 cores, 16GB)
- `windows_desktop_nvidia` (Win10, 2560×1440, NVIDIA RTX 3060, 12 cores, 32GB)
- `macbook_air_m2` (macOS 14, 1470×956, Apple GPU, 8 cores, 8GB)
- `macbook_pro_m3` (macOS 14, 1728×1117, Apple GPU, 12 cores, 18GB)
- `linux_ubuntu` (Ubuntu 22.04, 1920×1080, Mesa Intel, 4 cores, 8GB)

Each preset bundles UA, Client Hints, Screen dims, WebGL vendor/renderer, cores,
RAM, languages, timezone (matched to user's proxy geo). `pool.start(profile=...)`
picks one or `random.choice()` for rotation.

### 3.7 ⚠️ **Client Hints (Sec-CH-UA-* headers)** (MEDIUM impact, LOW cost)

**What it is:** Modern Chrome sends `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform`
headers BEFORE any JS runs (request headers). They need to agree with the User-Agent
string AND `navigator.userAgentData`. Headless Chromium often sends them empty or
inconsistent.

**Why we're vulnerable:** We override UA via `--user-agent` flag but don't override
Client Hints headers.

**Mitigation:** Use `Network.setExtraHTTPHeaders` via CDP at browser start to set:
- `Sec-CH-UA: "Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"`
- `Sec-CH-UA-Mobile: ?0`
- `Sec-CH-UA-Platform: "Windows"`
- `Sec-CH-UA-Platform-Version: "15.0.0"`

Matching what `navigator.userAgentData.getHighEntropyValues()` returns
(stealth.py:467) so values agree across the JS API and HTTP layer.

### 3.8 ❌ **Cookie/session persistence per scrape session** (HIGH impact, MEDIUM cost)

**What it is:** Each scrape opens a fresh tab → empty cookie jar. Cloudflare,
Akamai, and DataDome build trust scores over consecutive visits (cookies like
`cf_clearance`, `_abck`, `datadome` carry validated-human tokens). Without
session continuity, every visit re-triggers the challenge.

**Why we're vulnerable:** `pool.open_tab()` creates a tab on the shared browser
but no per-session cookie isolation, no per-task cookie persistence.

**Mitigation:** Per-task `BrowserContext`-style isolation:
- Add `pool.open_tab(session_key=...)` that creates a sticky Chromium profile
  directory under `/tmp/sessions/<key>/`.
- Same `session_key` → same cookies, same localStorage, same `cf_clearance`.
- Combined with sticky-proxy (per `session_key` → same egress IP) for full
  session continuity.

Required for Cloudflare gold-tier. Approximate work: 1-2 days.

### 3.9 ⚠️ **Stable session per cookie jar (sticky proxy)** (HIGH impact, LOW cost)

**What it is:** Currently `proxies.host_port_user_pass()` picks `random.choice`
on every browser restart (`proxies.py:97`). Cloudflare sees a `cf_clearance`
cookie from IP A then a request from IP B = instant re-challenge.

**Why we're vulnerable:** No coupling between cookie jar and exit IP.

**Mitigation:** `proxies.pick_for_user(user_id)` exists (`proxies.py:73`) but is
deterministic-by-hash of `user_id`, not by scrape-session. Add `pick_for_session(session_key)`
that pairs with §3.8.

### 3.10 ❌ **CAPTCHA solver integration** (MEDIUM impact for some sites, LOW cost stub)

**What it is:** Cloudflare Turnstile (interactive mode), hCaptcha, and reCAPTCHA
sometimes present a visible challenge we can't auto-pass. Real solution: pipe to
a solver service.

**Why we're vulnerable:** `detect.py` flags the challenge; no solver wired.

**Mitigation:** Pluggable adapter system:
- `solvers/twocaptcha.py` — 2captcha API (~$0.30/solve)
- `solvers/capsolver.py` — CapSolver API (~$0.50/solve)
- `solvers/nopecha.py` — NopeCHA local-extension approach
- Detection layer routes blocked snapshots to configured solver based on vendor

Won't beat PerimeterX press-and-hold (behavioral, not algorithmic), but unlocks
~80% of "challenged" sites we currently can't penetrate.

### 3.11 ❌ **Per-site bypass profiles** (MEDIUM impact, accumulates over time)

**What it is:** Amazon needs a homepage hit first to warm cookies before product
URLs work. LinkedIn rejects fresh sessions on profile URLs (need to land on /feed
first). Different sites have different known tactics.

**Why we're vulnerable:** Every URL gets the same treatment — direct navigate.

**Mitigation:** `site_profiles.py` keyed by hostname:
```python
{
  "amazon.com": SiteProfile(
    warmup_urls=["https://www.amazon.com/"],
    cookie_dwell_ms=2000,
    user_agent_pin="chrome_131_mac",  # works better than win for this site
  ),
  "linkedin.com": ...,
}
```
Pool checks the profile before navigation. Grows iteratively per failing site.

### 3.12 ⚠️ **Concurrency per browser** (HIGH impact on throughput, MEDIUM cost)

**What it is:** `browser.py:64` serializes all tab work through one `asyncio.Lock`.
Maximum throughput is **1 scrape at a time per BrowserPool instance**. Even with
a fast box, this caps us at ~30 scrapes/min.

**Why we're vulnerable:** nodriver crashes under concurrent CDP traffic on a
single browser (well-documented). We chose safety over throughput.

**Mitigation:** Multi-browser pool — N concurrent `BrowserPool` instances (each
owns its own Chromium subprocess + proxy), round-robin requests across them.
For our 8GB RAM box: 4-6 instances comfortable (each browser = ~800MB RAM
under load).

**Throughput impact:** 1x → 4-6x.

### 3.13 ❌ **Real residential proxies** (HIGH impact on success rate, HIGH cost)

**What it is:** Our 100-proxy Webshare pool is **datacenter IPs**. Cloudflare,
Akamai, and DataDome have first-class detection for known datacenter ranges
(AWS, GCP, Azure, OVH, Hetzner, DigitalOcean, Webshare's own ranges). Residential
IPs (real consumer ISPs like Comcast, Verizon) bypass this entirely.

**Why we're vulnerable:** Cost. Residential ≈ 10-100x datacenter pricing.

**Mitigation:** Hybrid pool:
- Datacenter (cheap) for soft sites (HN, books.toscrape, basic ecom)
- Residential (expensive) for hard sites (Amazon, LinkedIn, Zillow, Instagram)
- `detect.py` triggers residential fallback on 1st-attempt block

Integrate Bright Data Web Unlocker or Oxylabs Datacenter Premium.

### 3.14 ❌ **TLS session ticket reuse** (LOW impact, depends on stack)

**What it is:** Real browsers cache TLS session tickets and reuse them within a
session (0-RTT). Akamai BMP looks at whether session tickets are being reused vs
fresh handshakes per request.

**Why we're vulnerable:** Chromium handles this; need to verify it's actually
enabled in our headless config.

**Mitigation:** Verify via `chrome://net-internals/#ssl`. May require enabling
specific flags.

---

## 4. State of the Art — Where We Stand

| Tool | Approach | Best at | Our position |
|---|---|---|---|
| **nodriver** | CDP-patched Chromium, kills cdc_* | Modern alternative to undetected-chromedriver | ✅ We use it — foundation is correct |
| **undetected-chromedriver** | Selenium-era stealth | Was state of the art 2020-2022 | ⏪ Obsolete; nodriver replaces it |
| **camoufox** | Patched Firefox binary | Different engine = unique fingerprint | ❌ We're Chromium-only — gap, but big work to add |
| **patchright** | Playwright fork w/ binary patches | Best-in-class for Playwright users | ➖ Different ecosystem; we use nodriver |
| **botasaurus** | High-level Python async framework | Convenience, retries, profile rotation | ➖ Higher-level wrapper; we could adopt patterns |
| **curl-impersonate** | C + BoringSSL TLS impersonation | **TLS/HTTP2 fingerprint = real Chrome** | ❌ Major gap (§3.1, §3.2) |
| **tls-client** (Go) | Go-based TLS impersonator | Same as curl-impersonate, different lang | ❌ Same gap |
| **rebrowser-patches** | Puppeteer/Playwright binary patches | Various low-level patches we could adopt | ➖ Some applicable patterns |
| **hrequests** | Python `requests`-API + TLS impersonation | High throughput for non-JS sites | ❌ Alternative path for soft scrapes — gap |

**Honest standing:** Stealth-Scraper's JS-fingerprint layer is **competitive with
the best of the open-source stealth stacks** and ahead of `playwright-stealth`,
`undetected-chromedriver`. Where we're **structurally behind**:

1. **TLS fingerprint** (no impersonation layer)
2. **Behavioral simulation** (no humanize.py)
3. **Per-session continuity** (no cookie persistence)
4. **Throughput** (1-at-a-time per pool)
5. **Proxy quality** (datacenter only)

These 5 are the Phase 2+ roadmap, in roughly this priority order based on
bypass-rate impact vs implementation cost.

---

## 5. Anti-Bot Vendor Difficulty (Empirical Estimates)

Pre-benchmark expectation, to be confirmed by Phase 1 measurements:

| Vendor | Our current expected success | Notes |
|---|---|---|
| **Cloudflare (free/lite tier)** | 80-95% | Soft challenges auto-pass; nodriver kills most signals |
| **Cloudflare (enterprise + Turnstile)** | 30-50% | TLS detection + behavioral start mattering |
| **DataDome** | 20-40% | TLS fingerprint critical; we'll fail without §3.1 |
| **Akamai Bot Manager** | 10-30% | TLS + HTTP/2 fingerprint heavy; needs §3.1 + §3.2 |
| **PerimeterX (HUMAN) static** | 40-60% | Fingerprint-only mode: passable |
| **PerimeterX (HUMAN) behavioral (press-and-hold)** | <5% | Needs CAPTCHA solver OR pressure-curve simulation |
| **Imperva (Incapsula)** | 20-40% | IP reputation heavy; residential proxies essential |
| **Kasada** | 5-20% | Aggressive headless detection; may need camoufox approach |

**Bottom line:** We're at maybe **35-50% blended success rate** today on the
20-URL benchmark we'll build in Phase 1. Win condition is **≥95%**. That's a
**~2x lift** needed — achievable with §3.1 + §3.4 + §3.8 + §3.13 stacked.

---

## 6. Phase 3 Throughput Target: ≥2,000 pages / $

Derived from competitor pricing (queried 2026-05-21):

| Competitor | Plan | Price | Credits/Pages | $/page | pages/$ |
|---|---|---|---|---|---|
| ScrapingDog | Lite | $30/mo | 200,000 req | $0.00015 | **6,667** |
| ZenRows | Developer | $69/mo | 250,000 req | $0.000276 | **3,623** |
| ScraperAPI | Hobby | $49/mo | 100,000 cr | $0.00049 | **2,041** |
| ScrapingBee | Freelance | $49/mo | 100,000 cr | $0.00049 | **2,041** |
| Bright Data Unlocker | PAYG | $1.50 / 1k | — | $0.0015 | **667** |
| Apify Web Scraper (hard sites) | PAYG | $0.01-0.05/page | — | — | **20-100** |

**Our cost structure today:**

| Component | Monthly | Per scrape |
|---|---|---|
| AWS Lightsail (8GB / 2 vCPU / Virginia) | $40 | ~$0.000088 (assuming ~2 min/scrape compute) |
| Webshare datacenter (100 IPs unlimited) | $7.50 | ~$0.000004 |
| Supabase free tier | $0 | $0 |
| **Total marginal** | $47.50 | **~$0.0001 = 10,000 pages/$** (compute+proxy only) |

**Target tiers:**

| Tier | pages/$ | Implication |
|---|---|---|
| 🚫 Floor | <500 | Worse than Bright Data — uncompetitive |
| 🥉 Match competition | **≥2,000** | Matches ScraperAPI/ScrapingBee starter tier |
| 🥈 Beat competition | ≥5,000 | Beats most market — pricing power |
| 🥇 World-class | ≥10,000 | Dominates on price/performance |

**Phase 3 target: ≥2,000 pages/$ at ≥95% bypass success on the 20-URL benchmark.**

That's a defensible bar — competitive on price AND quality. World-class (≥10k)
is the stretch but requires:
- Concurrency (§3.12) — 4-6x compute efficiency
- Hybrid proxy (§3.13) — datacenter for easy, residential for hard
- Per-site profiles (§3.11) — avoid wasted attempts

---

## 7. Phase Plan

- **Phase 0** (this iter): ✅ Audit
- **Phase 1** (next iter): Build `bench/` with three runners (antibot,
  fingerprint, throughput). Commit baseline numbers. **No improvements until
  there's a measurement.**
- **Phase 2+** (subsequent iters): Pick the biggest gap vs win condition each
  iter. Implement one change. Re-run the relevant benchmark. Commit with
  before/after numbers. Revert if regression.

**Estimated iters to win condition** (very rough):
- Phase 1: 1 iter (build harness)
- Phase 2.1: 3-4 iters (TLS impersonation via curl-impersonate proxy)
- Phase 2.2: 2 iters (cookie session persistence)
- Phase 2.3: 1-2 iters (humanize.py for behavioral)
- Phase 2.4: 2 iters (device profile presets + Client Hints alignment)
- Phase 2.5: 1 iter (sticky proxy per session)
- Phase 2.6: 2 iters (multi-browser concurrency for throughput)
- Phase 2.7: 1 iter (CAPTCHA solver stub for Turnstile/hCaptcha)

**~13-15 iterations to win condition** if everything works first time.
Realistic: 18-22 iterations accounting for regressions and stuck loops.

---

## 8. Repo Constraints (decided up-front)

- **No public API breaks** without `CHANGELOG.md` entry
- **Pin every detection-bypass dep** (curl-impersonate version, 2captcha SDK
  version, etc.) — anti-bot landscape moves; reproducibility matters
- **Commit local-only** between iters; push to remote only when all 3 win
  conditions met (or user requests)
- **Numbers are the only truth** — no claim of improvement without a benchmark
  delta in the commit message
- **Don't burn iters on impossible vendors** — if a vendor can only be defeated
  with infra we don't have (e.g. paid Kasada bypass key), write the integration
  stub + `bench/setup_needed.md` entry and move on

---

## Appendix A — File Inventory

```
backend/app/
├── stealth.py            645 lines  ← 20 JS patches + 28 Chromium args
├── browser.py            274 lines  ← BrowserPool, proxy auth, retry
├── snapshot.py           333 lines  ← navigation orchestration
├── extract.py            526 lines  ← CSS/XPath/transforms extraction
├── extract_js.py         188 lines  ← in-page element collection
├── proxies.py            104 lines  ← rotation logic
├── detect.py             242 lines  ← 6-vendor block detection
├── actions.py            122 lines  ← click/fill/scroll (no humanize yet)
├── assist.py            1243 lines  ← LLM template generation (off-path for stealth)
├── main.py               808 lines  ← FastAPI routes
└── ...                              ← billing, db, auth, scheduler, usage, migrate

oss/stealth-browser/      (split OSS package, recent v0.1.0 commit on GitHub)
├── stealth_browser/
│   ├── stealth.py        ← mirror of backend's stealth.py
│   ├── browser.py        ← StealthBrowser class wrapping nodriver
│   ├── detect.py         ← mirror of backend's detect.py
│   └── __init__.py
├── examples/             ← basic.py, with_proxy_and_detect.py
├── benchmarks/run.py     ← smoke benchmark (skeleton)
├── README.md             ← feature matrix vs Playwright+stealth-js
└── pyproject.toml        ← pip-installable

bench/                    (to be built in Phase 1)
├── antibot.py            ← per-vendor success rate
├── fingerprint.py        ← bot.sannysoft + creepjs + browserleaks
├── throughput.py         ← pages/$ measurement
├── lists/                ← URL lists per vendor
├── results/              ← timestamped JSON reports
└── README.md             ← env vars, paid-API gating docs
```
