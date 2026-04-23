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
 * Drop the "which repetition" anchors from a CSS selector so two sibling
 * list items share the same pattern. UUID-like #id anchors also go,
 * since Amazon stamps a random UUID id on every product wrapper.
 *
 * The subtle one: only strip the FIRST (outermost) `:nth-of-type` —
 * that's the "which product" level. Keeping deeper nth-of-type anchors
 * preserves "which column/row inside the product". Stripping everything
 * was the old behaviour and it collapsed 4-column spec tables into a
 * single pattern (Amazon iPad search: display-size selector matched all
 * 16 × 4 = 64 cells instead of the 16 display-size cells specifically).
 *
 * Runs defensively client-side even though the backend now avoids
 * emitting UUID anchors — if an older snapshot is loaded from a saved
 * template, we still want to catch its siblings.
 */
const UUID_ANCHOR_RE = /#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HEX_ANCHOR_RE = /#[0-9a-f-]{16,}(?=\s|>|\.|:|$)/gi;

export function normalizeListSelector(css: string): string {
  let stripped = false;
  const oneStripNth = css.replace(/:nth-of-type\(\d+\)/g, (m) => {
    if (stripped) return m;
    stripped = true;
    return "";
  });
  return oneStripNth
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
 * Walk "up" the DOM as represented in our flat element list: find the
 * smallest detected element whose bbox strictly contains `child`'s bbox.
 * This is the escape hatch when a click lands on a tight inner span
 * (e.g. just the "$319" half of a split "$319.99" price) and the user
 * wants the wrapping element that has both halves.
 *
 * Returns null when no collected ancestor contains the child — e.g. the
 * child is already the outermost thing we captured.
 */
export function findContainingParent(
  child: DetectedElement,
  all: DetectedElement[]
): DetectedElement | null {
  const c = child.bbox;
  const childArea = c.w * c.h;
  let best: DetectedElement | null = null;
  let bestArea = Infinity;
  for (const el of all) {
    if (el.id === child.id) continue;
    const b = el.bbox;
    const area = b.w * b.h;
    // Must strictly contain (with 2px slop) AND be bigger than the child.
    if (
      b.x <= c.x + 2 &&
      b.y <= c.y + 2 &&
      b.x + b.w >= c.x + c.w - 2 &&
      b.y + b.h >= c.y + c.h - 2 &&
      area > childArea &&
      area < bestArea
    ) {
      best = el;
      bestArea = area;
    }
  }
  return best;
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
