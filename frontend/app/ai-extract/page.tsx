"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Sparkles, Loader2, ArrowRight, Save, Copy, ExternalLink, AlertTriangle, Check } from "lucide-react";
import { PageShell } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { api, type TemplateField, type ExtractResponse } from "@/lib/api";

type Stage = "idle" | "generating" | "extracting" | "done" | "error";

/**
 * /extract returns FieldResult-envelope per field —
 *   { value, source, confidence, selector_used, reason_if_null }
 *
 * For the "Extracted JSON" copy/display we show just the bare values —
 * users want clean data they can paste into their app. The full
 * envelope (with confidence + reason_if_null) lives under the expand
 * for power users who want to audit the extractor.
 *
 * Pre-this-fix the headline JSON was the entire envelope object per
 * field, which stringified as `[object Object]` in the UI grid view
 * and made the result look broken.
 */
function unwrapEnvelope(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && "value" in (v as object)) {
      out[k] = (v as { value: unknown }).value;
    } else {
      out[k] = v;
    }
  }
  return out;
}

const EXAMPLES = [
  { url: "https://news.ycombinator.com",   desc: "Get the top 10 stories — title, points, comment count, submitter." },
  { url: "https://quotes.toscrape.com",    desc: "Get every quote, its author, and the tags on it." },
  { url: "https://books.toscrape.com",     desc: "Get every book — title, price, rating, in stock yes/no." },
];

