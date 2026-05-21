# Stealth /loop — iteration log

One-line entry per iteration. Format: `DATE | iter# | phase | change | benchmark Δ`

For "stuck" entries (3 iters no progress), include the two alternative directions
considered and which one was picked.

---

| Date | # | Phase | Change | Benchmark Δ |
|------|---|-------|--------|-------------|
| 2026-05-21 | 1 | 0 (audit) | Wrote AUDIT.md mapping 20 handled surfaces + 14 gaps vs SOTA. Set Phase 3 target ≥2,000 pages/$ at ≥95% success. | n/a (no benchmark yet) |
| 2026-05-21 | 2 | 1 (harness) | Built `bench/{antibot,fingerprint,throughput}.py` + lib + 3 URL lists + README + setup_needed. Ran limited baselines. | antibot 5/8=62.5% (3/3 fails were nodriver crashes, 0 detection blocks); throughput 4/5=80%, 5,390 pages/$ (local, easy URLs); fingerprint 4/7=57.1% pass (sannysoft 34/34, creepjs 31%-like-headless, canvas 100% unique — gaps surfaced) |
| 2026-05-21 | 2b | 1 (harness fix) | Replaced per-site SITE_PARSERS dict with `bench/llm_judge.py` — Groq Llama-3.3-70b reads visible text + returns structured verdict. Works on ANY detection site, zero per-site code. | fingerprint full baseline ran: pass=4 fail=3 unknown=2 of 9 sites; sannysoft 34/34, browserleaks-webrtc "No Leak"; gaps: creepjs "31% like headless", browserleaks-canvas "100% unique", fingerprint.com `"bot":"bad"` |
| 2026-05-21 | 3 | 2.1 (canvas) | Tested 3 canvas strategies: v1 random per-call (was), v2 per-session deterministic PRNG, v3 no-op pass-through. ALL produced identical browserleaks-canvas verdict=fail "Uniqueness: 100%". Kept v3 (simpler code, equivalent result). browserleaks DB doesn't index our headless-Chromium variant — canvas may be a fundamentally hard surface without device-profile spoofing (audit §3.6). | NO DELTA: fingerprint 4/3/2 unchanged. Honest. Next iter pivots to fingerprint wait time (slow pages stuck at "unknown") which is quicker tractable. |
