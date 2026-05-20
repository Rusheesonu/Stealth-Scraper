"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DetectedElement, SnapshotResponse } from "@/lib/api";
import { findSiblings } from "@/lib/utils";

type Picked = {
  bbox: { x: number; y: number; w: number; h: number };
  label: string;
  color: string;
  faded?: boolean;
};

type Props = {
  snapshot: SnapshotResponse;
  onElementClick: (el: DetectedElement, modifiers: { shiftKey: boolean }) => void;
  pickedFields: Picked[];
};

// Drag-distance threshold (CSS px) above which a mouse gesture is treated as
// a box-select instead of a click. Below this, tiny mouse wiggles during a
// click still register as clicks rather than accidentally drawing a box.
const DRAG_THRESHOLD = 8;

export function SnapshotCanvas({ snapshot, onElementClick, pickedFields }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(0);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  // Drag-select state — image-coord space, matching bboxes.
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [dragShift, setDragShift] = useState(false);

  // Track shift key so the hover tooltip can tell the user that shift-
  // click will extend their most recent list field rather than opening
  // the label modal. Pure UI affordance — the actual extension logic
  // lives in picker-client.
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.key === "Shift") setShiftHeld(true);
    }
    function up(e: KeyboardEvent) {
      if (e.key === "Shift") setShiftHeld(false);
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const pageWidth = snapshot.page.width || snapshot.viewport.width || 1440;

  // Measure the rendered image width so we can map viewport-space
  // clicks back to the full-page coordinate space of the bboxes.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    function measure() {
      if (!imgRef.current) return;
      const w = imgRef.current.clientWidth;
      if (w > 0) setRenderedWidth(w);
    }

    measure();
    // If the <img>'s cached complete on remount, `complete` is true and
    // load never fires. Handle both paths.
    if (img.complete) {
      // Next frame, after layout has applied the measured width.
      requestAnimationFrame(measure);
    } else {
      img.addEventListener("load", measure);
    }

    const ro = new ResizeObserver(measure);
    ro.observe(img);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      img.removeEventListener("load", measure);
      ro.disconnect();
    };
  }, [snapshot.screenshot]);

  // Fallback scale — before measurement kicks in, treat the image as
  // full-width (so bbox math is at least sensible and clicks register).
  // The displayed width gets corrected on the first measure tick.
  const scale = renderedWidth > 0 ? renderedWidth / pageWidth : 1;

  // Sort elements by bbox area, smallest first — when two elements overlap
  // under the cursor, the inner (smaller) one should win the hover.
  const sorted = useMemo(
    () =>
      [...snapshot.elements].sort(
        (a, b) => a.bbox.w * a.bbox.h - b.bbox.w * b.bbox.h
      ),
    [snapshot.elements]
  );

  function findElementAt(px: number, py: number): DetectedElement | null {
    // px/py in image-coordinate space (not displayed px)
    for (const el of sorted) {
      const { x, y, w, h } = el.bbox;
      if (px >= x && px <= x + w && py >= y && py <= y + h) {
        return el;
      }
    }
    return null;
  }

  /**
   * Pick the best element for a drag rectangle. This is the escape hatch
   * for composite values like Amazon's "$319.99" price, where clicking
   * the dollar amount only grabs the `$319` span and misses the `.99`.
   *
   * Strategy: score every element whose bbox has non-zero intersection
   * with the drag rect by how much of the drag is inside the element AND
   * how much of the element is inside the drag — basically IoU. The best
   * match is the smallest element that still covers most of the drag rect.
   */
  function findElementForRect(rect: {
    x: number;
    y: number;
    w: number;
    h: number;
  }): DetectedElement | null {
    if (rect.w < 2 || rect.h < 2) return null;
    const dragArea = rect.w * rect.h;
    let best: DetectedElement | null = null;
    let bestScore = -1;
    for (const el of snapshot.elements) {
      const ex = el.bbox.x;
      const ey = el.bbox.y;
      const ew = el.bbox.w;
      const eh = el.bbox.h;
      const ix = Math.max(rect.x, ex);
      const iy = Math.max(rect.y, ey);
      const iw = Math.min(rect.x + rect.w, ex + ew) - ix;
      const ih = Math.min(rect.y + rect.h, ey + eh) - iy;
      if (iw <= 0 || ih <= 0) continue;
      const inter = iw * ih;
      const elArea = ew * eh || 1;
      const coverDrag = inter / dragArea; // how much of the drag the element covers
      const coverEl = inter / elArea; // how much of the element is inside the drag
      // Reward elements that COVER the drag rect (so we catch parents of
      // composite children) but penalize elements that are much larger
      // than the drag itself (so we don't grab the whole page container).
      const score = coverDrag * coverDrag * coverEl;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    // If nothing meaningfully overlapped, fall back to whatever sits at
    // the drag centroid.
    if (!best || bestScore < 0.15) {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      return findElementAt(cx, cy);
    }
    return best;
  }

  function toImgCoords(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!imgRef.current) return null;
    const rect = imgRef.current.getBoundingClientRect();
    const effectiveScale = renderedWidth > 0 ? renderedWidth / pageWidth : rect.width / pageWidth;
    if (effectiveScale <= 0) return null;
    return {
      x: (clientX - rect.left) / effectiveScale,
      y: (clientY - rect.top) / effectiveScale,
    };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const p = toImgCoords(e.clientX, e.clientY);
    if (!p) return;
    setDragStart(p);
    setDragEnd(p);
    setDragShift(e.shiftKey);
  }

  function onMouseMove(e: React.MouseEvent) {
    const p = toImgCoords(e.clientX, e.clientY);
    if (!p) return;
    setCursorPos(p);

    if (dragStart) {
      setDragEnd(p);
      // While dragging, suppress the per-element hover highlight so the
      // rectangle is the only visible cue.
      setHoverId(null);
      return;
    }

    const hit = findElementAt(p.x, p.y);
    setHoverId(hit?.id ?? null);
  }

  function onMouseLeave() {
    setHoverId(null);
    setCursorPos(null);
    // If a drag was in-progress, cancel it — avoids ghost rectangles
    // when the mouse leaves the image mid-gesture.
    setDragStart(null);
    setDragEnd(null);
  }

  function onMouseUp(e: React.MouseEvent) {
    const start = dragStart;
    const end = dragEnd;
    setDragStart(null);
    setDragEnd(null);
    if (!start || !end) return;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx * scale, dy * scale);

    if (dist < DRAG_THRESHOLD) {
      // Not a drag — fall through to click semantics using the element
      // under the cursor at mouseup time.
      const hit = findElementAt(end.x, end.y);
      if (hit) onElementClick(hit, { shiftKey: e.shiftKey });
      return;
    }

    const rect = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(dx),
      h: Math.abs(dy),
    };
    const el = findElementForRect(rect);
    if (el) onElementClick(el, { shiftKey: dragShift || e.shiftKey });
  }

  const hoverEl = hoverId != null ? snapshot.elements.find((e) => e.id === hoverId) : null;

  // When hovering over an element that belongs to a repeating pattern,
  // also highlight its siblings with a faint outline — tells the user
  // "click this to grab the whole list" without needing shift-click or
  // a second action.
  const hoverSiblings = useMemo(() => {
    if (!hoverEl) return [];
    const sibs = findSiblings(hoverEl, snapshot.elements);
    return sibs.length > 1 ? sibs.filter((s) => s.id !== hoverEl.id) : [];
  }, [hoverEl, snapshot.elements]);

  // Live drag rectangle in image-coord space; null when no drag in flight.
  const dragRect = useMemo(() => {
    if (!dragStart || !dragEnd) return null;
    const dx = dragEnd.x - dragStart.x;
    const dy = dragEnd.y - dragStart.y;
    if (Math.hypot(dx * scale, dy * scale) < DRAG_THRESHOLD) return null;
    return {
      x: Math.min(dragStart.x, dragEnd.x),
      y: Math.min(dragStart.y, dragEnd.y),
      w: Math.abs(dx),
      h: Math.abs(dy),
    };
  }, [dragStart, dragEnd, scale]);

  const isDragging = dragRect != null;

  return (
    <div
      ref={containerRef}
      className="relative mx-auto max-w-6xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onMouseUp={onMouseUp}
      style={{ cursor: isDragging ? "crosshair" : hoverId != null ? "crosshair" : "default" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={`data:image/png;base64,${snapshot.screenshot}`}
        alt={snapshot.title}
        className="block w-full select-none"
        draggable={false}
      />

      {/* Picked field overlays — list siblings render faded so the
          primary pick still stands out. */}
      {scale > 0 &&
        pickedFields.map((f, i) => (
          <div
            key={i}
            className="pointer-events-none absolute"
            style={{
              left: f.bbox.x * scale,
              top: f.bbox.y * scale,
              width: f.bbox.w * scale,
              height: f.bbox.h * scale,
              border: `${f.faded ? 1 : 2}px ${f.faded ? "dashed" : "solid"} ${f.color}`,
              boxShadow: f.faded
                ? "none"
                : `0 0 0 1px ${f.color}33, inset 0 0 0 1px ${f.color}22`,
              background: f.faded ? `${f.color}0a` : `${f.color}14`,
            }}
          >
            {f.label ? (
              <div
                className="absolute -top-6 left-0 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold text-black"
                style={{ background: f.color }}
              >
                {f.label}
              </div>
            ) : null}
          </div>
        ))}

      {/* Hover highlight */}
      {scale > 0 && hoverEl && !isDragging && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: hoverEl.bbox.x * scale,
            top: hoverEl.bbox.y * scale,
            width: hoverEl.bbox.w * scale,
            height: hoverEl.bbox.h * scale,
            border: "2px dashed #10b981",
            background: "rgba(16,185,129,0.08)",
          }}
        />
      )}

      {/* Sibling preview — shows every item that would be caught by
          list mode if the user clicks. Lighter than the primary hover. */}
      {scale > 0 &&
        !isDragging &&
        hoverSiblings.map((s) => (
          <div
            key={s.id}
            className="pointer-events-none absolute"
            style={{
              left: s.bbox.x * scale,
              top: s.bbox.y * scale,
              width: s.bbox.w * scale,
              height: s.bbox.h * scale,
              border: "1px dashed rgba(16,185,129,0.5)",
              background: "rgba(16,185,129,0.04)",
            }}
          />
        ))}

      {/* Live drag-select rectangle. Amber so it reads as "marquee" and
          doesn't blend with the emerald hover outline. */}
      {scale > 0 && dragRect && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: dragRect.x * scale,
            top: dragRect.y * scale,
            width: dragRect.w * scale,
            height: dragRect.h * scale,
            border: "1.5px dashed #f59e0b",
            background: "rgba(245,158,11,0.12)",
          }}
        />
      )}

      {/* Floating label near cursor — translucent ink-9 (true black-ish) panel
          so it reads over ANY screenshot background. Apple-style tooltip. */}
      {hoverEl && cursorPos && scale > 0 && !isDragging && (
        <div
          className="pointer-events-none absolute max-w-[320px] rounded-lg px-2.5 py-1.5 font-mono text-[10.5px] leading-[1.5] text-white shadow-[var(--shadow-popover)]"
          style={{
            left: cursorPos.x * scale + 12,
            top: cursorPos.y * scale + 12,
            background: "color-mix(in srgb, var(--color-ink-9) 92%, transparent)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <div className="truncate">
            <span className="text-[color:var(--color-accent)]">&lt;{hoverEl.tag}&gt;</span>{" "}
            <span className="text-white/85">
              {hoverEl.text || hoverEl.attrs.href || hoverEl.attrs.src || ""}
            </span>
          </div>
          {hoverSiblings.length > 0 && !shiftHeld && (
            <div className="mt-0.5 text-[color:var(--color-accent)]/85">
              +{hoverSiblings.length} similar — click for list mode
            </div>
          )}
          {shiftHeld && (
            <div className="mt-0.5 text-[#fbbf24]">
              ⇧-click → add to latest list field
            </div>
          )}
          <div className="mt-0.5 text-white/55">
            drag → box-select for composite values
          </div>
        </div>
      )}

      {/* Drag hint */}
      {isDragging && cursorPos && scale > 0 && (
        <div
          className="pointer-events-none absolute rounded-lg px-2.5 py-1.5 font-mono text-[10.5px] text-white shadow-[var(--shadow-popover)]"
          style={{
            left: cursorPos.x * scale + 12,
            top: cursorPos.y * scale + 12,
            background: "color-mix(in srgb, var(--color-ink-9) 92%, transparent)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <span className="text-[#fbbf24]">⤴</span> release to pick the element covering this box
        </div>
      )}
    </div>
  );
}
