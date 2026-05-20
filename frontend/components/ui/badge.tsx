import { cn } from "@/lib/utils";

/**
 * Badge. Pill-shaped (radius-sm), monospace, small. Used for: status
 * indicators, tier labels, metadata pills, kbd-style affordances.
 * Calm by default — semantic tones only when they're communicating real
 * state (not decoration).
 */
type Tone = "default" | "accent" | "success" | "warning" | "danger" | "info" | "muted";

const toneCls: Record<Tone, string> = {
  default: "bg-[var(--color-surface)] text-[var(--color-fg-muted)] border-[var(--color-border)]",
  accent:  "bg-[var(--color-accent-faint)] text-[var(--color-accent)] border-[color:var(--color-accent)]/20",
  success: "bg-[var(--color-success-dim)] text-[var(--color-success)] border-[color:var(--color-success)]/20",
  warning: "bg-[var(--color-warning-dim)] text-[var(--color-warning)] border-[color:var(--color-warning)]/20",
  danger:  "bg-[var(--color-danger-dim)] text-[var(--color-danger)] border-[color:var(--color-danger)]/20",
  info:    "bg-[var(--color-info-dim)] text-[var(--color-info)] border-[color:var(--color-info)]/20",
  muted:   "bg-transparent text-[var(--color-fg-subdued)] border-[var(--color-border)]",
};

export function Badge({
  children,
  className,
  tone = "default",
  size = "sm",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: Tone;
  size?: "xs" | "sm";
}) {
  const sizeCls = size === "xs" ? "h-[18px] px-1.5 text-[10px]" : "h-[20px] px-2 text-[11px]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border font-mono tracking-[var(--tracking-mono)]",
        "leading-none",
        toneCls[tone],
        sizeCls,
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Keyboard hint — for shortcut affordances. Same chrome family as Badge
 * but slightly different proportions for the kbd context.
 */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm",
        "border border-[var(--color-border)] bg-[var(--color-elevated)]",
        "px-1 font-mono text-[10px] text-[var(--color-fg-muted)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
