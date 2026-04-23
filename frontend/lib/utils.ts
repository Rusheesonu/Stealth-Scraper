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
 * Strip :nth-of-type(N) anchors from a CSS selector. Two elements share
 * the same "list pattern" if their stripped selectors are identical —
 * that's our heuristic for sibling list items. Works for card grids,
 * search results, tables, quote blocks, product tiles, etc.
 */
export function normalizeListSelector(css: string): string {
  return css.replace(/:nth-of-type\(\d+\)/g, "");
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
