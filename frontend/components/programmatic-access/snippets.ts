/**
 * Pure snippet builder for the Programmatic-access terminal panel.
 *
 * One pure function per language. All inputs flow in through `SnippetCtx`
 * — no closures over component state, no React imports — so the same
 * function can be reused later for marketing pages, docs, or unit tests.
 *
 * The exact wording lives here, not in the renderer, because copy is what
 * the developer is grading us on: the snippet is the product.
 */

export type Lang = "curl" | "python" | "typescript" | "mcp" | "cron" | "github";

export type SnippetCtx = {
  /** Full key for clipboard — never mask before passing in. */
  apiKey: string;
  /** Template id (numeric in our schema; rendered as string). */
  templateId: string | number;
  /** Target URL the developer wants to scrape. */
  url: string;
};

export const LANGS: { id: Lang; label: string; iconText: string }[] = [
  { id: "curl",       label: "curl",           iconText: "$"  },
  { id: "python",     label: "Python",         iconText: "py" },
  { id: "typescript", label: "TypeScript",     iconText: "ts" },
  { id: "mcp",        label: "MCP",            iconText: "↳"  },
  { id: "cron",       label: "Cron",           iconText: "*"  },
  { id: "github",     label: "GitHub Actions", iconText: "gh" },
];

/**
 * Mask a key for display only. Clipboard always gets the full key.
 *  ssk_live_abcdef0123456789  →  ssk_live_•••6789
 *
 * Defensive against short / empty strings so a missing key never
 * crashes the renderer.
 */
export function maskKey(key: string): string {
  if (!key) return "sk_live_•••••";
  if (key.length <= 8) return key;
  const head = key.slice(0, Math.min(8, key.length - 4));
  const tail = key.slice(-4);
  return `${head}•••${tail}`;
}

export function buildSnippet(lang: Lang, ctx: SnippetCtx): string {
  const { apiKey, templateId, url } = ctx;
  const tid = String(templateId);

  switch (lang) {
    case "curl":
      // Two related calls in one block — one-shot extract, then schedule
      // create. Devs read top-down; the extract is what they want first.
      return [
        `# One-shot extract`,
        `$ curl -X POST https://api.stealthscraper.dev/extract \\`,
        `    -H "Authorization: Bearer $STEALTH_API_KEY" \\`,
        `    -H "Content-Type: application/json" \\`,
        `    -d '{"url":"${url}","template_id":"${tid}"}' | jq`,
        ``,
        `# Create a daily schedule for the same template`,
        `$ curl -X POST https://api.stealthscraper.dev/schedules \\`,
        `    -H "Authorization: Bearer $STEALTH_API_KEY" \\`,
        `    -H "Content-Type: application/json" \\`,
        `    -d '{"cron":"0 9 * * *","template_id":"${tid}","url":"${url}"}'`,
      ].join("\n");

    case "python":
      // Faux REPL session. The `$ pip install` + `$ python` prompts make
      // it visually obviously-a-terminal even before highlighting.
      return [
        `$ pip install stealth-scraper`,
        `$ python`,
        `>>> from stealth_scraper import Client`,
        `>>> client = Client(api_key="${apiKey}")`,
        `>>> result = client.extract(`,
        `...     url="${url}",`,
        `...     template_id="${tid}",`,
        `... )`,
        `>>> print(result.fields)`,
      ].join("\n");

    case "typescript":
      // Two-block format: install (shell) then the actual TS source. The
      // blank line between them reads as a section break in mono.
      return [
        `$ npm install stealth-scraper`,
        ``,
        `import { StealthScraper } from "stealth-scraper";`,
        ``,
        `const client = new StealthScraper({ apiKey: process.env.STEALTH_API_KEY });`,
        ``,
        `const { fields } = await client.extract({`,
        `  url: "${url}",`,
        `  templateId: "${tid}",`,
        `});`,
        ``,
        `console.log(fields);`,
      ].join("\n");

    case "mcp":
      // Claude Desktop / Cursor mcpServers entry. JSON.stringify to keep
      // formatting bulletproof; the key is in plaintext because that's
      // how MCP clients actually read it.
      return JSON.stringify(
        {
          mcpServers: {
            "stealth-scraper": {
              command: "npx",
              args: ["-y", "@stealth-scraper/mcp"],
              env: { STEALTH_API_KEY: apiKey },
            },
          },
        },
        null,
        2,
      );

    case "cron":
      // System crontab line. Keep the comment so users know what they're
      // pasting; the `tee -a` makes the result observable for debugging.
      return [
        `# Run every day at 9am UTC. Replace URL/template_id as needed.`,
        `0 9 * * * curl -sX POST https://api.stealthscraper.dev/extract \\`,
        `  -H "Authorization: Bearer $STEALTH_API_KEY" \\`,
        `  -d '{"url":"${url}","template_id":"${tid}"}' \\`,
        `  | tee -a ~/scrapes.log`,
      ].join("\n");

    case "github":
      // Workflow YAML. Uses GH Actions secrets for the key (the right
      // pattern), runs on cron + manual dispatch, uploads result.json as
      // a build artifact so devs can download it.
      return [
        `name: Daily scrape`,
        `on:`,
        `  schedule:`,
        `    - cron: "0 9 * * *"`,
        `  workflow_dispatch:`,
        `jobs:`,
        `  scrape:`,
        `    runs-on: ubuntu-latest`,
        `    steps:`,
        `      - uses: actions/checkout@v4`,
        `      - name: Extract`,
        `        env:`,
        `          STEALTH_API_KEY: \${{ secrets.STEALTH_API_KEY }}`,
        `        run: |`,
        `          curl -sX POST https://api.stealthscraper.dev/extract \\`,
        `            -H "Authorization: Bearer $STEALTH_API_KEY" \\`,
        `            -d '{"url":"${url}","template_id":"${tid}"}' \\`,
        `            > result.json`,
        `      - uses: actions/upload-artifact@v4`,
        `        with:`,
        `          name: scrape-result`,
        `          path: result.json`,
      ].join("\n");
  }
}
