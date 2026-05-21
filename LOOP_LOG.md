# Stealth /loop — iteration log

One-line entry per iteration. Format: `DATE | iter# | phase | change | benchmark Δ`

For "stuck" entries (3 iters no progress), include the two alternative directions
considered and which one was picked.

---

| Date | # | Phase | Change | Benchmark Δ |
|------|---|-------|--------|-------------|
| 2026-05-21 | 1 | 0 (audit) | Wrote AUDIT.md mapping 20 handled surfaces + 14 gaps vs SOTA. Set Phase 3 target ≥2,000 pages/$ at ≥95% success. | n/a (no benchmark yet) |
| 2026-05-21 | 2 | 1 (harness) | Built `bench/{antibot,fingerprint,throughput}.py` + lib + 3 URL lists + README + setup_needed. Ran limited baselines. | antibot 5/8=62.5% (3/3 fails were nodriver crashes, 0 detection blocks); throughput 4/5=80%, 5,390 pages/$ (local, easy URLs); fingerprint harness runs, parser needs work |
