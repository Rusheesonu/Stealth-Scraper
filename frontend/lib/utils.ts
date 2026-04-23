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
 * Crude "structural" selector: drop every :nth-of-type + UUID anchor so
 * two DOM elements with the same tag/class path compare equal. This is
 * the FIRST pass of sibling detection — it'll happily return everything
 * structurally similar (e.g. all 64 cells of a 4-column spec table on
 * Amazon). findSiblings() then narrows that pool by bbox column, and
 * computeListSelector() produces a stored selector that keeps only the
 * nth-of-type anchors the siblings actually agree on.
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
 * Find every collected element that looks like a sibling of `clicked`.
 *
 * Two-phase filter:
 *   1. Structural match — same crude pattern (all nth-of-type stripped).
 *      On Amazon's iPad search this returns 16 for a title click, 64
 *      for a "Display Size" click (16 products × 4 spec columns).
 *   2. Visual-column filter — keep only structural matches whose bbox
 *      starts at roughly the same x as `clicked`. This collapses the
 *      64 to 16: only cells actually in the Display Size column survive.
 *
 * Falls back to the structural set if column filtering would cut
 * everything (e.g. when clicked bbox is off-screen or degenerate).
 */
const COLUMN_X_TOLERANCE_PX = 24;

export function findSiblings(
  clicked: DetectedElement,
  all: DetectedElement[]
): DetectedElement[] {
  const pattern = normalizeListSelector(clicked.css);
  const structural = all.filter((el) => normalizeListSelector(el.css) === pattern);
  if (structural.length <= 1) return structural;
  const byColumn = structural.filter(
    (el) => Math.abs(el.bbox.x - clicked.bbox.x) <= COLUMN_X_TOLERANCE_PX
  );
  return byColumn.length >= 1 ? byColumn : structural;
}

/**
 * Produce the selector to STORE for a list field. Walks the clicked
 * element's selector level-by-level: at each `:nth-of-type(N)` anchor,
 * strip it only if the bbox-filtered siblings disagree on N. Levels
 * where every sibling has the same N (e.g. "column 1 of the spec
 * table") keep the anchor so the selector still targets that column.
 *
 * Reduces to findSiblings' crude full-strip when siblings <= 1.
 */
export function computeListSelector(
  clicked: DetectedElement,
  siblings: DetectedElement[]
): string {
  if (siblings.length < 2) return normalizeListSelector(clicked.css);
  const clickedParts = splitSelectorSteps(clicked.css);
  const siblingParts = siblings.map((s) => splitSelectorSteps(s.css));

  const out: string[] = [];
  for (let i = 0; i < clickedParts.length; i++) {
    let step = clickedParts[i];
    if (/:nth-of-type\(\d+\)/.test(step)) {
      const values = new Set<string>();
      for (const sp of siblingParts) {
        if (i < sp.length) {
          const m = sp[i].match(/:nth-of-type\((\d+)\)/);
          values.add(m ? m[1] : "∅");
        } else {
          values.add("∅");
        }
      }
      // Siblings disagree at this level → strip the anchor. Agreement
      // means this level is part of "which column/row inside each row".
      if (values.size > 1) {
        step = step.replace(/:nth-of-type\(\d+\)/g, "");
      }
    }
    out.push(step);
  }
  return out
    .join(" > ")
    .replace(UUID_ANCHOR_RE, "")
    .replace(LONG_HEX_ANCHOR_RE, "")
    .replace(/\s*>\s*>\s*/g, " > ")
    .replace(/\s+>\s+/g, " > ")
    .trim();
}

function splitSelectorSteps(css: string): string[] {
  return css
    .trim()
    .split(/\s*>\s*/)
    .filter(Boolean);
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
 *
 * Patterns may be level-specific (computeListSelector output) or crude
 * full-strip — we normalize both sides so mixed specificity still
 * groups equivalently-shaped elements.
 */
export function findByPatterns(
  patterns: string[],
  all: DetectedElement[]
): DetectedElement[] {
  const set = new Set(patterns.map((p) => normalizeListSelector(p)));
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
