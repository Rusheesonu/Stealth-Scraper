# stealth-scraper (Python)

Official Python SDK for [Stealth Scraper](https://stealthscraper.dev) — the anti-bot-resistant web scraping API.

> **Status:** beta — PyPI release coming with the Product Hunt launch
> (June 1, 2026). Until then, install from git (one-liner, works today).

## Install

```bash
# During beta — install directly from GitHub:
pip install git+https://github.com/Rusheesonu/Stealth-Scraper.git#subdirectory=sdks/python

# After June 1 PyPI release:
pip install stealth-scraper
```

## Quickstart

```python
from stealth_scraper import StealthClient

client = StealthClient(api_key="ssk_...")        # or set STEALTH_SCRAPER_API_KEY

# Stealth snapshot — screenshot + structured element catalog
snap = client.snapshot("https://news.ycombinator.com/")
print(snap.title, snap.element_count)

# Run a saved template
result = client.extract(url="https://news.ycombinator.com/", template_id="t_xxx")
print(result.fields)

# AI-assisted one-shot extraction (no template needed)
data = client.assist_extract(
    url="https://news.ycombinator.com/",
    description="get the top 20 story titles, scores, and links",
)
print(data.template)   # the generated recipe
print(data.fields)     # extracted values
```

### Async

```python
import asyncio
from stealth_scraper import AsyncStealthClient

async def main():
    async with AsyncStealthClient(api_key="ssk_...") as client:
        snap = await client.snapshot("https://example.com")
        async for ev in client.snapshot_stream("https://heavy.example.com"):
            print(ev.event, ev.progress, ev.message)

asyncio.run(main())
```

## Features

- **Typed result objects** — `SnapshotResult`, `ExtractResult`, `AssistExtractResult`, `Template`.
- **Typed error envelopes** — `AntiBotBlockError(vendor=...)`, `PlanLimitError(used=, limit=)`, `OverloadedError(retry_after_s=)`, `RateLimitError`, `AuthError`. Catch the kind of failure you actually want to handle, not a string.
- **Automatic idempotency keys** — every mutating call sends an `Idempotency-Key` header (UUID4 if you don't pass one). Safe to retry.
- **Cost preview** — `client.estimate(url, schema=...)` returns expected credits before you spend them.
- **Streaming snapshots** — `async for ev in client.snapshot_stream(url): ...`.
- **Sync + async** — same surface on both `StealthClient` and `AsyncStealthClient`.
- **Fully typed** — `py.typed` marker shipped, mypy-clean.

## Error handling

```python
from stealth_scraper import StealthClient, AntiBotBlockError, RateLimitError, PlanLimitError

client = StealthClient(api_key="ssk_...")
try:
    client.snapshot("https://www.cloudflare-protected.example")
except AntiBotBlockError as e:
    print(f"blocked by {e.vendor}: {e.suggestion}")
except RateLimitError as e:
    print(f"slow down, retry in {e.retry_after_s}s")
except PlanLimitError as e:
    print(f"used {e.used}/{e.limit} — upgrade at {e.upgrade_url}")
```

## Configuration

| Argument        | Env var                    | Default                          |
| --------------- | -------------------------- | -------------------------------- |
| `api_key`       | `STEALTH_SCRAPER_API_KEY`  | required                         |
| `base_url`      | —                          | `https://api.stealthscraper.dev` |
| `timeout`       | —                          | 120 seconds                      |

## Development

```bash
pip install -e ".[dev]"
pytest
```

## RUN THIS TO PUBLISH

```bash
pip install build twine
python -m build           # produces dist/*.whl and dist/*.tar.gz
twine check dist/*
twine upload dist/*       # requires PyPI API token
```

## License

MIT
