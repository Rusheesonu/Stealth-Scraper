"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2, ArrowRight, Save, Copy, ExternalLink, AlertTriangle } from "lucide-react";
import { Nav } from "@/components/nav";
import { api, type TemplateField, type ExtractResponse } from "@/lib/api";

type Stage = "idle" | "generating" | "extracting" | "done" | "error";

const EXAMPLES = [
  { url: "https://news.ycombinator.com", desc: "Get the top 10 stories — title, points, comment count, and submitter username." },
  { url: "https://quotes.toscrape.com", desc: "Get every quote, its author, and the tags on it." },
  { url: "https://www.producthunt.com", desc: "Get today's product launches with name, tagline, and upvote count." },
];

export default function AiExtractPage() {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [template, setTemplate] = useState<TemplateField[] | null>(null);
  const [results, setResults] = useState<ExtractResponse | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  async function generate(e?: React.FormEvent) {
    e?.preventDefault();
    if (!url.trim() || !description.trim()) return;

    setStage("generating");
    setError("");
    setTemplate(null);
    setResults(null);
    setSavedId(null);

    try {
      const norm = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      const res = await api.assistSchema({ url: norm, description: description.trim() });
      setTemplate(res.template);
      setStage("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Friendlier message for the common 503 case (no LLM key configured).
      setError(
        msg.includes("not configured")
          ? "AI assist isn't configured yet — admin needs to set LLM_API_KEY (free Groq key at console.groq.com)."
          : msg,
      );
      setStage("error");
    }
  }

  async function runExtraction() {
    if (!template) return;
    setStage("extracting");
    setResults(null);
    try {
      const norm = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      const res = await api.extract(norm, template);
      setResults(res);
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }

  async function saveAsTemplate() {
    if (!template) return;
    try {
      const norm = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      const saved = await api.createTemplate({
        name: description.slice(0, 60) || "AI-generated template",
        source_url: norm,
        fields: template,
      });
      setSavedId(saved.id);
    } catch (e) {
      alert("Save failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  function loadExample(ex: typeof EXAMPLES[number]) {
    setUrl(ex.url);
    setDescription(ex.desc);
    setStage("idle");
    setTemplate(null);
    setResults(null);
    setError("");
  }

  const isBusy = stage === "generating" || stage === "extracting";

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-10 text-center">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-300">
            <Sparkles className="h-3 w-3" />
            AI-powered · alpha
          </div>
          <h1 className="mb-3 text-4xl font-semibold tracking-tight">
            Describe it. <span className="text-[var(--color-accent)]">Get a scraper.</span>
          </h1>
          <p className="mx-auto max-w-xl text-sm text-[var(--color-muted)]">
            Paste a URL, describe what you want in plain English. An LLM
            reads the page and builds the extraction schema in under a second.
            Refine in the visual picker or run it as-is.
          </p>
        </div>

        {/* Form */}
        <form
          onSubmit={generate}
          className="mb-6 space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)]/40 p-5"
        >
          <input
            type="text"
            placeholder="https://news.ycombinator.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isBusy}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-600 disabled:opacity-50"
          />
          <textarea
            placeholder="What do you want to extract? e.g. 'Get product title, price, and rating from each item on this page'"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isBusy}
            rows={3}
            maxLength={500}
            className="w-full resize-none rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-600 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isBusy || !url.trim() || !description.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-zinc-900 hover:opacity-90 disabled:opacity-50"
          >
            {stage === "generating" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Reading page + asking the LLM…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate scraper
              </>
            )}
          </button>
        </form>

        {/* Examples */}
        {stage === "idle" && !template && (
          <div className="mb-8">
            <div className="mb-3 text-xs uppercase tracking-wider text-[var(--color-muted)]">
              Or try one:
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.url}
                  onClick={() => loadExample(ex)}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel)]/30 p-3 text-left text-xs transition hover:border-emerald-900 hover:bg-[var(--color-panel)]/60"
                >
                  <div className="mb-1 truncate font-mono text-[10px] text-[var(--color-muted)]">
                    {ex.url.replace(/^https?:\/\//, "")}
                  </div>
                  <div className="text-[var(--color-fg)]">{ex.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 flex items-start gap-2 rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Generated template */}
        {template && (
          <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)]/40 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Generated schema ({template.length} field{template.length === 1 ? "" : "s"})
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={runExtraction}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-zinc-900 hover:opacity-90 disabled:opacity-50"
                >
                  {stage === "extracting" ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Running…
                    </>
                  ) : (
                    <>
                      <ArrowRight className="h-3 w-3" />
                      Run extraction
                    </>
                  )}
                </button>
                <button
                  onClick={saveAsTemplate}
                  disabled={savedId !== null}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-[var(--color-panel)] disabled:opacity-50"
                >
                  <Save className="h-3 w-3" />
                  {savedId ? "Saved ✓" : "Save template"}
                </button>
                <Link
                  href={`/pick?url=${encodeURIComponent(/^https?:\/\//i.test(url) ? url : `https://${url}`)}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-zinc-300 hover:bg-[var(--color-panel)]"
                >
                  <ExternalLink className="h-3 w-3" />
                  Refine in picker
                </Link>
              </div>
            </div>
            <div className="space-y-1.5">
              {template.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-black/30 px-3 py-2 font-mono text-xs"
                >
                  <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 font-semibold text-emerald-300">
                    {f.label}
                  </span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                    {f.kind || "text"}
                  </span>
                  <span className="truncate text-[var(--color-muted)]">{f.selector}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/10 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Extracted data
              </h2>
              <CopyButton text={JSON.stringify(results.fields, null, 2)} />
            </div>
            <pre className="max-h-[400px] overflow-auto rounded-md border border-[var(--color-border)] bg-black/40 p-3 font-mono text-xs">
              {JSON.stringify(results.fields, null, 2)}
            </pre>
            {Object.keys(results.errors || {}).length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-amber-400">
                  {Object.keys(results.errors).length} field error(s)
                </summary>
                <pre className="mt-2 rounded-md bg-amber-950/40 p-3 text-xs text-amber-200">
                  {JSON.stringify(results.errors, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}

        <div className="mt-12 text-center text-xs text-[var(--color-muted)]">
          Each generation counts as 1 scrape against your{" "}
          <Link href="/settings/usage" className="text-[var(--color-accent)] hover:underline">
            monthly quota
          </Link>
          . Default provider is Groq (free) — admins can swap to any OpenAI-compatible LLM.
        </div>
      </div>
    </main>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function doCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable in some contexts
    }
  }
  return (
    <button
      onClick={doCopy}
      className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-zinc-300 hover:bg-[var(--color-panel)]"
    >
      <Copy className="h-3 w-3" />
      {copied ? "Copied" : "Copy JSON"}
    </button>
  );
}
