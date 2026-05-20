"use client";

import * as React from "react";
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

/* Shared easing + durations — matches CSS tokens in globals.css. */
export const APPLE_EASE = [0.32, 0.72, 0, 1] as const;
export const APPLE_SPRING = [0.5, 1.5, 0.4, 1] as const;
export const DUR_FAST = 0.16;
export const DUR_DELIBERATE = 0.32;

/**
 * MotionFade — drop-in `<motion.div>` with a 280ms fade-up reveal on mount.
 * Use to wrap the main content slot of any route. The router itself doesn't
 * re-mount on identical layouts, so this fires once per route entrance —
 * which is the moment that actually deserves animation.
 */
export function MotionFade({
  children,
  delay = 0,
  className,
  ...rest
}: HTMLMotionProps<"div"> & { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR_DELIBERATE, ease: APPLE_EASE, delay }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/**
 * MotionStagger — children animate in on a 40ms cascade. Use sparingly —
 * for hero feature grids, pricing tier reveals, demo example chips.
 * Wraps children in a stagger context; combine with MotionStaggerItem.
 */
export function MotionStagger({
  children,
  className,
  delayChildren = 0.08,
  staggerChildren = 0.04,
}: {
  children: React.ReactNode;
  className?: string;
  delayChildren?: number;
  staggerChildren?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { delayChildren, staggerChildren } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function MotionStaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 10 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: DUR_DELIBERATE, ease: APPLE_EASE },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Popover — calm scale+fade reveal anchored to a trigger. Used in nav
 * dropdowns, action menus. AnimatePresence handles exit so close feels
 * intentional rather than abrupt.
 */
export function Popover({
  open,
  children,
  className,
  align = "right",
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: 0.18, ease: APPLE_EASE }}
          style={{ transformOrigin: align === "right" ? "top right" : "top left" }}
          className={cn(
            "absolute top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)]",
            "shadow-[var(--shadow-popover)]",
            align === "right" ? "right-0" : "left-0",
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Modal — sheet that floats above the page. Same easing family as the
 * popover but a deeper scale (95% → 100%) and a longer duration (260ms)
 * to land as a deliberate state change. Backdrop fades simultaneously.
 */
export function Modal({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  // Lock scroll while open
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: APPLE_EASE }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-ink-9)_36%,transparent)]" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.26, ease: APPLE_EASE }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-elevated)] shadow-[var(--shadow-modal)]",
              className,
            )}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
