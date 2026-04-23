import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { DetectedElement } from "./api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncate(s: string, n = 40) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Strip :nth-of-type(N) anchors AND UUID-like #id anchors from a CSS
 * selector. Two elements share the same "list pattern" if their stripped
 * selectors are identical — that's our heuristic for sibling list items.
 *
 * UUID stripping is critical for Amazon (and SPAs in general): Amazon
 * puts a fresh UUID id on every product container, so every product's
 * selector is rooted at a different random string. Without stripping,
 * sibling comparison would always return 1 even when 16 near-identical
 * products exist.
 *
 * Runs defensively client-side even though the backend now avoids
 * emitting UUID anchors — if an older snapshot is loaded from a saved
 * template, we still want to catch its siblings.
 */
const UUID_ANCHOR_RE = /#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HEX_ANCHOR_RE = /#[0-9a-f-]{16,}(?=\s|>|\.|:|$)/gi;

export function normalizeListSelector(css: string): string {
  return css
    .replace(/:nth-of-type\(\d+\)/g, "")
    .replace(UUID_ANCHOR_RE, "")
    .replace(LONG_HEX_ANCHOR_RE, "")
    // clean up orphaned combinators left behind after stripping anchors
    .replace(/\s*>\s*>\s*/g, " > ")
    .replace(/\s+>\s+/g, " > ")
    .replace(/^\s*>\s*/, "")
    .trim();
}

/**
 * Find every collected element that lives in the same list as `clicked`.
 * Returns all matches including `clicked` itself. If the element has no
 * siblings, returns just `[clicked]`.
 */
export function findSiblings(
  clicked: DetectedElement,
  all: DetectedElement[]
): DetectedElement[] {
  const pattern = normalizeListSelector(clicked.css);
  return all.filter((el) => normalizeListSelector(el.css) === pattern);
}

/**
 * Split a stored selector into its normalized-pattern components. Handles
 * the comma-union format we use for multi-anchor list fields
 * (`"a > b, c > d"` → `["a > b", "c > d"]`).
 */
export function selectorPatterns(selector: string): string[] {
  return selector
    .split(/,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Find every element matching ANY of the given patterns. Used when a
 * list field has been extended via shift-click to catch sibling items
 * that auto-detection missed (Amazon product variants, badged items, etc.).
 */
export function findByPatterns(
  patterns: string[],
  all: DetectedElement[]
): DetectedElement[] {
  const set = new Set(patterns);
  return all.filter((el) => set.has(normalizeListSelector(el.css)));
}

export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const keys = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>())
  );
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = keys.join(",");
  const body = rows.map((r) => keys.map((k) => escape(r[k])).join(",")).join("\n");
  return header + "\n" + body;
}
