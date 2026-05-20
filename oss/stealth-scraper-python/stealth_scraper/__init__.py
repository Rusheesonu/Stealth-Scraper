"""stealth-scraper: async Python SDK for the Stealth-Scraper API.

    import asyncio
    from stealth_scraper import Client

    async def main():
        async with Client() as client:
            snap = await client.snapshot("https://example.com")
            print(snap["title"])

    asyncio.run(main())
"""

from stealth_scraper.client import (
    Client,
    StealthScraperError,
    TemplateField,
)

__version__ = "0.1.0"

__all__ = [
    "Client",
    "StealthScraperError",
    "TemplateField",
]
