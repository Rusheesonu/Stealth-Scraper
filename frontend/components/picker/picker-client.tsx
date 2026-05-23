"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Layers, Loader2, Play, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Brand } from "@/components/brand";
import { PageShell } from "@/components/nav";
import { UrlForm } from "@/components/url-form";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Badge, Kbd } from "@/components/ui/badge";
import { LabelModal } from "@/components/picker/label-modal";
import { ManualFieldModal } from "@/components/picker/manual-field-modal";
import { Modal } from "@/components/motion-primitives";
import { SnapshotCanvas } from "@/components/picker/snapshot-canvas";
import { FieldSidebar } from "@/components/picker/field-sidebar";
import { ResultsPanel } from "@/components/picker/results-panel";
import { BatchModal } from "@/components/picker/batch-modal";
import { FieldDetailDrawer } from "@/components/picker/field-detail";
import { MobileFallback } from "@/components/picker/mobile-fallback";
import { PlanLimitText } from "@/components/plan-limit-text";
import { downloadBlob, toCsv } from "@/lib/utils";
import {
  api,
  type DetectedElement,
  type ExtractResponse,
  type SnapshotResponse,
  type TemplateField,
} from "@/lib/api";
import {
  computeListSelector,
  findByPatterns,
  findSiblings,
  normalizeListSelector,
  selectorPatterns,
} from "@/lib/utils";

export type PickedField = TemplateField & {
  element_id: number;
  // Primary bbox — the element the user actually clicked. For list fields
  // we also carry every sibling's bbox so the overlay can show them all.
  bbox: { x: number; y: number; w: number; h: number };
  list_bboxes?: { x: number; y: number; w: number; h: number }[];
};

const COLORS = [
  "#10b981", // emerald
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#ec4899", // pink
  "#a855f7", // purple
  "#ef4444", // red
  "#14b8a6", // teal
  "#f97316", // orange
];