function AiExtractForm() {
  const search = useSearchParams();
  // Pre-fill from query params (hero tab-toggle handoff: ?url=&description=).
  // We use Suspense around this whole component so useSearchParams works at build.
  const [url, setUrl] = useState(() => search.get("url") || "");
  const [description, setDescription] = useState(() => search.get("description") || "");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [template, setTemplate] = useState<TemplateField[] | null>(null);
  const [results, setResults] = useState<ExtractResponse | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  async function generate(e?: React.FormEvent) {
    e?.preventDefault();
    if (!url.trim() || !description.trim()) return;
    setStage("generating");
    setError(""); setTemplate(null); setResults(null); setSavedId(null);
    try {
      const norm = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      const res = await api.assistSchema({ url: norm, description: description.trim() });
      setTemplate(res.template);
      // /assist/schema now returns inline-extracted values from the SAME
      // snapshot it used to generate the schema (May 22 fix for the
      // snapshot-A vs snapshot-B drift bug). If we have those, show them
      // immediately — no need for the user to click Run separately.
      // Subsequent /extract calls still run on a fresh snapshot to
      // surface live data, but the FIRST view always matches the DOM
      // the schema was generated from.
      if (res.sample_envelope && Object.keys(res.sample_envelope).length > 0) {
        setResults({
          url: res.url,
          title: res.title,
          fields: res.sample_envelope,
          errors: {},
        });
      }
      setStage("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Translate common backend errors into user-actionable copy. The
      // backend now emits clean LLMError messages, so most cases just
      // pass through — but we still soften the rare raw cases.
      let userMsg = msg;
      const lower = msg.toLowerCase();
      if (lower.includes("not configured")) {
        userMsg = "AI extract isn't configured yet on this instance. Admin: set LLM_API_KEY (free Groq key at console.groq.com).";
      } else if (lower.includes("rate-limited") || lower.includes("rate limit")) {
        userMsg = "AI is rate-limited right now. Try the visual picker, or wait about a minute.";
      } else if (lower.includes("all configured ai models") || lower.includes("all models")) {
        userMsg = "Our AI models are temporarily unavailable. Use the visual picker meanwhile — it does the same thing, you just click instead of describe.";
      } else if (lower.includes("rejected the api key") || lower.includes("auth")) {
        userMsg = "AI service is misconfigured. Admin: rotate LLM_API_KEY.";
      } else if (lower.includes("timed out")) {
        userMsg = "AI service timed out. Try a smaller page or use the visual picker.";
      }
      setError(userMsg);
      setStage("error");
    }
  }

  async function runExtraction() {
    if (!template) return;
    setStage("extracting"); setResults(null);
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
    setUrl(ex.url); setDescription(ex.desc);
    setStage("idle"); setTemplate(null); setResults(null); setError("");
  }

  // Auto-fire generation when landed here with both URL + description
  // prefilled from the hero tab-toggle (so it feels like one continuous flow,
  // not "now click Generate again"). Runs once on mount only.
  useEffect(() => {
    const hasPrefill = !!(search.get("url") && search.get("description"));
    if (hasPrefill) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBusy = stage === "generating" || stage === "extracting";

  return (
    <PageShell maxWidth="max-w-3xl">
      <div>
        <div className="mb-6">
          <Link
            href="/"
            className="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1.5 text-[13px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
          >
            <ArrowLeft className="h-3 w-3 transition-transform duration-[var(--dur-fast)] group-hover:-translate-x-0.5" />
            Home
          </Link>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          className="mb-10 text-center"
        >
          <Badge tone="accent" className="mb-5"><Sparkles className="h-3 w-3" /> AI extract · alpha</Badge>
          <h1 className="text-[40px] font-semibold leading-[1.08] tracking-[-0.028em] text-[var(--color-fg-strong)]">
            Describe it.<br />Get a scraper.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[14px] text-[var(--color-fg-muted)]">
            Paste a URL, describe what you want in plain English. An LLM
            reads the page and builds the extraction schema in under a second.
          </p>
        </motion.div>

        <form onSubmit={generate} className="space-y-2.5">
          <Input
            mono
            size="lg"
            placeholder="https://news.ycombinator.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isBusy}
            autoFocus
          />
          <Textarea
            placeholder="What do you want to extract? e.g. 'Get the title, price, and rating from each product card.'"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isBusy}
            rows={3}
            maxLength={500}
          />
          <p className="text-[11px] leading-[1.5] text-[var(--color-fg-subdued)]">
            Tip: describe the <strong className="text-[var(--color-fg-muted)]">structure</strong>, not a sorted/filtered answer.
            &quot;Get all products with title, price, discount&quot; works — &quot;the product with the highest discount&quot; doesn&apos;t
            (we extract data, you sort it in code).
          </p>
          <Button
            type="submit"
            variant="accent"
            size="lg"
            disabled={isBusy || !url.trim() || !description.trim()}
            className="w-full"
          >
            {stage === "generating" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Reading page + asking the LLM…</>
            ) : (
              <><Sparkles className="h-4 w-4" /> Generate scraper</>
            )}
          </Button>
        </form>

        {/* Examples */}
        {stage === "idle" && !template && (
          <div className="mt-10">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
              Or try one
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.url}
                  onClick={() => loadExample(ex)}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition-[border-color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]"
                >
                  <div className="mb-1.5 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
                    {ex.url.replace(/^https?:\/\//, "")}
                  </div>
                  <div className="text-[13px] leading-[1.5] text-[var(--color-fg)]">{ex.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              className="mt-6 flex items-start gap-2 rounded-lg border border-[color:var(--color-danger)]/30 bg-[var(--color-danger-soft)] p-3 text-[13px] text-[color:var(--color-danger)]"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="text-[var(--color-fg)]">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Generated template */}
        {template && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
          >
          <Card density="comfortable" className="mt-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Generated schema</div>
                <div className="mt-0.5 text-[14px] font-semibold">{template.length} field{template.length === 1 ? "" : "s"}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={runExtraction} disabled={isBusy} variant="accent" size="sm">
                  {stage === "extracting" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                  Run
                </Button>
                <Button onClick={saveAsTemplate} disabled={savedId !== null} variant="secondary" size="sm">
                  {savedId ? <Check className="h-3 w-3" /> : <Save className="h-3 w-3" />}
                  {savedId ? "Saved" : "Save"}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    // AI → Picker handoff. Stash the generated template in
                    // localStorage (URL params can't carry 8 fields + transforms
                    // without bloating past 8KB), then navigate. The picker
                    // reads + clears localStorage on mount.
                    const norm = /^https?:\/\//i.test(url) ? url : `https://${url}`;
                    try {
                      localStorage.setItem(
                        "picker_ai_prefill",
                        JSON.stringify({ url: norm, fields: template }),
                      );
                    } catch {
                      // localStorage can throw in private mode — fall through;
                      // the picker will just open without prefill, no crash.
                    }
                    window.location.href = `/pick?url=${encodeURIComponent(norm)}&prefill=ai`;
                  }}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 text-[13px] text-[var(--color-fg-muted)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                  title="Open these fields in the visual picker to verify, edit, or add transforms"
                >
                  <ExternalLink className="h-3 w-3" />
                  Edit in picker
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {template.map((f, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.22, delay: i * 0.03, ease: [0.32, 0.72, 0, 1] }}
                  className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5"
                >
                  <Badge tone="accent" size="xs">{f.label}</Badge>
                  <Badge tone="muted" size="xs">{f.kind || "text"}</Badge>
                  <code className="flex-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">{f.selector}</code>
                </motion.div>
              ))}
            </div>
          </Card>
          </motion.div>
        )}

        {/* Results */}
        {results && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
          >
          <Card density="comfortable" className="mt-3 border-[color:var(--color-accent)]/30">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Extracted JSON</div>
              <CopyButton text={JSON.stringify(unwrapEnvelope(results.fields), null, 2)} />
            </div>
            <pre className="max-h-[400px] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-[11px] text-[var(--color-fg)]">
              {JSON.stringify(unwrapEnvelope(results.fields), null, 2)}
            </pre>
            {/* Per-field confidence + reason — the FieldResult envelope.
                Expandable so the headline JSON stays clean but power
                users can audit what the extractor actually thought. */}
            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] font-mono text-[var(--color-fg-muted)]">
                Show extraction details (confidence, reason_if_null)
              </summary>
              <pre className="mt-2 max-h-[300px] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-ink-1)] p-3 font-mono text-[11px] text-[var(--color-fg-muted)]">
                {JSON.stringify(results.fields, null, 2)}
              </pre>
            </details>
            {Object.keys(results.errors || {}).length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[13px] text-[var(--color-warning)]">
                  {Object.keys(results.errors).length} field error(s)
                </summary>
                <pre className="mt-2 rounded-md border border-[color:var(--color-warning)]/30 bg-[var(--color-warning-soft)] p-3 font-mono text-[11px] text-[var(--color-warning)]">
                  {JSON.stringify(results.errors, null, 2)}
                </pre>
              </details>
            )}
          </Card>
          </motion.div>
        )}

        <div className="mt-16 border-t border-[var(--color-border)] pt-6 text-center text-[11px] text-[var(--color-fg-subdued)]">
          Each generation counts as 1 scrape against your{" "}
          <Link href="/settings/usage" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline">
            monthly quota
          </Link>.
        </div>
      </div>
    </PageShell>
  );
}

/**
 * Suspense boundary required by Next.js because the inner component reads
 * useSearchParams() — without it, the page can't pre-render statically.
 * Renders a near-identical skeleton so the boundary swap is invisible.
 */
export default function AiExtractPage() {
  return (
    <Suspense fallback={
      <PageShell maxWidth="max-w-3xl">
        <div className="py-12">
          <div className="mb-6 h-4 w-12 animate-pulse rounded-md bg-[var(--color-ink-2)]" />
          <div className="mb-3 h-8 w-72 animate-pulse rounded-md bg-[var(--color-ink-2)]" />
          <div className="mb-10 h-4 w-96 animate-pulse rounded-md bg-[var(--color-ink-2)]" />
          <div className="h-14 w-full animate-pulse rounded-xl bg-[var(--color-ink-2)]" />
        </div>
      </PageShell>
    }>
      <AiExtractForm />
    </Suspense>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function doCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }
  return (
    <button
      onClick={doCopy}
      className="inline-flex h-7 items-center gap-1 rounded-sm border border-[var(--color-border)] px-2 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
