"""Benchmark harness for Stealth-Scraper.

See bench/README.md for usage. Three runners:

    python -m bench.antibot      → per-vendor bypass rate on real protected URLs
    python -m bench.fingerprint  → bot.sannysoft, creepjs, browserleaks
    python -m bench.throughput   → pages/$ on a fixed list

All runners write timestamped JSON to bench/results/. Commit baselines.
"""
