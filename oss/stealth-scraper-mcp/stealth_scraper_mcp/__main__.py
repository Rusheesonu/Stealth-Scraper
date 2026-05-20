"""Entry point — invoked by `stealth-scraper-mcp` console script or
`python -m stealth_scraper_mcp`. Reads config from env vars and starts
the stdio MCP server."""

from __future__ import annotations

import asyncio
import sys


def main() -> None:
    try:
        from stealth_scraper_mcp.server import run
        asyncio.run(run())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
