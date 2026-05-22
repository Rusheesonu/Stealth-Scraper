"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * SDK code preview — proves the "drop into your stack" claim. Tabbed
 * code blocks for Python, TypeScript, cURL, and MCP. Each tab has a
 * minimal install + run example using a real-looking template_id, so
 * developers can read it and immediately picture their codebase.
 *
 * Why this matters: most developer-tool landing pages tell you they
 * have SDKs. Showing the actual code is the difference between
 * "tell-don't-show" (low-trust) and "look here it is" (high-trust).
 * Especially important for the AI-agent-builder ICP — they read code
 * faster than marketing copy.
 */

type Lang = "python" | "typescript" | "curl" | "mcp";

const TABS: { id: Lang; label: string; iconText: string }[] = [
  { id: "python",     label: "Python",     iconText: "py" },
  { id: "typescript", label: "TypeScript", iconText: "ts" },
  { id: "curl",       label: "cURL",       iconText: "$" },
  { id: "mcp",        label: "MCP",        iconText: "↳" },
];

const SNIPPETS: Record<Lang, string> = {
  python: `pip install stealth-scraper

from stealth_scraper import Client

client = Client(api_key="ssk_...")

# Run a saved recipe on a new URL
result = client.run_template(
    template_id="tpl_hn_top_stories",
    url="https://news.ycombinator.com",
)

print(result.records[:3])
# [
#   {"title": "Show HN: ...", "points": 412, "comments": 87},
#   {"title": "Cloudflare's ...", "points": 287, "comments": 142},
#   {"title": "We replaced ...", "points": 198, "comments": 64},
# ]`,

  typescript: `npm install stealth-scraper

import { Client } from "stealth-scraper";

const client = new Client({ apiKey: "ssk_..." });

// Run a saved recipe on a new URL
const result = await client.runTemplate({
  templateId: "tpl_hn_top_stories",
  url: "https://news.ycombinator.com",
});

console.log(result.records.slice(0, 3));
// [
//   { title: "Show HN: ...", points: 412, comments: 87 },
//   { title: "Cloudflare's ...", points: 287, comments: 142 },
//   { title: "We replaced ...", points: 198, comments: 64 },
// ]`,

  curl: `curl -X POST https://stealthscraper.dev/api/run \\
  -H "Authorization: Bearer ssk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "template_id": "tpl_hn_top_stories",
    "url": "https://news.ycombinator.com"
  }'

# {
#   "records": [
#     {"title": "Show HN: ...", "points": 412, "comments": 87},
#     {"title": "Cloudflare's ...", "points": 287, "comments": 142}
#   ]
# }`,

  mcp: `// ~/Library/Application Support/Claude/claude_desktop_config.json

{
  "mcpServers": {
    "stealth-scraper": {
      "command": "npx",
      "args": ["-y", "@stealth-scraper/mcp"],
      "env": { "STEALTH_SCRAPER_API_KEY": "ssk_..." }
    }
  }
}

// Now in Claude Desktop / Cursor / Cline:
//   "Scrape news.ycombinator.com with tpl_hn_top_stories"
//
// The agent calls run_template via MCP and gets clean JSON back.`,
};

export function SdkPreview() {
  const [tab, setTab] = useState<Lang>("python");
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(SNIPPETS[tab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="relative mx-auto max-w-5xl py-10 md:py-14">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.4, ease: APPLE_EASE }}
        className="mb-7 text-center"
      >
        <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
          <Terminal className="h-3 w-3 text-[var(--color-accent)]" />
          Built for your stack
        </div>
        <h2 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.018em] text-[var(--color-fg-display)] sm:text-[32px]">
          One line to integrate.
          <span className="text-[var(--color-fg-muted)]"> Same recipe across every client.</span>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[13.5px] text-[var(--color-fg-muted)]">
          Save a recipe once in the visual picker. Run it from Python, TypeScript,
          a cURL one-liner, or directly through Claude Desktop via MCP.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.45, delay: 0.1, ease: APPLE_EASE }}
        className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]"
      >
        {/* Tab bar */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-3 py-2">
          <div className="flex items-center gap-0.5">
            {TABS.map(({ id, label, iconText }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium",
                    "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                    active
                      ? "text-[var(--color-fg-strong)]"
                      : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="sdk-tab-thumb"
                      className="absolute inset-0 -z-0 rounded-md bg-[var(--color-surface)] shadow-[var(--shadow-card)] ring-1 ring-[var(--color-border)]"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className={cn(
                    "relative z-10 inline-flex h-4 w-4 items-center justify-center rounded-sm font-mono text-[9px]",
                    active
                      ? "bg-[var(--color-accent-faint)] text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-accent-line)]"
                      : "bg-[var(--color-ink-2)] text-[var(--color-fg-muted)]",
                  )}>
                    {iconText}
                  </span>
                  <span className="relative z-10">{label}</span>
                </button>
              );
            })}
          </div>
          <button
            onClick={copy}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[10.5px] text-[var(--color-fg-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-fg)]"
            title="Copy snippet"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "copied" : "copy"}
          </button>
        </div>

        {/* Code */}
        <pre className="overflow-x-auto bg-[var(--color-ink-1)] px-5 py-4 font-mono text-[12px] leading-[1.65] text-[var(--color-fg)]">
          <CodeWithHints code={SNIPPETS[tab]} />
        </pre>

        {/* Footer caption */}
        <div className="border-t border-[var(--color-border)] bg-[var(--color-ink-1)] px-5 py-2.5 font-mono text-[10.5px] text-[var(--color-fg-subdued)]">
          tpl_hn_top_stories — example recipe. Yours come from the visual picker.
        </div>
      </motion.div>
    </section>
  );
}

/**
 * Tiny syntax highlighter — no library, just colors for the high-value
 * tokens (comments, strings, keywords). Saves us a 200KB dependency
 * (prism / shiki) for a 4-snippet display. Worth the trade.
 */
function CodeWithHints({ code }: { code: string }) {
  // Comment-aware splitter — runs line by line so multi-line strings
  // don't accidentally get tinted as comments.
  const lines = code.split("\n");
  return (
    <code>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        const isShellComment = trimmed.startsWith("#") || trimmed.startsWith("//");
        const isOutputLine = trimmed.startsWith("# {") || trimmed.startsWith("# [") || trimmed.startsWith("// {") || trimmed.startsWith("// [");
        const isInstall = trimmed.startsWith("pip install") || trimmed.startsWith("npm install") || trimmed.startsWith("curl ");
        const isJsonOutputLine = (trimmed.startsWith("#") || trimmed.startsWith("//")) && (trimmed.includes("title") || trimmed.includes("points") || trimmed.includes("records"));

        let className = "";
        if (isInstall) {
          className = "text-[var(--color-accent)] font-semibold";
        } else if (isJsonOutputLine || isOutputLine) {
          className = "text-[var(--color-fg-muted)]";
        } else if (isShellComment) {
          className = "text-[var(--color-fg-subdued)]";
        }
        return (
          <span key={idx} className={className}>
            {line}
            {idx < lines.length - 1 && "\n"}
          </span>
        );
      })}
    </code>
  );
}
