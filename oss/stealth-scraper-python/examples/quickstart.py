"""Minimal quickstart for the Python SDK.

    export STEALTH_SCRAPER_API_KEY="ssk_..."
    pip install stealth-scraper
    python examples/quickstart.py
"""

import asyncio

from stealth_scraper import Client


async def main() -> None:
    async with Client() as client:
        # 1. Snapshot — see the page
        snap = await client.snapshot("https://news.ycombinator.com")
        print(f"Snapshot: {snap['title']} ({snap['element_count']} elements)")

        # 2. Extract — get structured data
        template = [
            {"label": "titles", "selector": ".titleline > a", "kind": "list"},
            {"label": "scores", "selector": ".score", "kind": "list"},
        ]
        result = await client.extract("https://news.ycombinator.com", template)
        titles = result["fields"].get("titles", [])
        print(f"Top 3 titles: {titles[:3]}")


if __name__ == "__main__":
    asyncio.run(main())
