"use client";

import { useEffect, useMemo, useState } from "react";
import { Terminal, Eye, EyeOff } from "lucide-react";
import { api, type ApiKey, type SavedTemplate } from "@/lib/api";
import { LangTabs } from "./lang-tabs";
import { TemplatePicker } from "./template-picker";
import { TerminalCard } from "./terminal-card";
import { buildSnippet, maskKey, type Lang } from "./snippets";

/**
 * Programmatic-access panel for /settings/api-keys.
 *
 * Loads the user's saved templates, picks one + its source_url as the
 * defaults, and renders six copy-paste snippets in a terminal-styled
 * card. The api key is shown masked in the UI (with a reveal toggle)
 * but lands on the clipboard in full so the snippet just works.
 *
 * Inputs from the parent:
 *  • `apiKeys` — caller is responsible for fetching the list (it
 *    already does for the existing key table). We pick the most
 *    recent non-revoked one as the working key.
 *  • `justCreatedKey` — when the user just hit "Create key", this is
 *    the only place we ever have the FULL key. Use it for the
 *    clipboard if present so the snippets are actually runnable.
 */
export function ProgrammaticAccessPanel({
  apiKeys,
  justCreatedKey,
}: {
  apiKeys: ApiKey[] | null;
  justCreatedKey: string | null;
}) {
  const [templates, setTemplates] = useState<SavedTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [url, setUrl] = useState("");
  const [lang, setLang] = useState<Lang>("curl");
  const [revealKey, setRevealKey] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const ts = await api.listTemplates();
        if (cancel) return;
        setTemplates(ts);
        if (ts.length > 0) {
          setTemplateId(ts[0].id);
          setUrl(ts[0].source_url);
        }
      } catch (e) {
        if (!cancel) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  // Picking a template snaps the URL field to that template's
  // source_url. The user can still edit afterwards.
  function handleTemplateChange(id: number) {
    setTemplateId(id);
    const t = templates?.find((x) => x.id === id);
    if (t) setUrl(t.source_url);
  }

  /**
   * Working key strategy:
   *  • Prefer the just-created plaintext key — only time the full key
   *    is ever in memory; using it makes the copy actually runnable.
   *  • Otherwise fall back to the most recent non-revoked key prefix
   *    + a trailing "…" so the snippet is at least correctly shaped
   *    even though the user'll need to paste their own secret.
   */
  const activeKey = useMemo(() => {
    if (justCreatedKey) return justCreatedKey;
    const live = (apiKeys ?? []).find((k) => !k.revoked_at);
    return live ? `${live.prefix}…` : "ssk_xxx";
  }, [apiKeys, justCreatedKey]);

  const hasTemplates = (templates?.length ?? 0) > 0;
  const hasKey = (apiKeys ?? []).some((k) => !k.revoked_at) || !!justCreatedKey;
  const disabled = !hasTemplates;

  const code = useMemo(() => {
    if (!hasTemplates || !templateId) {
      // Empty-state placeholder snippet — still shaped, still copyable,
      // but the values are obviously fake so the dev knows to fill in.
      return buildSnippet(lang, {
        apiKey: activeKey,
        templateId: "tpl_xxx",
        url: url || "https://example.com",
      });
    }
    return buildSnippet(lang, { apiKey: activeKey, templateId, url });
  }, [lang, activeKey, templateId, url, hasTemplates]);

  const cardLabel = useMemo(() => {
    switch (lang) {
      case "curl":       return "curl";
      case "python":     return "python · stealth_scraper";
      case "typescript": return "node · stealth-scraper";
      case "mcp":        return "claude_desktop_config.json";
      case "cron":       return "crontab";
      case "github":     return ".github/workflows/scrape.yml";
    }
  }, [lang]);

  return (
    <section className="mt-12 border-t border-[var(--color-border)] pt-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
            <Terminal className="h-3 w-3" />
            Programmatic access
          </div>
          <h2 className="text-[22px] font-semibold tracking-[-0.005em] text-[var(--color-fg-strong)]">
            Drop into your stack
          </h2>
          <p className="mt-1.5 max-w-xl text-[15px] leading-[1.6] text-[var(--color-fg)]">
            Pick a saved template and a URL — get ready-to-paste snippets
            for curl, the SDKs, MCP, cron, and GitHub Actions. The shown
            key is masked; the clipboard receives the full secret.
          </p>
        </div>

        {/* Key chip — masked by default, toggle to reveal. Only useful
            when we actually have a key in hand (just-created or prefix). */}
        {hasKey && (
          <div className="hidden shrink-0 sm:block">
            <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
              Key in snippets
            </div>
            <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[12px] text-[var(--color-fg)]">
              <span>{revealKey ? activeKey : maskKey(activeKey)}</span>
              <button
                type="button"
                onClick={() => setRevealKey((v) => !v)}
                aria-label={revealKey ? "Hide key" : "Reveal key"}
                className="ml-1 text-[var(--color-fg-subdued)] transition-colors hover:text-[var(--color-fg)]"
              >
                {revealKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Empty / error states — keep the panel visible so the affordance
          is discoverable even before they have data. */}
      {loadError && (
        <div className="mb-4 rounded-lg border border-[color:var(--color-danger)]/30 bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[color:var(--color-danger)]">
          Couldn&apos;t load templates: {loadError}
        </div>
      )}
      {templates !== null && !hasTemplates && (
        <div className="mb-4 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-fg-muted)]">
          Create a template in{" "}
          <a href="/pick" className="text-[var(--color-accent)] hover:underline">
            /pick
          </a>{" "}
          first to see code snippets wired to your own data. The
          examples below use a placeholder template id.
        </div>
      )}

      <div className="mb-4">
        <TemplatePicker
          templates={templates ?? []}
          templateId={templateId}
          url={url}
          onTemplateChange={handleTemplateChange}
          onUrlChange={setUrl}
        />
      </div>

      <div className={disabled ? "pointer-events-none opacity-60" : ""}>
        <div className="mb-3">
          <LangTabs value={lang} onChange={setLang} />
        </div>
        <TerminalCard label={cardLabel} code={code} language={lang} />
      </div>

      <p className="mt-3 font-mono text-[11px] text-[var(--color-fg-subdued)]">
        # API base: <span className="text-[var(--color-fg-muted)]">https://api.stealthscraper.dev</span>
        {" · "}
        Auth: <span className="text-[var(--color-fg-muted)]">Bearer $STEALTH_API_KEY</span>
      </p>
    </section>
  );
}