export function PickerClient() {
  // Touch-primary devices can't drive the picker — click + drag is the
  // core interaction. Detect via the `(pointer: coarse)` media query
  // (covers iOS, Android, most tablets) and render the friendly mobile
  // fallback instead of a broken picker. Detection happens client-side
  // so SSR doesn't ship the wrong tree.
  //
  // We start as `null` (unknown), then resolve on mount. During that
  // brief window we render nothing visible — keeps the shell from
  // flashing a desktop layout that immediately swaps to mobile.
  const [isCoarsePointer, setIsCoarsePointer] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      setIsCoarsePointer(false);
      return;
    }
    const mq = window.matchMedia("(pointer: coarse)");
    setIsCoarsePointer(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsCoarsePointer(e.matches);
    // addEventListener available on modern Safari; older Safari only
    // exposes addListener. Cover both.
    if ("addEventListener" in mq) mq.addEventListener("change", handler);
    else (mq as MediaQueryList).addListener(handler);
    return () => {
      if ("removeEventListener" in mq) mq.removeEventListener("change", handler);
      else (mq as MediaQueryList).removeListener(handler);
    };
  }, []);

  const router = useRouter();
  const search = useSearchParams();
  const url = search.get("url") ?? "";

  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<PickedField[]>([]);
  const [pending, setPending] = useState<DetectedElement | null>(null);
  const [results, setResults] = useState<ExtractResponse | null>(null);
  const [batchResults, setBatchResults] = useState<{ url: string; data: ExtractResponse }[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [targetUrl, setTargetUrl] = useState<string>("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [crossHostPrompt, setCrossHostPrompt] = useState<{
    nextUrl: string;
    currentHost: string;
    nextHost: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Which field is open in the detail drawer? null = closed. */
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  /** Indices of fields that came from the AI handoff — fade an accent ring
   *  for the first few seconds so the user can see what was prefilled. */
  const [aiPrefillIdxs, setAiPrefillIdxs] = useState<Set<number>>(new Set());
  // Track the last URL we kicked a snapshot for. Using a ref instead of a
  // boolean lets us tell apart "remount with same url" (skip) from "user
  // navigated to a new url within the same mount" (refetch + reset state).
  const lastLoadedUrl = useRef<string>("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.snapshot(url);
      setSnapshot(res);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [url]);

  // Trigger a snapshot whenever the URL changes (including when the user
  // submits the URL form on the empty state — same component, new query).
  // Resets all picker state so old fields/results don't bleed into the
  // new page.
  useEffect(() => {
    if (!url) {
      lastLoadedUrl.current = "";
      return;
    }
    if (lastLoadedUrl.current === url) return;
    lastLoadedUrl.current = url;
    setSnapshot(null);
    setFields([]);
    setResults(null);
    setBatchResults(null);
    setSavedId(null);
    setLoadError(null);
    setTargetUrl(url);
    void load();
  }, [url, load]);

  /** AI → Picker handoff. When the AI-extract page sends the user here
   *  with ?prefill=ai, we read the generated template from localStorage,
   *  drop it in as fields, and clear the storage so a refresh doesn't
   *  re-add them. localStorage (not URL params) avoids 8KB URL bloat. */
  useEffect(() => {
    if (search.get("prefill") !== "ai") return;
    if (!snapshot) return; // wait for the snapshot so we can compute bboxes
    try {
      const raw = localStorage.getItem("picker_ai_prefill");
      if (!raw) return;
      const payload: { url: string; fields: TemplateField[] } = JSON.parse(raw);
      // Cheap guard: don't apply if the URL doesn't match what they came
      // from (user navigated elsewhere between handoff and arrival).
      if (payload.url && payload.url !== url) {
        localStorage.removeItem("picker_ai_prefill");
        return;
      }
      // Map AI template fields onto PickedField shape. AI fields don't
      // know about specific DOM elements, so element_id/bbox are 0/empty.
      // The detail drawer + "Run extract" still work — they query the
      // snapshot by selector at extract time.
      const prefilled: PickedField[] = payload.fields.map((f) => ({
        ...f,
        element_id: -1,
        bbox: { x: 0, y: 0, w: 0, h: 0 },
      }));
      setFields(prefilled);
      setAiPrefillIdxs(new Set(prefilled.map((_, i) => i)));
      localStorage.removeItem("picker_ai_prefill");
      flashToast(`Loaded ${prefilled.length} AI-generated field${prefilled.length === 1 ? "" : "s"} — review, edit, or delete in the sidebar.`);
      // Fade the prefill accent after 6s
      setTimeout(() => setAiPrefillIdxs(new Set()), 6000);
    } catch {
      // bad payload — just ignore
      localStorage.removeItem("picker_ai_prefill");
    }
    // Intentionally only firing when snapshot becomes ready (or url changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, url]);

  const colorForIndex = useCallback((i: number) => COLORS[i % COLORS.length], []);

  const onElementClick = useCallback(
    (el: DetectedElement, modifiers: { shiftKey: boolean }) => {
      // Shift-click extends the most-recently-added list field — lets the
      // user manually "teach" the selector about sibling items that auto-
      // detection missed (Amazon's sponsored/Best Seller variants with
      // slightly different DOM paths).
      if (modifiers.shiftKey && snapshot) {
        const lastListIdx = findLastListIndex(fields);
        if (lastListIdx >= 0) {
          extendListField(lastListIdx, el, snapshot.elements);
          return;
        }
      }
      setPending(el);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, snapshot]
  );

  function findLastListIndex(fieldList: PickedField[]): number {
    for (let i = fieldList.length - 1; i >= 0; i--) {
      if (fieldList[i].kind === "list") return i;
    }
    return -1;
  }

  function extendListField(
    fieldIdx: number,
    el: DetectedElement,
    allElements: DetectedElement[]
  ) {
    const field = fields[fieldIdx];
    // Compute a level-specific pattern for the shift-clicked element so
    // extension respects the same "same visual column" rule the primary
    // selector uses. Falls back to the crude pattern when the clicked
    // element stands alone.
    const newSiblings = findSiblings(el, allElements);
    const newSelector = computeListSelector(el, newSiblings);
    const existing = selectorPatterns(field.selector);
    // Normalize both sides so "already present" works whether existing
    // patterns are level-specific or crude.
    const existingCrude = new Set(existing.map((p) => normalizeListSelector(p)));
    if (existingCrude.has(normalizeListSelector(newSelector))) {
      flashToast(`"${field.label}" already matches this element`);
      return;
    }
    const merged = [...existing, newSelector];
    const siblings = findByPatterns(merged, allElements);
    const updated: PickedField = {
      ...field,
      selector: merged.join(", "),
      list_bboxes: siblings.map((s) => s.bbox),
    };
    setFields((prev) => prev.map((f, i) => (i === fieldIdx ? updated : f)));
    flashToast(
      `"${field.label}" extended — now matches ${siblings.length} items`
    );
  }

  function confirmField(
    chosen: DetectedElement,
    partial: { label: string; kind: TemplateField["kind"]; attr?: string }
  ) {
    // List fields need a selector that targets the right visual column
    // without bleeding into neighbouring columns — computeListSelector
    // strips :nth-of-type only at levels where the visually-aligned
    // siblings disagree, so "Display Size" stays column 1 and doesn't
    // drag in Disk Size / Connectivity / Brand.
    const isList = partial.kind === "list";
    const siblings = isList && snapshot
      ? findSiblings(chosen, snapshot.elements)
      : [chosen];
    const selector = isList
      ? computeListSelector(chosen, siblings)
      : chosen.css;

    const field: PickedField = {
      label: partial.label,
      selector,
      xpath: chosen.xpath,
      kind: partial.kind,
      attr: partial.attr ?? "",
      element_id: chosen.id,
      bbox: chosen.bbox,
      list_bboxes: isList ? siblings.map((s) => s.bbox) : undefined,
    };
    setFields((prev) => [...prev, field]);
    setPending(null);
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  /** Add a field the user typed in (CSS / XPath) rather than clicked on
   *  the snapshot. Stored with `element_id = -2` + empty bbox so the
   *  sidebar can tag it `manual` and the canvas overlay skips it (nothing
   *  to highlight). The backend treats the selector the same as a clicked
   *  field. */
  function addManualField(input: {
    label: string;
    kind: TemplateField["kind"];
    selector: string;
    xpath?: string;
    attr?: string;
  }) {
    const field: PickedField = {
      label: input.label,
      selector: input.selector,
      xpath: input.xpath,
      kind: input.kind,
      attr: input.attr ?? "",
      element_id: -2,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
    };
    setFields((prev) => [...prev, field]);
    setManualOpen(false);
    flashToast(`Added "${input.label}" — manual selector`);
  }

  /** Apply a partial patch to one field — used by the FieldDetailDrawer. */
  function updateField(index: number, patch: Partial<PickedField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  /** Normalised hostname for cross-site comparison. Strips the `www.`
   *  prefix and lower-cases — `URL.hostname` is good enough here, we
   *  don't need PSL accuracy (`amzn.co.uk` vs `amazon.co.uk` is fine
   *  to treat as different). Returns null when the URL is unparsable
   *  so callers can fall back to "definitely different". */
  function normHost(u: string): string | null {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return h.startsWith("www.") ? h.slice(4) : h;
    } catch {
      return null;
    }
  }

  /** Re-snapshot the picker in place for a NEW URL while preserving the
   *  current template fields. The existing url-driven useEffect resets
   *  state on query change, so we bypass it: push the route + manually
   *  call `api.snapshot` and patch state. Fields stay put; the saved
   *  banner clears (a new template will be a new save).
   *
   *  Used after the user submits a URL with the SAME hostname as the
   *  current snapshot, or explicitly picks "Start fresh in this tab"
   *  (in which case `clearFields = true`). */
  async function swapSnapshot(nextUrl: string, opts: { clearFields: boolean }) {
    // Update the route so refreshes / back-button work, but suppress the
    // useEffect's blanket state-reset by marking the URL as already loaded.
    lastLoadedUrl.current = nextUrl;
    router.push(`/pick?url=${encodeURIComponent(nextUrl)}`);
    setSnapshot(null);
    setLoadError(null);
    setSavedId(null);
    setResults(null);
    setBatchResults(null);
    setTargetUrl(nextUrl);
    if (opts.clearFields) setFields([]);
    setLoading(true);
    try {
      const res = await api.snapshot(nextUrl);
      setSnapshot(res);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  /** Handle the user submitting the URL input (Enter key). Decides
   *  between "swap snapshot in place" (same site) and the cross-site
   *  confirm prompt. No-op when the URL didn't actually change. */
  function onUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = targetUrl.trim();
    if (!next || next === url) return;
    const here = normHost(url);
    const there = normHost(next);
    if (here && there && here === there) {
      void swapSnapshot(next, { clearFields: false });
      return;
    }
    // Different host (or unparsable). Ask before we throw away the work
    // they've done on the current site.
    setCrossHostPrompt({
      nextUrl: next,
      currentHost: here ?? url,
      nextHost: there ?? next,
    });
  }

  function templatePayload() {
    return fields.map(({ label, selector, xpath, kind, attr, transforms }) => ({
      label,
      selector,
      xpath,
      kind,
      attr,
      ...(transforms && transforms.length > 0 ? { transforms } : {}),
    }));
  }

  async function runExtract() {
    if (!fields.length) return;
    const runOn = (targetUrl || url).trim();
    if (!runOn) return;
    setExtracting(true);
    setResults(null);
    setBatchResults(null);
    try {
      // Drift-free fast path: if the user is running the saved
      // template against the same URL they just snapshotted (the
      // common case), pass the captured HTML so /extract skips
      // navigation entirely. The selectors run against the exact
      // DOM they were generated from. Different targetUrl → fall
      // back to live navigation (the saved template is being run
      // on a NEW page, fresh snapshot is correct).
      const sameUrl = !targetUrl || targetUrl.trim() === url.trim();
      const expectedHtml = sameUrl ? snapshot?.html : undefined;
      const res = await api.extract(runOn, templatePayload(), { expectedHtml });
      setResults(res);
    } catch (e) {
      setResults({
        url: runOn,
        fields: {},
        errors: { _error: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      setExtracting(false);
    }
  }

  async function runBatch(urls: string[]) {
    if (!fields.length || !urls.length) return;
    setExtracting(true);
    setResults(null);
    setBatchResults([]);
    // For short lists (≤3) we loop client-side so users see each row
    // land. For bigger jobs we call the backend's /extract/batch
    // endpoint — one round-trip instead of N, and the backend can
    // reuse the same tab lifecycle tightly.
    if (urls.length <= 3) {
      const out: { url: string; data: ExtractResponse }[] = [];
      for (const u of urls) {
        try {
          const res = await api.extract(u, templatePayload());
          out.push({ url: u, data: res });
        } catch (e) {
          out.push({
            url: u,
            data: {
              url: u,
              fields: {},
              errors: { _error: e instanceof Error ? e.message : String(e) },
            },
          });
        }
        setBatchResults([...out]);
      }
    } else {
      try {
        const res = await api.extractBatch(urls, templatePayload());
        setBatchResults(res.results);
      } catch (e) {
        setBatchResults([
          {
            url: urls[0],
            data: {
              url: urls[0],
              fields: {},
              errors: { _error: e instanceof Error ? e.message : String(e) },
            },
          },
        ]);
      }
    }
    setExtracting(false);
  }

  async function saveTemplate(name: string) {
    if (!fields.length) return;
    setSaving(true);
    try {
      const res = await api.createTemplate({
        name,
        source_url: url,
        fields: fields.map(({ label, selector, xpath, kind, attr }) => ({
          label,
          selector,
          xpath,
          kind,
          attr,
        })),
      });
      setSavedId(res.id);
    } catch (e) {
      flashToast("Save failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  const overlayFields = useMemo(
    () =>
      fields.flatMap((f, i) => {
        const color = colorForIndex(i);
        // List fields paint every sibling with a lighter variant so the
        // user can see at a glance how many items the selector catches.
        if (f.list_bboxes && f.list_bboxes.length > 1) {
          return f.list_bboxes.map((b, idx) => ({
            bbox: b,
            label: idx === 0 ? `${f.label} (${f.list_bboxes!.length})` : "",
            color,
            faded: idx > 0,
          }));
        }
        // Skip fields with no real bbox (AI-prefilled, manually-typed
        // selectors). The sidebar still lists them, but there's nothing
        // to highlight on the snapshot — and a 0×0 overlay would pin a
        // stray label at the top-left.
        if (!f.bbox || (f.bbox.w === 0 && f.bbox.h === 0)) return [];
        return [{ bbox: f.bbox, label: f.label, color, faded: false }];
      }),
    [fields, colorForIndex]
  );

  // Coarse pointer detected → render the mobile fallback before any
  // picker chrome mounts. Even though snapshot-canvas is pointer-event
  // based now and works on touch in theory, drag-select on a phone
  // screen is bad UX — the affordance is so different that we'd rather
  // capture intent + push to the demo than ship a half-working flow.
  if (isCoarsePointer === true) {
    return <MobileFallback />;
  }
  // Detection pending — render nothing rather than flash desktop layout
  // on mobile. Resolves on first useEffect tick (<16ms).
  if (isCoarsePointer === null) {
    return null;
  }

  if (!url) {
    return (
      <PageShell maxWidth="max-w-2xl">
        <div className="py-16 sm:py-24">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
            Picker
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[var(--color-fg-strong)]">
            Snapshot a URL to start
          </h1>
          <p className="mt-2 max-w-md text-[14px] leading-[1.55] text-[var(--color-fg-muted)]">
            Paste any URL. We&apos;ll load it in a real browser, take a screenshot,
            then you click on the fields you want to extract.
          </p>

          <div className="mt-8">
            <UrlForm autoFocus />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
            <span className="text-[var(--color-fg-subdued)]">Try one:</span>
            {[
              { url: "https://news.ycombinator.com", label: "news.ycombinator.com" },
              { url: "https://quotes.toscrape.com",  label: "quotes.toscrape.com" },
              { url: "https://books.toscrape.com",   label: "books.toscrape.com" },
            ].map((t) => (
              <Link
                key={t.url}
                href={`/pick?url=${encodeURIComponent(t.url)}`}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--color-fg-muted)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-fg)]"
              >
                {t.label}
              </Link>
            ))}
          </div>

          <div className="mt-10 border-t border-[var(--color-border)] pt-6 text-[13px] text-[var(--color-fg-muted)]">
            Or open a{" "}
            <Link href="/templates" className="text-[var(--color-accent)] hover:underline">
              saved template
            </Link>
            {" · "}
            <Link href="/ai-extract" className="text-[var(--color-accent)] hover:underline">
              try AI extract
            </Link>
            {" · "}
            <Link href="/marketplace" className="text-[var(--color-accent)] hover:underline">
              browse the marketplace
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      {/* Picker top bar — translucent blur, same chrome family as the
          marketing nav. Keeps the picker visually part of the product. */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-blur-bar px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition-[border-color,background,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-fg)]"
            aria-label="Back to home"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { lastLoadedUrl.current = ""; setSnapshot(null); void load(); }}
            disabled={loading || !url}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition-[border-color,background,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Reload snapshot"
            title="Reload snapshot (same URL — useful when the page didn't fully load)"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Brand />
          {snapshot ? (
            <Badge tone="muted" size="sm">
              <span className="font-mono">{snapshot.element_count}</span> elements
            </Badge>
          ) : null}
        </div>

        {/* URL bar — editable. Submitting (Enter) re-snapshots the picker
            on the new URL. Same hostname → swap in place, keep fields.
            Different hostname → confirm dialog (selectors won't transfer). */}
        <form
          onSubmit={onUrlSubmit}
          className="flex flex-1 items-center gap-2 md:max-w-2xl"
        >
          <div className="hidden font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)] md:block whitespace-nowrap">
            URL
          </div>
          <div className="relative flex-1">
            <Input
              mono
              size="sm"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={url}
              className="pr-8"
              spellCheck={false}
              aria-label="Snapshot URL — edit and press Enter to load a different page"
            />
            {targetUrl && targetUrl !== url && (
              <button
                type="button"
                onClick={() => setTargetUrl(url)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-fg-muted)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)]"
                title="Reset to snapshot URL"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </div>
          {/* Hidden submit — Enter on the input still triggers onUrlSubmit. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>

        <div className="flex items-center gap-1.5">
          <Button
            onClick={() => setBatchOpen(true)}
            disabled={!fields.length || extracting}
            size="sm"
            variant="secondary"
          >
            <Layers className="h-3.5 w-3.5" />
            Batch
          </Button>
          <Button
            onClick={runExtract}
            disabled={!fields.length || extracting || !targetUrl.trim()}
            size="sm"
            variant="primary"
          >
            {extracting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run extract
          </Button>
        </div>
      </header>

      {/* Warning strip when the URL input differs from the snapshot. Enter
          re-snapshots; Run extract uses whatever's in the box. */}
      {targetUrl && targetUrl !== url && (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-b border-[color:var(--color-warning)]/25 bg-[var(--color-warning-soft)] px-4 py-1.5">
          <span className="font-mono text-[11px] text-[var(--color-fg)]">
            ⚠ URL differs from the current snapshot.
          </span>
          <span className="text-[11px] text-[var(--color-fg-muted)]">
            Press <Kbd>↵</Kbd> to re-snapshot, or Run extract to test selectors here.
          </span>
        </div>
      )}

      <div className="relative flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-auto bg-[var(--color-ink-1)] p-6">
          {/* Jobs J3 — when there are no fields yet, the canvas gets the
              FULL width and a focused floating instruction pill appears
              over the snapshot. Sidebar slides in only once the user
              picks their first field. Cleaner first-impression, better
              demo videos, less cognitive load for first-time users. */}
          {snapshot && fields.length === 0 && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: 0.5, ease: [0.32, 0.72, 0, 1] }}
              className="fixed bottom-8 left-1/2 z-30 -translate-x-1/2"
            >
              <div
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] text-white shadow-[var(--shadow-popover)]"
                style={{
                  background: "color-mix(in srgb, var(--color-ink-9) 92%, transparent)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                }}
              >
                <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
                <span className="text-white/90">Click any element on the page to add it as a field</span>
                <span className="text-white/50">·</span>
                <span className="text-white/55">drag to box-select</span>
                <span className="text-white/50">·</span>
                <button
                  type="button"
                  onClick={() => setManualOpen(true)}
                  className="text-white/85 underline-offset-2 hover:text-white hover:underline"
                >
                  type a selector
                </button>
              </div>
            </motion.div>
          )}
          {loading && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--color-fg-muted)]">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[14px]">Loading snapshot</span>
              </div>
              <div className="font-mono text-[11px] text-[var(--color-fg-subdued)]">
                first load can take 10–20s (warming the browser)
              </div>
            </div>
          )}
          {loadError && (() => {
            const lower = loadError.toLowerCase();
            const isPlanLimit =
              lower.includes("plan limit") ||
              lower.includes("scrapes this month") ||
              lower.includes("/pricing");
            return (
              <div className="mx-auto max-w-lg rounded-xl border border-[color:var(--color-danger)]/30 bg-[var(--color-danger-soft)] p-5">
                <div className="mb-1 text-[14px] font-semibold text-[var(--color-fg-strong)]">
                  {isPlanLimit ? "You're out of scrapes this month" : "Snapshot failed"}
                </div>
                <PlanLimitText
                  text={loadError}
                  className="mb-4 block text-[13px] leading-[1.55] text-[var(--color-fg-muted)]"
                />
                <div className="flex flex-wrap items-center gap-2">
                  {isPlanLimit && (
                    <Link
                      href="/pricing"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--color-fg-strong)] px-3 text-[13px] font-medium text-[var(--color-bg)] hover:bg-[var(--color-fg-display)]"
                    >
                      See pricing
                    </Link>
                  )}
                  <Button variant="secondary" size="sm" onClick={load}>
                    Try again
                  </Button>
                </div>
              </div>
            );
          })()}
          {snapshot && (
            <SnapshotCanvas
              snapshot={snapshot}
              onElementClick={onElementClick}
              pickedFields={overlayFields}
            />
          )}
        </main>

        {/* Sidebar slides in from the right the moment a first field is
            added (Jobs J3 simplification). Until then the canvas owns the
            full width. AnimatePresence handles enter/exit cleanly. */}
        <AnimatePresence>
          {fields.length > 0 && (
            <motion.div
              key="field-sidebar"
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
              className="h-full"
            >
              <FieldSidebar
                fields={fields}
                onRemove={removeField}
                onSave={saveTemplate}
                saving={saving}
                savedId={savedId}
                colorForIndex={colorForIndex}
                onSelectField={(i) => setDetailIdx(i)}
                highlightIdxs={aiPrefillIdxs}
                onAddManual={() => setManualOpen(true)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {pending && (
        <LabelModal
          element={pending}
          allElements={snapshot?.elements ?? [pending]}
          onCancel={() => setPending(null)}
          onConfirm={confirmField}
          existingLabels={fields.map((f) => f.label)}
        />
      )}

      {manualOpen && (
        <ManualFieldModal
          existingLabels={fields.map((f) => f.label)}
          onCancel={() => setManualOpen(false)}
          onConfirm={addManualField}
        />
      )}

      {crossHostPrompt && (
        <CrossHostPrompt
          currentHost={crossHostPrompt.currentHost}
          nextHost={crossHostPrompt.nextHost}
          nextUrl={crossHostPrompt.nextUrl}
          onOpenInNewTab={() => {
            window.open(
              `/pick?url=${encodeURIComponent(crossHostPrompt.nextUrl)}`,
              "_blank",
              "noopener,noreferrer",
            );
            setCrossHostPrompt(null);
            // Restore the URL bar so the current tab visibly didn't change.
            setTargetUrl(url);
          }}
          onStartFresh={() => {
            const next = crossHostPrompt.nextUrl;
            setCrossHostPrompt(null);
            void swapSnapshot(next, { clearFields: true });
          }}
          onCancel={() => {
            // Restore URL input to the previous (snapshot) value.
            setTargetUrl(url);
            setCrossHostPrompt(null);
          }}
        />
      )}

      {/* Per-field detail drawer — opens on row click. Shows what matched,
          lets the user edit selector/xpath/kind, and configure a transform
          pipeline ("Python one-liner" feel) to clean the raw value. */}
      {detailIdx !== null && fields[detailIdx] && (
        <FieldDetailDrawer
          field={fields[detailIdx]}
          index={detailIdx}
          lastResults={results}
          onClose={() => setDetailIdx(null)}
          onChange={(patch) => updateField(detailIdx, patch)}
          onTestSingle={async (draft) => {
            // Run extraction with just this one field. Cheap way to verify
            // the selector + transforms before committing changes.
            try {
              const res = await api.extract(targetUrl || url, [{
                label: draft.label,
                selector: draft.selector,
                xpath: draft.xpath,
                kind: draft.kind,
                attr: draft.attr,
                transforms: draft.transforms,
              }]);
              return res.fields?.[draft.label];
            } catch {
              return null;
            }
          }}
        />
      )}

      {results && (
        <ResultsPanel
          results={results}
          onClose={() => setResults(null)}
          url={targetUrl || url}
        />
      )}

      {batchOpen && (
        <BatchModal
          defaultUrl={url}
          onCancel={() => setBatchOpen(false)}
          onRun={async (urls) => {
            setBatchOpen(false);
            await runBatch(urls);
          }}
        />
      )}

      {batchResults && (
        <BatchResultsPanel
          results={batchResults}
          running={extracting}
          onClose={() => setBatchResults(null)}
        />
      )}

      {/* Toast — Apple-style floating pill. Translucent dark surface
          so it reads against both light page chrome and screenshot bg. */}
      {toast && (
        <div
          className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 font-mono text-[13px] text-white shadow-[var(--shadow-popover)]"
          style={{
            background: "color-mix(in srgb, var(--color-ink-9) 92%, transparent)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Cross-hostname URL prompt — the user typed a URL on a different site
// than the current snapshot. Their CSS selectors won't transfer (Amazon's
// `.a-price-whole` is nothing on Target), so we ask before throwing work
// away. Three lanes: open the new URL in a NEW tab (keeps current work),
// start fresh in THIS tab (clears fields, re-snapshots), or cancel.
// ─────────────────────────────────────────────────────────────────────────

function CrossHostPrompt({
  currentHost,
  nextHost,
  nextUrl,
  onOpenInNewTab,
  onStartFresh,
  onCancel,
}: {
  currentHost: string;
  nextHost: string;
  nextUrl: string;
  onOpenInNewTab: () => void;
  onStartFresh: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={true} onClose={onCancel} className="max-w-md">
      <div className="px-5 pt-5 pb-2">
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[var(--color-fg-strong)]">
          Switch to a different site?
        </h2>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">
          This template was built for{" "}
          <span className="font-mono text-[var(--color-fg)]">{currentHost}</span>.
          Its selectors probably won&apos;t match{" "}
          <span className="font-mono text-[var(--color-fg)]">{nextHost}</span> —
          different sites use different HTML.
        </p>
        <div className="mt-3 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-ink-1)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
          {nextUrl}
        </div>
      </div>

      <div className="px-5 pb-5 pt-4">
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="md" onClick={onOpenInNewTab} className="w-full justify-center">
            Open in new tab
          </Button>
          <Button variant="secondary" size="md" onClick={onStartFresh} className="w-full justify-center">
            Start fresh in this tab
          </Button>
          <Button variant="ghost" size="md" onClick={onCancel} className="w-full justify-center">
            Cancel
          </Button>
        </div>
        <p className="mt-3 text-[11px] leading-[1.5] text-[var(--color-fg-muted)]">
          New tab keeps your current picks safe. Start fresh clears them and snapshots the new URL.
        </p>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Batch results drawer — kept inline so we don't spin up a separate file
// for this small surface. Mirrors ResultsPanel's styling.
// ─────────────────────────────────────────────────────────────────────────

/**
 * FieldResult envelope unwrap — same shape as results-panel.tsx's
 * `unwrapFields`. Every /extract response now returns FieldResult per
 * field — `{value, source, confidence, selector_used, reason_if_null}`
 * instead of a bare value. The CSV row / JSON export / inline preview
 * below would otherwise stringify each envelope as "[object Object]".
 * Local copy to keep this file self-contained — keep in sync with
 * results-panel.tsx::unwrapFields if either changes.
 */
type BatchEnvelope = { value: unknown };
function unwrapBatchFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && "value" in (v as object)) {
      out[k] = (v as BatchEnvelope).value;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function BatchResultsPanel({
  results,
  running,
  onClose,
}: {
  results: { url: string; data: ExtractResponse }[];
  running: boolean;
  onClose: () => void;
}) {
  const rows = useMemo(() => {
    // One row per URL. If any field is a list, collapse to "v1 | v2 | …"
    // so a single CSV line captures the data without an extra pivot.
    return results.map(({ url, data }) => {
      const row: Record<string, unknown> = { url };
      const flat = unwrapBatchFields(data.fields as Record<string, unknown>);
      for (const [k, v] of Object.entries(flat)) {
        row[k] = Array.isArray(v) ? v.join(" | ") : v;
      }
      return row;
    });
  }, [results]);

  const jsonStr = useMemo(
    () =>
      JSON.stringify(
        results.map(({ url, data }) => ({
          url,
          ...unwrapBatchFields(data.fields as Record<string, unknown>),
        })),
        null,
        2
      ),
    [results]
  );

  function exportCsv() {
    const csv = toCsv(rows);
    downloadBlob(csv, "batch-extract.csv", "text/csv");
  }

  function exportJson() {
    downloadBlob(jsonStr, "batch-extract.json", "application/json");
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-ink-9)_32%,transparent)]" />
      <div
        className="relative flex h-full w-full max-w-3xl flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)] shadow-[var(--shadow-modal)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <Badge tone={running ? "info" : "success"} size="sm">
                {running ? "Running" : "Complete"}
              </Badge>
              <Badge tone="muted" size="sm">
                {results.length} URL{results.length === 1 ? "" : "s"}
              </Badge>
              {running && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-fg-muted)]" />}
            </div>
            <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--color-fg-strong)]">
              Batch extract
            </h2>
            <p className="mt-0.5 text-[13px] text-[var(--color-fg-muted)]">
              {running ? "Results land as each page finishes." : "All URLs processed."}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={exportJson}>
              <Download className="h-3 w-3" /> JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={exportCsv}>
              <Download className="h-3 w-3" /> CSV
            </Button>
            <IconButton
              onClick={onClose}
              size="sm"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </header>

        <div className="flex-1 overflow-auto bg-[var(--color-ink-1)] p-5">
          {results.length === 0 ? (
            <div className="flex items-center gap-2 text-[13px] text-[var(--color-fg-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Waiting for the first result…
            </div>
          ) : (
            <div className="space-y-2.5">
              {results.map(({ url, data }, i) => {
                const errCount = Object.keys(data.errors || {}).length;
                return (
                  <div
                    key={i}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
                        {url}
                      </div>
                      <Badge tone={errCount ? "danger" : "success"} size="xs">
                        {errCount ? `${errCount} errors` : "ok"}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      {Object.entries(unwrapBatchFields(data.fields as Record<string, unknown>)).map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-[13px]">
                          <span className="shrink-0 font-mono text-[11px] font-semibold text-[var(--color-accent)]">
                            {k}
                          </span>
                          <span className="truncate font-mono text-[11px] text-[var(--color-fg)]">
                            {Array.isArray(v)
                              ? `[${(v as unknown[]).length}] ${(v as unknown[]).slice(0, 3).map(String).join(" · ")}${
                                  (v as unknown[]).length > 3 ? " …" : ""
                                }`
                              : v == null
                              ? "null"
                              : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
