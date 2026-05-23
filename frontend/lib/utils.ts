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
 * Crude "structural" selector: drop per-instance anchors so two DOM
 * elements with the same structural shape compare equal. This is the
 * FIRST pass of sibling detection.
 *
 * findSiblings() then narrows that pool by bbox column, and
 * computeListSelector() produces a stored selector that keeps only the
 * nth-of-type anchors the siblings actually agree on.
 *
 * DESIGN — narrow heuristics, safe failure mode:
 *
 * We strip ONLY patterns that are documented deterministic output of
 * specific CSS-in-JS libraries. Earlier versions also caught looser
 * patterns (.Component_hash, ._3xK9j, .card-1234) but those risk
 * stripping real semantic class names ('.menu_item', '.product-card-
 * 2024'). Over-stripping = selector matches nothing = user sees null.
 * Under-stripping = picker doesn't auto-detect siblings = user toggles
 * list mode manually. Picking the safer failure mode.
 *
 * STRIPPED (library-deterministic only):
 *   - :nth-of-type(N), :nth-child(N), :nth-last-of-type(N)
 *   - #uuid (32-hex with 4 dashes)
 *   - #long-hex (16+ contiguous hex chars)
 *   - .css-XXXX — emotion (4+ chars after `css-`)
 *   - .sc-XXXX — styled-components base (4+ chars after `sc-`)
 *   - .jsx-NNNN — Next.js styled-jsx (4+ DIGITS after `jsx-`)
 *   - .Component__XXXX — CSS Modules double-underscore (canonical emit)
 *   - [data-test|data-testid|data-cy|data-qa|data-component|data-id|id]
 *     ATTRIBUTE selectors whose value contains a 2+ digit run
 *
 * KEPT (real semantic classes — preserves user content):
 *   - .product-card, .price, .grid, .flex, single-word descriptive
 *   - .text-blue-500, .bg-gray-100, .h-12 (Tailwind utilities)
 *   - .hidden, .d-none, .lg:hidden (framework conventions — could be
 *     visibility utilities OR semantic class names; we keep them)
 *   - .menu_item, .post_2024 (single underscore — could be semantic)
 *   - .card-2024 (year-tag-like suffix — could be semantic)
 *   - #main, #header (semantic ids without hex/digit runs)
 *
 * @example normalizeListSelector("div.grid > article.card:nth-of-type(3) > h3")
 *   // returns: "div.grid > article.card > h3"
 *
 * @example normalizeListSelector("div.wrapper > div.css-1abc23d > span.text")
 *   // returns: "div.wrapper > div > span.text"
 *
 * @example normalizeListSelector('div[data-testid="card-42"] > h3')
 *   // returns: "div > h3"
 *
 * @example normalizeListSelector("body > main > article.product-card > .price")
 *   // returns: "body > main > article.product-card > .price"  (unchanged — all semantic)
 *
 * @example normalizeListSelector("div.product-card-2024 > h3")
 *   // returns: "div.product-card-2024 > h3"  (KEPT — could be a year tag, not a hash)
 *
 * @example normalizeListSelector("div.menu_item > a")
 *   // returns: "div.menu_item > a"  (KEPT — single underscore could be semantic)
 */
const UUID_ANCHOR_RE = /#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HEX_ANCHOR_RE = /#[0-9a-f-]{16,}(?=\s|>|\.|:|$)/gi;

// CSS-in-JS hashed classes — STRICTLY library-deterministic patterns only.
// Earlier versions matched broader CSS-Module patterns (single-underscore,
// leading-underscore, semantic-name + digit suffix) but those risk
// false-positive on real semantic class names. Over-stripping breaks the
// extracted selector (matches nothing → user sees null); under-stripping
// just means the picker doesn't auto-detect siblings → user sets list
// mode manually. Safer failure mode is keeping the heuristic narrow.
//
// What we still strip (each is the documented public output format of
// a specific CSS-in-JS library, NOT a guess about general patterns):
//   - emotion: .css-XXXX (4+ chars after `css-`)
//   - styled-components: .sc-XXXX (4+ chars after `sc-`)
//   - Next.js styled-jsx: .jsx-NNNN (4+ DIGITS after `jsx-`)
//   - CSS Modules with double underscore: .Component__hash (canonical
//     CSS Modules emit format)
//
// Removed (too risky for false-positive):
//   - .Component_hash5+ (single underscore) — some sites use this as
//     semantic naming (e.g. `.menu_item`)
//   - ._3xK9j (leading underscore) — semantic prefix in some projects
//   - .card-1234 (digit-suffix) — could be a real version-numbered class
const HASHED_CLASS_REGEXES: RegExp[] = [
  // emotion / css-in-js: .css-1abc23d
  /\.css-[a-zA-Z0-9]{4,}(?=[\s>.:[]|$)/g,
  // styled-components base: .sc-aBcDeF
  /\.sc-[a-zA-Z0-9]{4,}(?=[\s>.:[]|$)/g,
  // Next.js styled-jsx: .jsx-1234567890
  /\.jsx-\d{4,}(?=[\s>.:[]|$)/g,
  // CSS Modules with double-underscore: .Component__xyz1Ab
  /\.[a-zA-Z][a-zA-Z0-9-]*__[A-Za-z0-9-]{4,}(?=[\s>.:[]|$)/g,
];

// Attribute selectors whose VALUE contains a digit run (likely per-row
// markers like data-testid="card-42"). Strips the whole [attr=value]
// part — we keep tag and class context.
const HASHED_ATTR_RE =
  /\[(data-test|data-testid|data-cy|data-qa|data-component|data-id|id)([*^$~|]?=)["'][^"']*\d{2,}[^"']*["']\]/g;

export function normalizeListSelector(css: string): string {
  let out = css
    .replace(/:nth-of-type\(\d+\)/g, "")
    .replace(/:nth-child\(\d+\)/g, "")
    .replace(/:nth-last-of-type\(\d+\)/g, "")
    .replace(UUID_ANCHOR_RE, "")
    .replace(LONG_HEX_ANCHOR_RE, "")
    .replace(HASHED_ATTR_RE, "");
  for (const re of HASHED_CLASS_REGEXES) {
    out = out.replace(re, "");
  }
  return out
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
  let joined = out
    .join(" > ")
    .replace(UUID_ANCHOR_RE, "")
    .replace(LONG_HEX_ANCHOR_RE, "")
    .replace(HASHED_ATTR_RE, "");
  // Apply the same hashed-class strips here so the STORED selector
  // also generalizes across sibling cards (not just the structural
  // pattern used for sibling detection).
  for (const re of HASHED_CLASS_REGEXES) {
    joined = joined.replace(re, "");
  }
  return joined
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
