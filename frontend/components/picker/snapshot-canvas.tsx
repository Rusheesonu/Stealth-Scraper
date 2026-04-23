"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
  onElementClick: (el: DetectedElement) => void;
  pickedFields: Picked[];
};

export function SnapshotCanvas({ snapshot, onElementClick, pickedFields }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(0);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

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

  function onMouseMove(e: React.MouseEvent) {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const effectiveScale = renderedWidth > 0 ? renderedWidth / pageWidth : rect.width / pageWidth;
    if (effectiveScale <= 0) return;
    const px = (e.clientX - rect.left) / effectiveScale;
    const py = (e.clientY - rect.top) / effectiveScale;
    setCursorPos({ x: px, y: py });
    const hit = findElementAt(px, py);
    setHoverId(hit?.id ?? null);
  }

  function onMouseLeave() {
    setHoverId(null);
    setCursorPos(null);
  }

  function onClick() {
    if (hoverId == null) return;
    const el = snapshot.elements.find((e) => e.id === hoverId);
    if (el) onElementClick(el);
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

  return (
    <div
      ref={containerRef}
      className="relative mx-auto max-w-6xl overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] shadow-[0_0_40px_rgba(0,0,0,0.6)]"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      style={{ cursor: hoverId != null ? "crosshair" : "default" }}
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
      {scale > 0 && hoverEl && (
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

      {/* Floating label near cursor */}
      {hoverEl && cursorPos && scale > 0 && (
        <div
          className="pointer-events-none absolute max-w-[280px] rounded-md border border-emerald-800 bg-black/90 px-2 py-1 font-mono text-[10px] text-emerald-200 shadow-xl"
          style={{
            left: cursorPos.x * scale + 12,
            top: cursorPos.y * scale + 12,
          }}
        >
          <div className="truncate">
            <span className="text-emerald-400">&lt;{hoverEl.tag}&gt;</span>{" "}
            {hoverEl.text || hoverEl.attrs.href || hoverEl.attrs.src || ""}
          </div>
          {hoverSiblings.length > 0 && (
            <div className="mt-0.5 text-emerald-400/70">
              +{hoverSiblings.length} similar — click for list mode
            </div>
          )}
        </div>
      )}
    </div>
  );
}
