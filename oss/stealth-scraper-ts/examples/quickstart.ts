/**
 * Minimal quickstart for the TypeScript SDK.
 *
 *   export STEALTH_SCRAPER_API_KEY="ssk_..."
 *   npm install stealth-scraper
 *   npx tsx examples/quickstart.ts
 */

import { Client, type TemplateField } from "stealth-scraper";

async function main() {
  const client = new Client();

  // 1. Snapshot — see the page
  const snap = await client.snapshot("https://news.ycombinator.com");
  console.log(`Snapshot: ${snap.title} (${snap.element_count} elements)`);

  // 2. Extract — structured data
  const template: TemplateField[] = [
    { label: "titles", selector: ".titleline > a", kind: "list" },
    { label: "scores", selector: ".score", kind: "list" },
  ];
  const result = await client.extract("https://news.ycombinator.com", template);
  const titles = (result.fields.titles as string[]) ?? [];
  console.log(`Top 3 titles: ${titles.slice(0, 3).join(" | ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
