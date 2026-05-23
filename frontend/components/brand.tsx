import { cn } from "@/lib/utils";

/**
 * Brand mark — a 4×4 grid of dots with a single emerald anchor.
 * Reads as "structured cells, one of which is the data we care about" —
 * matches the product's "click a cell, get a field" mental model.
 * Pure CSS, scales cleanly, looks crisp at any retina density.
 */
export function Brand({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        className="grid h-5 w-5 grid-cols-3 grid-rows-3 gap-[2px]"
        aria-hidden
      >
        {Array.from({ length: 9 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "rounded-[1px]",
              i === 4
                ? "bg-[var(--color-accent)]"
                : "bg-[var(--color-fg-muted)]/30",
            )}
          />
        ))}
      </div>
      {showText && (
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--color-fg-strong)]">
          Stealth-Scraper
        </span>
      )}
    </div>
  );
}
