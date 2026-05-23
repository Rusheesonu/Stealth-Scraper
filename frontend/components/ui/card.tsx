import { cn } from "@/lib/utils";

/**
 * Card. Radius-lg (8px). Border-as-separator, no shadow. Two padding
 * tiers: compact (16px) and comfortable (24px). Use compact in dense
 * lists, comfortable in marketing/dashboard surfaces.
 */
export function Card({
  children,
  className,
  density = "comfortable",
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  density?: "compact" | "comfortable";
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]",
        density === "compact" ? "p-4" : "p-6",
        interactive && [
          "transition-[border-color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]",
          "cursor-pointer",
        ],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("mb-3", className)}>{children}</div>;
}

export function CardTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "text-[16px] font-semibold tracking-[-0.005em] text-[var(--color-fg-strong)]",
        className,
      )}
    >
      {children}
    </h3>
  );
}

/**
 * Section — a labelled region on a page. Used in /design, /pricing,
 * /settings. Just a header (eyebrow label + title + optional description)
 * over arbitrary content.
 */
export function Section({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("py-10 first:pt-0", className)}>
      <div className="mb-6">
        {eyebrow && (
          <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
            {eyebrow}
          </div>
        )}
        <h2 className="text-[26px] font-semibold leading-[1.2] tracking-[var(--tracking-h1)] text-[var(--color-fg-strong)]">
          {title}
        </h2>
        {description && (
          <p className="mt-2 max-w-2xl text-[15px] leading-[1.55] text-[var(--color-fg-muted)]">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}
